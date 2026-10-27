<script setup lang="ts">
/* 自绘月历：替代原生 <input type="date">。
   原生日历弹层的形态在 Chrome / Firefox / Safari 之间差得最远（小日历 / 全月历 / 转盘），
   这里统一成一套网格；同时把可选范围收紧到取数接口真能覆盖的区间，
   免得选到 2027 年再点「计算」才报错。 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { t } from "../core/i18n";
import { state } from "../state";
import { useAnchoredPopup } from "../core/popover";
import { cityTz, todayInTz } from "../core/tz";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    /** 可选范围（含端点）；不给则按取数能力取 今天-2 ~ 今天+15 */
    min?: string;
    max?: string;
    ariaLabel?: string;
  }>(),
  { ariaLabel: "" }
);
const emit = defineEmits<{ "update:modelValue": [string] }>();

/* ---- 日期工具：一律走本地时间，不碰 UTC（跨时区会差一天） ---- */
function pad(n: number) {
  return String(n).padStart(2, "0");
}
function isoOf(d: Date) {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
function parseIso(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(s: string, n: number) {
  const d = parseIso(s);
  d.setDate(d.getDate() + n);
  return isoOf(d);
}

/* 「今天」与可选范围都按**所选城市**的当地日历算 —— 浏览器在北京时，
   纽约此刻可能还是前一天，用本机日期会让范围与默认值错一天 */
const today = computed(() =>
  todayInTz(cityTz(state.city.lat, state.city.lon))
);
const minIso = computed(() => props.min || addDays(today.value, -2));
const maxIso = computed(() => props.max || addDays(today.value, 15));

const open = ref(false);
const triggerEl = ref<HTMLButtonElement | null>(null);
const popEl = ref<HTMLElement | null>(null);
const { anchor, place } = useAnchoredPopup(open, triggerEl, popEl);

const focusIso = ref(props.modelValue);
const view = ref({ y: 0, m: 0 });

const WEEK = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const monthLabel = computed(() => {
  const label = t("{y} 年 {m} 月", { y: view.value.y, m: view.value.m + 1 });
  /* 英文词典给的是 {m}/{y}（序号），中文给的是「年/月」，两种都从这里出 */
  return label === "{y} 年 {m} 月" ? MONTH_EN[view.value.m] + " " + view.value.y : label;
});

function syncView(iso: string) {
  const d = parseIso(iso);
  view.value = { y: d.getFullYear(), m: d.getMonth() };
}

/* 固定 6 行 42 格：行数恒定，弹层高度不随月份跳，定位一次就够 */
const cells = computed(() => {
  const { y, m } = view.value;
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; /* 周一首列 */
  const out: { iso: string; d: number; inMonth: boolean; disabled: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const dt = new Date(y, m, 1 - lead + i);
    const iso = isoOf(dt);
    out.push({
      iso,
      d: dt.getDate(),
      inMonth: dt.getMonth() === m,
      disabled: iso < minIso.value || iso > maxIso.value
    });
  }
  return out;
});

const canPrev = computed(() => isoOf(new Date(view.value.y, view.value.m, 0)) >= minIso.value);
const canNext = computed(() => isoOf(new Date(view.value.y, view.value.m + 1, 1)) <= maxIso.value);

function focusCell() {
  popEl.value
    ?.querySelector<HTMLElement>('[data-focus="1"]')
    ?.focus({ preventScroll: true });
}
function clampIso(iso: string) {
  return iso < minIso.value ? minIso.value : iso > maxIso.value ? maxIso.value : iso;
}

async function openCal() {
  if (open.value) return;
  focusIso.value = clampIso(props.modelValue || today.value);
  syncView(focusIso.value);
  open.value = true;
  /* 同 Select：先定位、等 visibility 生效，否则 focus 落不到格子上 */
  await nextTick();
  place();
  await nextTick();
  focusCell();
}
function close(refocus = false) {
  if (!open.value) return;
  open.value = false;
  if (refocus) nextTick(() => triggerEl.value?.focus({ preventScroll: true }));
}
function toggle() {
  if (open.value) close(true);
  else void openCal();
}

function choose(iso: string) {
  if (iso < minIso.value || iso > maxIso.value) return;
  emit("update:modelValue", iso);
  focusIso.value = iso;
  close(true);
}

function shiftMonth(n: number) {
  const d = new Date(view.value.y, view.value.m + n, 1);
  view.value = { y: d.getFullYear(), m: d.getMonth() };
  /* 焦点落到新月份里同一日（不存在的日期取月末），再收进可选范围 */
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const day = Math.min(parseIso(focusIso.value).getDate(), lastDay);
  focusIso.value = clampIso(isoOf(new Date(d.getFullYear(), d.getMonth(), day)));
  void nextTick(() => {
    place();
    focusCell();
  });
}

function moveFocus(days: number) {
  const next = addDays(focusIso.value, days);
  if (next < minIso.value || next > maxIso.value) return;
  focusIso.value = next;
  const d = parseIso(next);
  if (d.getFullYear() !== view.value.y || d.getMonth() !== view.value.m) {
    view.value = { y: d.getFullYear(), m: d.getMonth() };
    void nextTick(() => {
      place();
      focusCell();
    });
  } else {
    void nextTick(focusCell);
  }
}

function onKey(e: KeyboardEvent) {
  switch (e.key) {
    case "ArrowLeft":
      e.preventDefault();
      moveFocus(-1);
      break;
    case "ArrowRight":
      e.preventDefault();
      moveFocus(1);
      break;
    case "ArrowUp":
      e.preventDefault();
      moveFocus(-7);
      break;
    case "ArrowDown":
      e.preventDefault();
      moveFocus(7);
      break;
    case "PageUp":
      e.preventDefault();
      shiftMonth(-1);
      break;
    case "PageDown":
      e.preventDefault();
      shiftMonth(1);
      break;
    case "Home":
      e.preventDefault();
      moveFocus(-(((parseIso(focusIso.value).getDay() + 6) % 7)));
      break;
    case "End":
      e.preventDefault();
      moveFocus(6 - ((parseIso(focusIso.value).getDay() + 6) % 7));
      break;
    case "Enter":
    case " ":
      e.preventDefault();
      choose(focusIso.value);
      break;
    case "Escape":
      e.preventDefault();
      close(true);
      break;
    case "Tab":
      close(false);
      break;
  }
}

function onDocDown(e: PointerEvent) {
  if (!open.value) return;
  const t = e.target as Node;
  if (triggerEl.value?.contains(t) || popEl.value?.contains(t)) return;
  close(false);
}
function onDocKey(e: KeyboardEvent) {
  if (e.key === "Escape" && open.value) close(true);
}
onMounted(() => {
  document.addEventListener("pointerdown", onDocDown, true);
  document.addEventListener("keydown", onDocKey);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocDown, true);
  document.removeEventListener("keydown", onDocKey);
});
</script>

<template>
  <button
    ref="triggerEl"
    type="button"
    class="dp-trigger"
    :aria-label="ariaLabel || t('选择日期')"
    aria-haspopup="dialog"
    :aria-expanded="open"
    @click.stop="toggle"
    @keydown.arrow-down.prevent="openCal"
    @keydown.arrow-up.prevent="openCal"
  >
    <span class="dp-val">{{ modelValue }}</span>
    <svg
      class="sel-arw"
      :class="{ on: open }"
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  </button>

  <Teleport to="body">
    <div
      v-if="open"
      ref="popEl"
      class="pop-card dp-pop"
      role="dialog"
      :aria-label="t('选择日期')"
      :style="{
        left: anchor.left + 'px',
        top: anchor.top + 'px',
        visibility: anchor.ready ? 'visible' : 'hidden'
      }"
      @keydown="onKey"
    >
      <div class="dp-head">
        <button
          type="button"
          class="dp-nav"
          :disabled="!canPrev"
          :aria-label="t('上一月')"
          @click="shiftMonth(-1)"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <span class="dp-title">{{ monthLabel }}</span>
        <button
          type="button"
          class="dp-nav"
          :disabled="!canNext"
          :aria-label="t('下一月')"
          @click="shiftMonth(1)"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      <div class="dp-week" aria-hidden="true">
        <span v-for="w in WEEK" :key="w">{{ t(w) }}</span>
      </div>

      <div class="dp-grid" role="grid">
        <button
          v-for="c in cells"
          :key="c.iso"
          type="button"
          class="dp-day"
          :class="{ out: !c.inMonth, today: c.iso === today, cur: c.iso === modelValue }"
          :disabled="c.disabled"
          :tabindex="c.iso === focusIso ? 0 : -1"
          :data-focus="c.iso === focusIso ? '1' : undefined"
          :aria-label="c.iso"
          :aria-selected="c.iso === modelValue"
          @click="choose(c.iso)"
        >{{ c.d }}</button>
      </div>

      <div class="dp-foot">
        <button type="button" class="dp-today" @click="choose(today)">
          {{ t("今天") }} · {{ today.slice(5) }}
        </button>
      </div>
    </div>
  </Teleport>
</template>
