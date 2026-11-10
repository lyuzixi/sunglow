<script setup lang="ts">
/* 快照二维码弹层：纯前端用 qrcode-generator 画到 canvas，不依赖任何图片服务。
   扫码打开的就是当前快照链接（零额度、零重新取数），版式与站内弹层一致。 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import qrcode from "qrcode-generator";
import { t } from "../core/i18n";
import { state } from "../state";
import { deliverBlob, saveQrCard } from "../core/sharecard";

const props = defineProps<{ open: boolean; url: string }>();
const emit = defineEmits<{ (e: "close"): void; (e: "copy"): void }>();

const cv = ref<HTMLCanvasElement | null>(null);
const closeBtn = ref<HTMLButtonElement | null>(null);
const err = ref("");
const saving = ref(false);
let lastFocus: HTMLElement | null = null;

function draw() {
  err.value = "";
  const el = cv.value;
  if (!props.open || !el || !props.url) return;
  try {
    /* L 级容错：快照链接较长，用最低冗余换取最大容量；0 = 自动选版本 */
    const qr = qrcode(0, "L");
    qr.addData(props.url);
    qr.make();
    const n = qr.getModuleCount();
    const cell = 8, margin = 4;
    const px = (n + margin * 2) * cell;
    el.width = px; el.height = px;
    const c = el.getContext("2d");
    if (!c) throw new Error("canvas 2d unavailable");
    /* 固定深底浅码：扫码识别优先，不跟随主题反色 */
    c.fillStyle = "#ffffff"; c.fillRect(0, 0, px, px);
    c.fillStyle = "#0b1020";
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (qr.isDark(y, x)) c.fillRect((x + margin) * cell, (y + margin) * cell, cell, cell);
      }
    }
  } catch {
    err.value = t("二维码生成失败");
  }
}

function close() { emit("close"); }

/** 保存二维码：有当次结果时存完整卡片（照片 + 概率 + 质量），
    快照/无结果时退回存纯二维码；手机优先系统分享，桌面回退下载 */
async function saveQr() {
  const el = cv.value;
  if (!el || saving.value || err.value) return;
  saving.value = true;
  try {
    const r = state.result;
    if (r) {
      await saveQrCard(props.url, r);
    } else {
      const blob = await new Promise<Blob>((resolve, reject) => {
        el.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
      });
      await deliverBlob(blob, t("霞光档案") + "_" + t("快照二维码") + ".png");
    }
  } catch {
    alert(t("保存失败，请长按图片保存。"));
  } finally {
    saving.value = false;
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && props.open) close();
}

watch(() => props.open, (open) => {
  if (open) {
    lastFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    nextTick(() => { draw(); closeBtn.value?.focus(); });
  } else {
    document.body.style.overflow = "";
    lastFocus?.focus?.();
    lastFocus = null;
  }
}, { immediate: true });

watch(() => props.url, () => {
  if (props.open) nextTick(draw);
}, { immediate: true });

onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  document.body.style.overflow = "";
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="qr-mask" @click.self="close">
      <div class="qr-box" role="dialog" aria-modal="true" :aria-label="t('快照二维码')">
        <h3>{{ t("扫码查看快照") }}</h3>
        <canvas ref="cv" class="qr-cv" />
        <p v-if="err" class="qr-err">{{ err }}</p>
        <p class="qr-url">{{ url }}</p>
        <div class="qr-acts">
          <button class="btn btn-primary" @click="emit('copy')">{{ t("复制链接") }}</button>
          <button class="btn btn-ghost" :disabled="saving || !!err" :aria-busy="saving" @click="saveQr">
            {{ saving ? t("保存中…") : t("保存二维码图片") }}
          </button>
          <button ref="closeBtn" class="btn btn-ghost" @click="close">{{ t("关闭") }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.qr-mask {
  position: fixed;
  inset: 0;
  /* 压过顶栏（120）：二维码弹层打开时整屏都应被遮罩覆盖 */
  z-index: 300;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(4, 7, 14, 0.66);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
.qr-box {
  width: min(92vw, 360px);
  max-height: 92vh;
  overflow: auto;
  padding: 20px 20px 16px;
  border: 1px solid var(--stroke-2);
  border-radius: var(--r-lg);
  background: var(--bg-card-solid);
  box-shadow: var(--card-sh);
  text-align: center;
}
.qr-box h3 {
  margin: 0 0 14px;
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--tx-1);
}
.qr-cv {
  width: min(62vw, 248px);
  height: auto;
  border-radius: 12px;
  background: #fff;
  image-rendering: pixelated;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}
.qr-err {
  margin: 12px 0 0;
  font-size: var(--fs-small);
  color: var(--q-bad);
}
.qr-url {
  margin: 12px 0 14px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--tx-3);
  word-break: break-all;
  max-height: 3.6em;
  overflow: auto;
}
.qr-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}
.qr-acts .btn { min-height: 40px; }
@media (pointer: coarse) {
  .qr-acts .btn { min-height: 44px; }
}
</style>
