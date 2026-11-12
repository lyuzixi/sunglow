<script setup lang="ts">
/* =========================================================================
   合成分享卡（2026-11-11 重做）
   ---------------------------------------------------------------------------
   底卡是改造前的 780×400 结论核心（模块 1/2/3 固定），14 个可选模块单列向下
   堆叠，块高按内容实测。面板里可勾选、拖动排序（手柄 + ↑↓ 兑底），选择与
   顺序都写进偏好。
   取数纪律不变：趋势 / 观测场只读缓存，没缓存就禁选并写明原因，绝不因为
   勾了一下就发请求。
   ========================================================================= */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { state, savePrefs, dataStamp, mapBox } from "../state";
import { t } from "../core/i18n";
import type { VerdictView } from "../core/verdict";
import {
  drawComposeCard, saveComposeCard, composeAvail, COMPOSE_W,
  type ComposeInput, type ComposeAvail
} from "../core/composecard";
import {
  COMPOSE_MODULES, COMPOSE_IDS, type ComposeModId, type ComposeModDef
} from "../core/composemods";
import {
  trendDaysCached, mapThumbCached, mapThumbFromBox, captureMapComposite, loadHeroPhoto
} from "../core/sharecard";

const props = defineProps<{ view: VerdictView | null; url: string }>();

const cv = ref<HTMLCanvasElement | null>(null);
const photo = ref<HTMLImageElement | null>(null);
const busy = ref(false);
const redraws = ref(0);
const heightPx = ref(400);
const listEl = ref<HTMLElement | null>(null);

/* 放大预览 */
const zoomOpen = ref(false);
const zoomCv = ref<HTMLCanvasElement | null>(null);
const zoomBtn = ref<HTMLButtonElement | null>(null);
let lastFocus: HTMLElement | null = null;

const MODS = COMPOSE_MODULES;
const byId = (id: ComposeModId): ComposeModDef =>
  MODS.find((m) => m.id === id) || MODS[0];

/** 列表顺序：锚定的天色带永远第一，其余按用户拖出来的顺序 */
const list = computed<ComposeModDef[]>(() => {
  const order = state.cmpOrder;
  const rest = COMPOSE_IDS
    .filter((id) => !byId(id).anchored)
    .slice()
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const head = MODS.filter((m) => m.anchored);
  return [...head, ...rest.map((id) => byId(id))];
});

function resolveMap(r: NonNullable<typeof state.result>) {
  try {
    if (mapBox.value && state.mapDateS === r.dateStr) {
      const hit = mapThumbFromBox(mapBox.value, r.period, r.city);
      if (hit) return hit;
    }
    return mapThumbCached(r);
  } catch { return null; }
}

function buildInput(): ComposeInput | null {
  const r = state.result, v = props.view;
  if (!r || !v) return null;
  return {
    r, view: v, url: props.url,
    days: trendDaysCached(r),
    map: resolveMap(r),
    mapImg: state.cmpOn.includes("map") ? captureMapComposite() : null,
    photo: photo.value
  };
}

/** 可用性：趋势 / 观测场 / 二维码没就绪就禁选 */
const avail = computed<ComposeAvail>(() => {
  void dataStamp.value; void mapBox.value;
  const r = state.result, v = props.view;
  const empty = Object.fromEntries(COMPOSE_IDS.map((id) => [id, false])) as ComposeAvail;
  if (!r || !v) return empty;
  return composeAvail({ r, view: v, url: props.url, days: trendDaysCached(r), map: resolveMap(r) });
});

function hintOf(m: ComposeModDef): string {
  if (avail.value[m.id]) return m.anchored ? t("固定在结论上方") : "";
  if (m.id === "trend") return t("先在上方加载趋势");
  if (m.id === "map") {
    const rd = state.result ? state.result.dateStr : "";
    if (mapBox.value && rd && state.mapDateS !== rd) {
      return t("地图是 {d} 的，与本卡日期不同", { d: state.mapDateS });
    }
    return t("先在上方加载地图");
  }
  if (m.id === "window") return t("该时段没有明确的霞光窗口（云量与光路不配合）");
  if (m.id === "qr") return t("先算出结果，才有快照链接");
  return t("暂不可用");
}

const picked = computed(() => state.cmpOn.filter((id) => avail.value[id]).length);

function toggle(id: ComposeModId, on: boolean) {
  const set = new Set(state.cmpOn);
  if (on) set.add(id); else set.delete(id);
  state.cmpOn = COMPOSE_IDS.filter((x) => set.has(x));
  savePrefs();
}

function preset(kind: "min" | "std" | "full") {
  const pick = (ids: ComposeModId[]) => ids.filter((id) => avail.value[id]);
  if (kind === "min") state.cmpOn = pick(["sky", "qr"]);
  else if (kind === "std") state.cmpOn = pick(["sky", "window", "trend", "models", "qr"]);
  else state.cmpOn = COMPOSE_IDS.filter((id) => avail.value[id]);
  savePrefs();
}

/* ---------------- 拖拽排序：手柄按下 → window 追踪 → 跨过邻居中点即换位 ---------- */
const dragId = ref<ComposeModId | null>(null);
function onGripDown(e: PointerEvent, id: ComposeModId) {
  if (byId(id).anchored) return;
  dragId.value = id;
  e.preventDefault();
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", onDragEnd);
  window.addEventListener("pointercancel", onDragEnd);
}
function onDragMove(e: PointerEvent) {
  const id = dragId.value;
  if (!id || !listEl.value) return;
  const rows = [...listEl.value.querySelectorAll<HTMLElement>("[data-mid]")];
  if (!rows.length) return;
  let target = rows.length - 1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) { target = i; break; }
  }
  const anchored = MODS.filter((m) => m.anchored).map((m) => m.id);
  const order = state.cmpOrder.filter((x) => !byId(x).anchored);
  target = Math.max(0, Math.min(order.length - 1, target - anchored.length));
  const from = order.indexOf(id);
  if (from < 0 || from === target) return;
  order.splice(from, 1);
  order.splice(target, 0, id);
  state.cmpOrder = [...anchored, ...order];
  savePrefs();
}
function onDragEnd() {
  dragId.value = null;
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", onDragEnd);
  window.removeEventListener("pointercancel", onDragEnd);
}
function move(id: ComposeModId, dir: -1 | 1) {
  if (byId(id).anchored) return;
  const order = state.cmpOrder.slice();
  const i = order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  if (byId(order[j]).anchored) return;
  [order[i], order[j]] = [order[j], order[i]];
  state.cmpOrder = order;
  savePrefs();
}

/* ------------------------------- 预览 ------------------------------- */
function redraw() {
  const el = cv.value;
  redraws.value++;
  const input = buildInput();
  if (!input || !el) return;
  const meta = drawComposeCard(el, input, state.cmpOn, state.cmpOrder);
  heightPx.value = Math.round(meta.h / 2);
}

async function save() {
  const input = buildInput();
  if (!input || busy.value) return;
  busy.value = true;
  try {
    await saveComposeCard(input, state.cmpOn, state.cmpOrder);
  } catch {
    alert(t("生成图片失败，请重试。"));
  } finally {
    busy.value = false;
  }
}

watch(() => [state.cmpOn.slice(), state.cmpOrder.slice()], () => nextTick(redraw), { deep: true });
watch(() => state.result, () => nextTick(redraw));
watch(dataStamp, () => { nextTick(redraw); window.setTimeout(redraw, 320); });
watch(mapBox, () => nextTick(redraw));
watch(() => state.dateStr + state.period + state.city.name, () => nextTick(redraw));
watch(() => props.url, () => nextTick(redraw));

/* --------------------------- 放大预览 --------------------------- */
function openZoom() {
  if (!props.view) return;
  lastFocus = document.activeElement as HTMLElement | null;
  zoomOpen.value = true;
  document.body.style.overflow = "hidden";
  nextTick(() => {
    const src = cv.value, dst = zoomCv.value;
    if (!src || !dst || !src.width || !src.height) return;
    dst.width = src.width; dst.height = src.height;
    const c = dst.getContext("2d");
    if (c) c.drawImage(src, 0, 0);
    zoomBtn.value?.focus();
  });
}
function closeZoom() {
  zoomOpen.value = false;
  document.body.style.overflow = "";
  lastFocus?.focus?.();
  lastFocus = null;
}
function onZoomKey(e: KeyboardEvent) {
  if (e.key === "Escape" && zoomOpen.value) closeZoom();
}

onMounted(async () => {
  window.addEventListener("keydown", onZoomKey);
  try { photo.value = await loadHeroPhoto(); } catch { photo.value = null; }
  nextTick(redraw);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__gcCompose = () => ({
    mods: state.cmpOn.slice(),
    order: state.cmpOrder.slice(),
    avail: avail.value,
    h: heightPx.value,
    w: COMPOSE_W,
    picked: picked.value,
    redraws: redraws.value
  });
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onZoomKey);
  onDragEnd();
  if (zoomOpen.value) document.body.style.overflow = "";
});
</script>

<template>
  <div class="cmp">
    <div class="cmp-head">
      <h3>{{ t("合成分享卡") }}</h3>
      <p>{{ t("底卡固定为报头、结论与页脚；下面的模块自由勾选、拖动排序，版面按内容自动长高。") }}</p>
    </div>

    <div class="cmp-body">
      <button
        type="button"
        class="cmp-preview"
        :disabled="!view"
        :aria-label="t('放大预览合成分享卡')"
        :title="t('点击放大')"
        @click="openZoom"
      >
        <canvas ref="cv" class="cmp-cv" />
        <span class="cmp-zoomhint">{{ t("点击放大") }}</span>
      </button>

      <div class="cmp-side">
        <div class="cmp-presets">
          <button @click="preset('min')">{{ t("极简") }}</button>
          <button @click="preset('std')">{{ t("标准") }}</button>
          <button @click="preset('full')">{{ t("完整") }}</button>
        </div>

        <p class="cmp-ttl">{{ t("可选模块 · 拖动排序") }}</p>
        <ul ref="listEl" class="cmp-list">
          <li
            v-for="m in list"
            :key="m.id"
            :data-mid="m.id"
            class="cmp-row"
            :class="{ on: state.cmpOn.includes(m.id), off: !avail[m.id], dragging: dragId === m.id }"
          >
            <span
              class="grip"
              :class="{ locked: !!m.anchored }"
              :title="m.anchored ? t('固定在结论上方') : t('拖动排序')"
              @pointerdown="onGripDown($event, m.id)"
            >⋮⋮</span>
            <label class="cb">
              <input
                type="checkbox"
                :checked="state.cmpOn.includes(m.id)"
                :disabled="!avail[m.id]"
                @change="toggle(m.id, ($event.target as HTMLInputElement).checked)"
              />
              <span class="nm">{{ t(m.name) }}</span>
            </label>
            <span class="hint">{{ hintOf(m) }}</span>
            <button
              class="mv" :disabled="!!m.anchored" :aria-label="t('上移')"
              @click="move(m.id, -1)"
            >↑</button>
            <button
              class="mv" :disabled="!!m.anchored" :aria-label="t('下移')"
              @click="move(m.id, 1)"
            >↓</button>
          </li>
        </ul>

        <p class="cmp-note">
          {{ t("已选 {n} 块 · 成图 780×{h}（高随内容走）", { n: picked, h: heightPx }) }}
          · {{ t("产物：1 个文件") }}
        </p>

        <button class="btn btn-primary" :disabled="busy || !view" :aria-busy="busy" @click="save">
          {{ busy ? t("正在生成…") : t("保存图片") }}
        </button>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="zoomOpen" class="zoom-mask" @click.self="closeZoom">
        <div class="zoom-box" role="dialog" aria-modal="true" :aria-label="t('合成分享卡预览')">
          <div class="zoom-bar">
            <b>{{ t("合成分享卡预览") }}</b>
            <span class="zoom-dim">{{ t("成图 780×{h}", { h: heightPx }) }}</span>
            <button ref="zoomBtn" type="button" class="zoom-x" :aria-label="t('关闭')" @click="closeZoom">
              ✕
            </button>
          </div>
          <div class="zoom-scroll">
            <canvas ref="zoomCv" class="zoom-cv" />
          </div>
          <div class="zoom-acts">
            <button class="btn btn-ghost sm" @click="closeZoom">{{ t("关闭") }}</button>
            <button class="btn btn-primary sm" :disabled="busy || !view" :aria-busy="busy" @click="save">
              {{ busy ? t("正在生成…") : t("保存图片") }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.cmp { margin-top: 20px; padding-top: 22px; border-top: 1px solid var(--stroke); }
.cmp-head h3 { margin: 0 0 6px; font-size: var(--fs-body); font-weight: 600; color: var(--tx-1); }
.cmp-head p { margin: 0 0 18px; font-size: var(--fs-small); color: var(--tx-2); line-height: 1.7; }

.cmp-body {
  display: grid; grid-template-columns: minmax(0, 320px) minmax(0, 1fr);
  gap: 22px; align-items: start;
}
.cmp-preview {
  position: relative;
  display: block; width: 100%;
  padding: 0; font: inherit; text-align: left;
  border-radius: var(--r-md); overflow: hidden;
  border: 1px solid var(--stroke); background: var(--bg-glass);
  cursor: zoom-in;
  transition: border-color var(--t-fast), box-shadow var(--t-fast);
}
.cmp-preview:hover:not(:disabled) { border-color: var(--stroke-2); box-shadow: var(--card-sh); }
.cmp-preview:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.cmp-preview:disabled { cursor: default; }
.cmp-cv { display: block; width: 100%; height: auto; }
.cmp-zoomhint {
  position: absolute; right: 8px; bottom: 8px;
  padding: 3px 9px; border-radius: var(--r-full);
  font-size: var(--fs-tiny);
  color: #fff; background: rgba(10, 16, 28, .66);
  border: 1px solid rgba(255, 255, 255, .28);
  opacity: .92; transition: opacity var(--t-fast), transform var(--t-fast);
  pointer-events: none;
}
.cmp-preview:hover .cmp-zoomhint,
.cmp-preview:focus-visible .cmp-zoomhint { opacity: 1; transform: translateY(-1px); }

.cmp-presets { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
.cmp-presets button {
  padding: 5px 11px; border-radius: var(--r-full);
  border: 1px solid var(--stroke-2); background: transparent;
  font-size: var(--fs-tiny); color: var(--tx-2);
}
.cmp-presets button:hover { color: var(--tx-1); border-color: var(--acc-3); }

.cmp-ttl {
  margin: 0 0 8px; font-size: var(--fs-tiny);
  letter-spacing: .04em; color: var(--tx-3);
}

.cmp-list { list-style: none; margin: 0 0 4px; padding: 0; }
.cmp-row {
  display: grid;
  grid-template-columns: 18px 136px minmax(0, 1fr) 22px 22px;
  align-items: center; gap: 6px;
  padding: 5px 4px; border-radius: var(--r-sm);
  font-size: var(--fs-small); color: var(--tx-1);
}
.cmp-row:hover { background: var(--bg-glass-2); }
.cmp-row.dragging { background: var(--bg-glass); box-shadow: var(--card-sh); }
.cmp-row.off { opacity: .55; }
.cmp-row .grip {
  cursor: grab; color: var(--tx-3);
  font-size: 13px; letter-spacing: -2px;
  user-select: none; touch-action: none;
}
.cmp-row .grip.locked { cursor: default; opacity: .4; }
.cmp-row .cb { display: flex; align-items: center; gap: 8px; cursor: pointer; min-width: 0; }
.cmp-row .cb input { width: 14px; height: 14px; accent-color: var(--acc-3); }
.cmp-row .nm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cmp-row .hint {
  font-size: 10px; color: var(--tx-3);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cmp-row .mv {
  width: 22px; height: 22px;
  display: grid; place-items: center;
  border-radius: var(--r-sm); border: 1px solid var(--stroke);
  background: transparent; color: var(--tx-2); font-size: 11px;
}
.cmp-row .mv:hover:not(:disabled) { color: var(--tx-1); border-color: var(--stroke-2); }
.cmp-row .mv:disabled { opacity: .3; }

.cmp-side { max-width: 640px; }
.cmp-note {
  margin: 10px 0 14px; padding-top: 12px; border-top: 1px solid var(--stroke);
  font-size: var(--fs-tiny); color: var(--tx-3); line-height: 1.7;
}

.zoom-mask {
  position: fixed; inset: 0; z-index: 310;
  display: flex; align-items: center; justify-content: center;
  padding: clamp(10px, 2.4vw, 28px);
  background: rgba(6, 10, 20, .74);
  backdrop-filter: blur(6px);
}
.zoom-box {
  width: min(880px, 96vw); max-height: 94vh;
  display: flex; flex-direction: column; gap: 10px;
}
.zoom-bar { display: flex; align-items: center; gap: 10px; color: #fff; font-size: var(--fs-small); }
.zoom-dim { color: rgba(255, 255, 255, .62); font-size: var(--fs-tiny); }
.zoom-x {
  margin-left: auto; width: 30px; height: 30px;
  display: grid; place-items: center; border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, .3);
  background: rgba(255, 255, 255, .08); color: #fff; font-size: 13px; line-height: 1;
}
.zoom-x:hover { background: rgba(255, 255, 255, .18); }
.zoom-scroll {
  overflow: auto; border-radius: 14px; background: #0b1020;
  box-shadow: 0 26px 70px rgba(0, 0, 0, .5);
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, .34) transparent;
}
.zoom-cv { display: block; width: 100%; height: auto; }
.zoom-acts { display: flex; justify-content: flex-end; gap: 8px; }

@media (max-width: 860px) {
  .cmp-body { grid-template-columns: 1fr; }
  .cmp-preview { max-width: 320px; margin: 0 auto; }
  .cmp-row .hint { max-width: 110px; }
}
</style>
