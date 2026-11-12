<script setup lang="ts">
/* =========================================================================
   Android 内测包入口浮层（2026-11-12 拍板）
   · Android 手机：fixed 顶部横幅，贴在 --topbar-h 下沿，不进文档流 —— 不碰
     顶栏 refit() 四态、scroll-margin-top 与 scroll-spy 判定线。
   · 桌面：右下角可收起的小二维码卡；抬高到 88px 是为了避开 PwaUpdatePrompt
     底部胶囊（bottom 16px / z-index 85），分享底部面板（z-index 117/118）
     打开时天然盖住本卡，不需要互斥状态。
   · iOS 等其它手机不弹；不做 standalone 抑制（用户明确要求全站都弹）。
   · 「不再提示」是永久标记，两端共用 SUNGLOW.v2.apkBannerDismissed；
     关掉后仍可从抽屉 / 导航 / 页脚 / 关于页进入 download.html。
   ========================================================================= */
import { nextTick, onMounted, ref } from "vue";
import qrcode from "qrcode-generator";
import { t } from "../core/i18n";
import { APK_URL, APK_DISMISS_KEY, DOWNLOAD_PAGE } from "../core/download";

type Kind = "" | "android" | "desktop";
const kind = ref<Kind>("");
const dismissed = ref(false);
const collapsed = ref(false);
const cv = ref<HTMLCanvasElement | null>(null);

function drawQr() {
  const el = cv.value;
  if (!el) return;
  try {
    /* 与 ShareQrDialog.vue 同参数：L 级容错、白底深码，扫码识别优先 */
    const qr = qrcode(0, "L");
    qr.addData(APK_URL);
    qr.make();
    const n = qr.getModuleCount();
    const cell = 3, margin = 2;
    const px = (n + margin * 2) * cell;
    el.width = px; el.height = px;
    const c = el.getContext("2d");
    if (!c) return;
    c.fillStyle = "#ffffff"; c.fillRect(0, 0, px, px);
    c.fillStyle = "#0b1020";
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (qr.isDark(y, x)) c.fillRect((x + margin) * cell, (y + margin) * cell, cell, cell);
      }
    }
  } catch { /* 二维码画不出来不影响文字链接 */ }
}

function dismiss() {
  dismissed.value = true;
  try { localStorage.setItem(APK_DISMISS_KEY, "1"); } catch { /* 隐私模式 */ }
}

onMounted(() => {
  const ua = navigator.userAgent || "";
  const mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  const android = /Android/i.test(ua) && mobile;
  kind.value = android ? "android" : mobile ? "" : "desktop";
  try { dismissed.value = localStorage.getItem(APK_DISMISS_KEY) === "1"; } catch { /* 隐私模式 */ }
  if (kind.value === "desktop") void nextTick(drawQr);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="kind === 'android' && !dismissed" class="apk-bar" role="status">
      <svg class="apk-ico" viewBox="0 0 24 24" width="15" height="15" fill="none"
           stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3v11m0 0 4-4m-4 4-4-4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </svg>
      <span class="apk-tx">{{ t("Android 内测版已开放下载") }}</span>
      <a class="apk-go" :href="DOWNLOAD_PAGE">{{ t("下载 App") }}</a>
      <button class="apk-x" :aria-label="t('不再提示')" :title="t('不再提示')" @click="dismiss">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>

    <div v-else-if="kind === 'desktop' && !dismissed" class="apk-card" :class="{ mini: collapsed }">
      <div class="apk-card-head">
        <span class="apk-card-tx">{{ t("扫码下载 Android 内测版") }}</span>
        <button class="apk-mini" :aria-label="t(collapsed ? '展开二维码' : '收起二维码')"
                :title="t(collapsed ? '展开二维码' : '收起二维码')" @click="collapsed = !collapsed">
          <svg v-if="!collapsed" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
          <svg v-else viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button class="apk-mini" :aria-label="t('不再提示')" :title="t('不再提示')" @click="dismiss">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <div v-show="!collapsed" class="apk-card-body">
        <canvas ref="cv" class="apk-qr" role="img" :aria-label="t('下载链接二维码')" />
        <a class="apk-link" :href="DOWNLOAD_PAGE">{{ t("查看下载页与安装说明") }} ↗</a>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.apk-bar {
  position: fixed;
  top: calc(var(--topbar-h, 63px) + 8px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: calc(100vw - 24px);
  padding: 8px 8px 8px 14px;
  border: 1px solid var(--stroke-2);
  border-radius: var(--r-full);
  background: var(--bg-card-solid);
  box-shadow: var(--card-sh);
  color: var(--tx-1);
  overflow: hidden;
}
.apk-bar::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 2px;
  background: var(--spectrum);
}
.apk-ico { flex: none; color: var(--tx-2); }
.apk-tx { font-size: var(--fs-small); white-space: nowrap; }
.apk-go {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 0 14px;
  border-radius: var(--r-full);
  background: var(--spectrum);
  color: var(--tx-inv);
  font-family: var(--font-body);
  font-size: var(--fs-tiny);
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}
.apk-go:hover { text-decoration: none; }
.apk-x {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px; height: 32px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--tx-2);
  cursor: pointer;
}
.apk-x:hover { color: var(--tx-1); background: var(--bg-glass); }
.apk-card {
  position: fixed;
  right: 16px;
  bottom: calc(88px + env(safe-area-inset-bottom, 0px));
  z-index: 80;
  width: 190px;
  padding: 10px 10px 12px;
  border: 1px solid var(--stroke-2);
  border-radius: var(--r-md);
  background: var(--bg-card-solid);
  box-shadow: var(--card-sh);
  color: var(--tx-1);
}
.apk-card.mini { width: auto; padding: 6px 8px; }
.apk-card-head { display: flex; align-items: center; gap: 2px; }
.apk-card-tx { flex: 1; font-size: var(--fs-tiny); color: var(--tx-2); line-height: 1.4; }
.apk-card.mini .apk-card-tx { display: none; }
.apk-mini {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px; height: 26px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--tx-2);
  cursor: pointer;
}
.apk-mini:hover { color: var(--tx-1); background: var(--bg-glass); }
.apk-card-body { margin-top: 8px; }
.apk-qr {
  display: block;
  width: 112px; height: 112px;
  margin: 0 auto 8px;
  padding: 4px;
  border-radius: 8px;
  background: #ffffff;
}
.apk-link {
  display: block;
  text-align: center;
  font-size: var(--fs-tiny);
  color: var(--tx-2);
  text-decoration: none;
}
.apk-link:hover { color: var(--tx-1); text-decoration: none; }
.apk-go:focus-visible,
.apk-x:focus-visible,
.apk-mini:focus-visible,
.apk-link:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
@media (max-width: 520px) {
  .apk-bar {
    left: 10px; right: 10px;
    transform: none;
    width: auto; max-width: none;
    border-radius: var(--r-md);
    justify-content: space-between;
  }
  .apk-tx { white-space: normal; }
}
@media (pointer: coarse) {
  .apk-go { min-height: 44px; }
  .apk-x { width: 44px; height: 44px; }
  .apk-mini { width: 40px; height: 40px; }
}
</style>
