<script setup lang="ts">
/* 自绘下拉：替代原生 <select>。
   原生弹层由浏览器绘制（底色、行高、选中态、深色适配全看浏览器），
   所以底色/文字色/键盘/定位这里全部自己给。 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useAnchoredPopup } from "../core/popover";

interface SelOpt {
  v: string;
  label: string;
  disabled?: boolean;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: SelOpt[];
    ariaLabel: string;
    align?: "start" | "end";
  }>(),
  { align: "start" }
);
const emit = defineEmits<{ "update:modelValue": [string] }>();

const open = ref(false);
const triggerEl = ref<HTMLButtonElement | null>(null);
const popEl = ref<HTMLElement | null>(null);
const activeIdx = ref(0);
const { anchor, place } = useAnchoredPopup(open, triggerEl, popEl, () => props.align);

const curIdx = computed(() => props.options.findIndex((o) => o.v === props.modelValue));
const curLabel = computed(() => (curIdx.value >= 0 ? props.options[curIdx.value].label : ""));

function items(): HTMLButtonElement[] {
  return popEl.value
    ? Array.from(popEl.value.querySelectorAll<HTMLButtonElement>(".pop-item"))
    : [];
}
function focusActive() {
  const els = items();
  if (!els.length) return;
  const i = Math.min(Math.max(0, activeIdx.value), els.length - 1);
  activeIdx.value = i;
  els[i].focus({ preventScroll: true });
}
async function openList() {
  if (open.value) return;
  activeIdx.value = Math.max(0, curIdx.value);
  open.value = true;
  /* 先量定位、等样式落到 DOM（含 visibility:visible）再聚焦：
     visibility:hidden 的元素拿不到焦点，抢在前面调用会静默失败。 */
  await nextTick();
  place();
  await nextTick();
  focusActive();
}
function close(refocus = false) {
  if (!open.value) return;
  open.value = false;
  if (refocus) nextTick(() => triggerEl.value?.focus({ preventScroll: true }));
}
function toggle() {
  if (open.value) close(true);
  else void openList();
}
function pickAt(i: number) {
  const o = props.options[i];
  if (!o || o.disabled) return;
  emit("update:modelValue", o.v);
  close(true);
}
function step(delta: number) {
  let i = activeIdx.value + delta;
  while (i >= 0 && i < props.options.length && props.options[i].disabled) i += delta;
  if (i < 0 || i >= props.options.length) return;
  activeIdx.value = i;
  focusActive();
}

/* 触发器：↑↓ 直接打开（原生 select 的手感），Enter/Space 走按钮默认 click */
function onTriggerKey(e: KeyboardEvent) {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    void openList();
  }
}
function onListKey(e: KeyboardEvent) {
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      step(1);
      break;
    case "ArrowUp":
      e.preventDefault();
      step(-1);
      break;
    case "Home":
      e.preventDefault();
      activeIdx.value = 0;
      focusActive();
      break;
    case "End":
      e.preventDefault();
      activeIdx.value = props.options.length - 1;
      focusActive();
      break;
    case "Enter":
    case " ":
      e.preventDefault();
      pickAt(activeIdx.value);
      break;
    case "Escape":
      e.preventDefault();
      close(true);
      break;
    case "Tab":
      close(false); /* 让 Tab 正常往下一个控件走 */
      break;
  }
}

/* 点外部关闭。用 pointerdown 捕获：点另一个下拉的触发器时，
   先让前一个关掉，再让它自己打开，不会两个同时挂着。 */
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
    class="sel"
    :aria-label="ariaLabel"
    aria-haspopup="listbox"
    :aria-expanded="open"
    @click.stop="toggle"
    @keydown="onTriggerKey"
  >
    <span class="sel-txt">{{ curLabel }}</span>
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
      class="pop-card sel-pop"
      role="listbox"
      :aria-label="ariaLabel"
      :style="{
        left: anchor.left + 'px',
        top: anchor.top + 'px',
        minWidth: anchor.width + 'px',
        visibility: anchor.ready ? 'visible' : 'hidden'
      }"
      @keydown="onListKey"
    >
      <button
        v-for="(o, i) in options"
        :key="o.v"
        type="button"
        role="option"
        class="pop-item"
        :aria-selected="o.v === modelValue"
        :disabled="o.disabled"
        :tabindex="i === activeIdx ? 0 : -1"
        @click="pickAt(i)"
        @mouseenter="activeIdx = i"
      >
        <span class="pop-name">{{ o.label }}</span>
        <span v-if="o.v === modelValue" class="pop-tick" aria-hidden="true">✓</span>
      </button>
    </div>
  </Teleport>
</template>
