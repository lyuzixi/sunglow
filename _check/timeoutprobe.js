/* B4 回归守护：jget 必须在接口"只连不答"时主动中断，而不是无限期挂住。
   做法：起一个只接受连接、永不回包的本机 HTTP 服务，用 tries=1 调 jget，
   断言 ① 确实抛错、② err.timeout 被置位、③ 文案里点明"超时"、④ 耗时贴近 12 秒上限。

   另外覆盖 429 的**两个分叉**（本轮新增，此前 0 覆盖）：
   短时突发限流（可退避重试）与日额度耗尽（不可恢复、必须短路）。
   这两类的正确处置完全相反 —— 只钉住其中一类，等于放任另一类被误处置：
   要么把"明天才恢复"当"稍等一分钟"，要么把"稍等一分钟"当"今天别试了"。

   实现说明：把产物里**含 jget 的那个**内联脚本块用 new Function 在同一进程里求值后跑断言。
   不另起子进程 —— 在 Windows 上从 node 里再 spawn 同一个 node.exe 会 EBUSY。
   用法: node _check/timeoutprobe.js        （约 16 秒）
*/
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const tpl = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
/* **按内容取块，而不是按序号**：产物现在有 4 个内联块，第 0 块是 <head> 里的主题引导脚本（它要用 document，在 Node 里求值必然 ReferenceError）。
   序号取块在加块时会**静默错位** —— 更坏的是 run_self 那类"拼起来交给 node 跑"的用法：脚本一抛错，stdout 里什么都没有，
   而判据是"数 FAIL 行"，于是空输出被数成 0 个 FAIL = 假绿。 */
const BLOCKS = [...tpl.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const b0 = BLOCKS.find(b => b.indexOf("function jget") >= 0);
if (!b0) { console.log("抽不到含 jget 的脚本块"); process.exit(1); }

const TEST = `
(async function () {
  const checks = [];
  const ok = (name, pass, extra) => {
    checks.push(pass);
    console.log((pass ? "PASS" : "FAIL"), name + (extra === undefined ? "" : "  " + extra));
  };
  /* 同一个 helper 起两类 429 服务：只差响应体措辞与是否带 Retry-After。
     真实响应体形如 {"error":true,"reason":"..."}，reason 里会指明被突破的是哪个窗口。 */
  const mk429 = (reason, retryAfter) => {
    const box = { hits: 0 };
    box.srv = http.createServer(function (req, res) {
      box.hits++;
      const h = { "Content-Type": "application/json" };
      if (retryAfter) h["Retry-After"] = String(retryAfter);
      res.writeHead(429, h);
      res.end(JSON.stringify({ error: true, reason: reason }));
    });
    return box;
  };
  const listen = b => new Promise(r => b.srv.listen(0, "127.0.0.1", r));
  const shut = b => { try { if (b.srv.closeAllConnections) b.srv.closeAllConnections(); } catch (e) { } b.srv.close(); };

  /* ---- ① 只连不答 → 12 秒超时 ---- */
  const srv = http.createServer(function (req, res) { /* 故意什么都不回 */ });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  const t0 = Date.now();
  let err = null;
  try { await jget("http://127.0.0.1:" + port + "/never", 1); }
  catch (e) { err = e; }
  const dt = Date.now() - t0;
  try { if (srv.closeAllConnections) srv.closeAllConnections(); } catch (e) { }
  srv.close();
  ok("jget 对无响应接口抛出超时错误", !!(err && err.timeout), "err=" + (err && err.message));
  ok("超时文案可读（含「超时」字样）", !!(err && /超时/.test(String(err.message || ""))));
  ok("中断耗时落在 12 秒量级", dt >= 11000 && dt <= 17000, "实测 " + dt + " ms");

  /* ---- ② 日额度耗尽：tries=3，但必须第一次就停 ---- */
  const A = mk429("Daily API request limit exceeded. Please try again tomorrow.", 0);
  await listen(A);
  let errA = null;
  const tA = Date.now();
  try { await jget("http://127.0.0.1:" + A.srv.address().port + "/daily", 3); }
  catch (e) { errA = e; }
  const dtA = Date.now() - tA;
  shut(A);
  ok("日额度耗尽被判定为 fatal", !!(errA && errA.fatal === true));
  ok("日额度耗尽保留 HTTP 状态", !!(errA && errA.status === 429));
  ok("日额度耗尽只打一次接口（不白重试）", A.hits === 1, "实际请求 " + A.hits + " 次 / 上限 3 次");
  ok("日额度耗尽不把用户多晾十几秒", dtA < 1500, "实测 " + dtA + " ms");
  ok("日额度耗尽给出针对性文案", !!(errA && /额度/.test(String(errA.friendly || ""))),
     JSON.stringify(String((errA && errA.friendly) || "").slice(0, 40)));

  /* ---- ③ 短时突发限流：必须退避重试，且**不得**被判成 fatal ---- */
  const B = mk429("Minutely API request limit exceeded. Please try again in a minute.", 1);
  await listen(B);
  let errB = null;
  const tB = Date.now();
  try { await jget("http://127.0.0.1:" + B.srv.address().port + "/minutely", 2); }
  catch (e) { errB = e; }
  const dtB = Date.now() - tB;
  shut(B);
  ok("短时限流未被误判为 fatal", !(errB && errB.fatal), "fatal=" + (errB && errB.fatal));
  ok("短时限流确实退避重试", B.hits === 2, "实际请求 " + B.hits + " 次 / 上限 2 次");
  ok("短时限流给出可重试的文案", !!(errB && /限流/.test(String(errB.friendly || ""))));
  ok("Retry-After 被采信（等待 1s 而非退避的 2.5s）", dtB >= 900 && dtB < 1800, "实测 " + dtB + " ms");
  ok("Retry-After 被解析进 err.retryAfter", !!(errB && errB.retryAfter === 1000),
     "retryAfter=" + (errB && errB.retryAfter));

  /* ---- ④ 429 但没有可读响应体 → 不能猜成 fatal（宁可退避重试） ---- */
  const box = { hits: 0 };
  box.srv = http.createServer(function (req, res) {
    box.hits++;
    res.writeHead(429, { "Content-Type": "text/plain" });
    res.end("");
  });
  await listen(box);
  let errC = null;
  try { await jget("http://127.0.0.1:" + box.srv.address().port + "/opaque", 1); }
  catch (e) { errC = e; }
  shut(box);
  ok("响应体不可读时不猜测为 fatal", !(errC && errC.fatal));
  ok("响应体不可读时仍抛出原始 429", !!(errC && errC.status === 429));

  console.log("FAIL 计数:", checks.filter(x => !x).length);
  console.log('FACTS {"assertions":' + checks.length + ',"fail":' + checks.filter(x => !x).length + '}');
  if (checks.some(x => !x)) process.exitCode = 1;
})();
`;

try {
  const run = new Function("require", "console", "process", "fetch", "AbortController",
    "setTimeout", "clearTimeout", "http", b0 + "\n" + TEST);
  run(require, console, process, fetch, AbortController, setTimeout, clearTimeout, http);
} catch (e) {
  console.log("B4 守护执行异常: " + (e && e.stack || e));
  process.exitCode = 1;
}
