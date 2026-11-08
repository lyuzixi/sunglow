<script setup lang="ts">
/* PWA 更新提示条：
   · 首次安装：没有 controller，自动让新 SW 接管，不打扰用户
   · 后续版本：新 SW 停在 waiting，底部弹「新版本已就绪」，用户点刷新才激活
   · 每小时 / 回到前台 / 恢复联网时检查一次 sw.js（updateViaCache: none）
   版本字节由 publish-root 按 index.html 哈希重写，见 scripts/publish-root.mjs。 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import { t } from "../core/i18n";

const show = ref(false);
const busy = ref(false);
let reg: ServiceWorkerRegistration | null = null;
let dismissed = false;
let reloading = false;
let timer = 0;
let onCtrl: (() => void) | null = null;

function checkWaiting(r: ServiceWorkerRegistration) {
  if (!r.waiting) return;
  if (!navigator.serviceWorker.controller) {
    /* 首次安装：直接接管，不弹提示 */
    r.waiting.postMessage({ type: "SKIP_WAITING" });
    return;
  }
  if (!dismissed) show.value = true;
}

function watch(r: ServiceWorkerRegistration) {
  r.addEventListener("updatefound", () => {
    dismissed = false;
    const w = r.installing;
    if (!w) return;
    w.addEventListener("statechange", () => {
      if (w.state === "installed") checkWaiting(r);
    });
  });
  checkWaiting(r);
}

function refresh() {
  if (busy.value) return;
  busy.value = true;
  const w = reg?.waiting;
  if (!w) { location.reload(); return; }
  reloading = true;
  w.postMessage({ type: "SKIP_WAITING" });
  /* 兜底：个别浏览器不派发 controllerchange，1.2s 后主动刷新 */
  setTimeout(() => { if (reloading) location.reload(); }, 1200);
}

function later() {
  show.value = false;
  dismissed = true;
}

function maybeUpdate() {
  if (document.visibilityState !== "visible" || !navigator.onLine) return;
  reg?.update().catch(() => {});
}

onMounted(() => {
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
    .then((r) => { reg = r; watch(r); })
    .catch(() => { /* 不支持 / 注册失败：不影响主流程 */ });

  onCtrl = () => { if (reloading) location.reload(); };
  navigator.serviceWorker.addEventListener("controllerchange", onCtrl);
  timer = window.setInterval(maybeUpdate, 60 * 60 * 1000);
  document.addEventListener("visibilitychange", maybeUpdate);
  window.addEventListener("online", maybeUpdate);
});

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
  document.removeEventListener("visibilitychange", maybeUpdate);
  window.removeEventListener("online", maybeUpdate);
  if (onCtrl) navigator.serviceWorker.removeEventListener("controllerchange", onCtrl);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="pwa-bar" role="status" aria-live="polite">
      <span class="pwa-dot" aria-hidden="true" />
      <span class="pwa-tx">{{ t("新版本已就绪") }}</span>
      <button class="pwa-go" :disabled="busy" @click="refresh">{{ t("立即刷新") }}</button>
      <button class="pwa-later" @click="later">{{ t("稍后") }}</button>
    </div>
  </Teleport>
</template>

<style scoped>
.pwa-bar {
  position: fixed;
  left: 50%;
  bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  z-index: 85;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: calc(100vw - 24px);
  padding: 9px 10px 9px 16px;
  border: 1px solid var(--stroke-2);
  border-radius: var(--r-full);
  background: var(--bg-card-solid);
  box-shadow: var(--card-sh);
  color: var(--tx-1);
  /* 顶部光谱线是伪元素画的：裁到胶囊轮廓内，避免直线越过圆角两端 */
  overflow: hidden;
  animation: pwa-in 0.26s var(--ease-out) both;
}
.pwa-bar::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 2px;
  background: var(--spectrum);
}
@keyframes pwa-in {
  from { opacity: 0; transform: translate(-50%, 10px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
.pwa-dot {
  width: 8px; height: 8px; flex: none;
  border-radius: 50%;
  background: var(--spectrum);
  box-shadow: 0 0 0 4px var(--bg-glass);
}
.pwa-tx {
  font-size: var(--fs-small);
  white-space: nowrap;
}
.pwa-go {
  flex: none;
  height: 32px;
  padding: 0 14px;
  border: none;
  border-radius: var(--r-full);
  background: var(--spectrum);
  color: var(--tx-inv);
  font-family: var(--font-body);
  font-size: var(--fs-tiny);
  font-weight: 600;
}
.pwa-go:disabled { opacity: 0.6; }
.pwa-later {
  flex: none;
  height: 32px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: var(--r-full);
  background: transparent;
  color: var(--tx-2);
  font-family: var(--font-body);
  font-size: var(--fs-tiny);
}
.pwa-later:hover { color: var(--tx-1); border-color: var(--stroke-2); }
.pwa-go:focus-visible,
.pwa-later:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
@media (max-width: 520px) {
  .pwa-bar {
    left: 10px;
    right: 10px;
    transform: none;
    width: auto;
    max-width: none;
    justify-content: space-between;
    border-radius: var(--r-md);
    animation: none;
  }
  .pwa-tx { white-space: normal; }
}
@media (pointer: coarse) {
  .pwa-go, .pwa-later { min-height: 44px; height: 44px; }
}
</style>
