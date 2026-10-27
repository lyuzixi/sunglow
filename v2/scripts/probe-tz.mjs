/* 时间管道单测的运行器：用项目自带的 esbuild 把 TS 打成临时 CJS 再跑。
   不联网、不进浏览器 —— 失败点能直接指到「墙钟解析 / 偏移 / 格式化」哪一层。 */
import { buildSync } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(mkdtempSync(path.join(tmpdir(), "glowcast-tz-")), "tz.test.cjs");

buildSync({
  entryPoints: [path.join(here, "tz.test.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: out,
  logLevel: "silent"
});

console.log("时间管道单测（纯 Node）");
createRequire(import.meta.url)(out);
