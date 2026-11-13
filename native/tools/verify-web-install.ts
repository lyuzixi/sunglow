/* SUNGLOW · 用网页真实 installSharePack 反解 App 生成的 pack（R2-5）
 * 构建：v2/node_modules/.bin/esbuild native/tools/verify-web-install.ts --bundle --platform=node --format=esm --outfile=.tmp/verify-web-install.mjs
 * 运行：node .tmp/verify-web-install.mjs native/app/src/test/resources/pack/app-point-trend.txt
 */
import { readFileSync } from "node:fs";
import { installSharePack, snapInfo, snapCacheEntry } from "../../v2/src/core/snapshot";

async function main() {
  const pack = readFileSync(process.argv[2], "utf8").trim();
  const installed = await installSharePack(pack);
  const pointKey = "SUNGLOW.v2.point.v3.2026-11-12|pm@39.9,116.4";
  const trendKey = "SUNGLOW.v2.trend.2026-11-12@39.9,116.4";
  const mapKey = "SUNGLOW.v2.map.v9.2026-11-12@39.9,116.4";
  const point = snapCacheEntry(pointKey) as { obj?: Record<string, unknown> } | null;
  const trend = snapCacheEntry(trendKey) as { rows?: unknown[] } | null;
  const map = snapCacheEntry(mapKey) as {
    obj?: { am?: { pts?: unknown[] }; pm?: { pts?: unknown[] } };
  } | null;
  const out = {
    installed,
    info: snapInfo.value,
    pointHit: !!point,
    pointP: point?.obj?.P,
    pointQ: point?.obj?.Q,
    pointFactorRows: Array.isArray(point?.obj?.factorRows) ? (point!.obj!.factorRows as unknown[]).length : null,
    pointConfDark: !!(point?.obj?.conf as { dark?: unknown } | undefined)?.dark,
    trendRows: trend?.rows?.length ?? 0,
    mapHit: !!map,
    mapAmPts: map?.obj?.am?.pts?.length ?? 0,
    mapPmPts: map?.obj?.pm?.pts?.length ?? 0
  };
  console.log(JSON.stringify(out, null, 2));
  if (!installed || !out.pointHit || !out.pointConfDark) process.exit(1);
  if (out.trendRows !== 0 && out.trendRows !== 2) process.exit(1);
  if (out.mapHit && ![121, 61, 41].includes(out.mapPmPts)) process.exit(1);
}
main();
