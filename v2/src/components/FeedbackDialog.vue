<script setup lang="ts">
/* 反馈弹层：直接引导到官方小红书。
   展示主页截图 + 一句联系说明 + 主页跳转按钮；不收集、不上传任何内容。 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { t } from "../core/i18n";
import { feedbackOpen, closeFeedback } from "../composables/useFeedback";
import xhsProfile from "../assets/xiaohongshu-profile.jpg";

const XHS_URL = "https://www.xiaohongshu.com/user/profile/65446e91000000000301c1cb";
const QR_FILE = "霞光档案_官方小红书.jpg";

const xhsLink = ref<HTMLAnchorElement | null>(null);
const saving = ref(false);
let lastFocus: HTMLElement | null = null;

/** 保存主页截图：手机优先系统分享（可直接存相册），桌面回退下载。 */
async function saveQr() {
  if (saving.value) return;
  saving.value = true;
  try {
    const res = await fetch(xhsProfile);
    const blob = await res.blob();
    const file = new File([blob], QR_FILE, { type: blob.type || "image/jpeg" });
    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
      share?: (data?: ShareData) => Promise<void>;
    };
    const coarse =
      typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
    let canShareFile = false;
    if (coarse && nav.share && nav.canShare) {
      try { canShareFile = nav.canShare({ files: [file] }); } catch { canShareFile = false; }
    }
    if (canShareFile) {
      try {
        await nav.share!({ files: [file], title: QR_FILE });
        return;
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        /* 其他错误（权限 / 策略拦截）继续走下载 */
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = QR_FILE;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch {
    alert(t("保存失败，请长按图片保存。"));
  } finally {
    saving.value = false;
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && feedbackOpen.value) closeFeedback();
}

watch(feedbackOpen, (open) => {
  if (open) {
    lastFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    nextTick(() => xhsLink.value?.focus());
  } else {
    document.body.style.overflow = "";
    lastFocus?.focus?.();
    lastFocus = null;
  }
});

onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  document.body.style.overflow = "";
});
</script>

<template>
  <Teleport to="body">
    <div v-if="feedbackOpen" class="fb-mask" @click.self="closeFeedback()">
      <div class="fb-box" role="dialog" aria-modal="true" :aria-label="t('反馈与交流')">
        <h3>{{ t("反馈与交流") }}</h3>
        <img class="fb-img" :src="xhsProfile" :alt="t('小红书主页截图')" />
        <p class="fb-lead">{{ t("反馈及交流请联系官方小红书") }}</p>
        <a
          ref="xhsLink"
          class="btn btn-primary fb-go"
          :href="XHS_URL"
          target="_blank"
          rel="noopener noreferrer"
        >{{ t("前往小红书主页") }}</a>
        <button
          class="btn btn-ghost fb-save"
          :disabled="saving"
          :aria-busy="saving"
          @click="saveQr"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 21h16" />
          </svg>
          {{ saving ? t("保存中…") : t("保存二维码图片") }}
        </button>
        <button class="btn btn-ghost fb-close" @click="closeFeedback()">{{ t("关闭") }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.fb-mask {
  position: fixed;
  inset: 0;
  /* 必须压过顶栏（120）与设置面板（200/260）：从设置菜单进入时，
     反馈弹层要完整盖住设置面板，而不是被它挡在下面 */
  z-index: 320;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(4, 7, 14, 0.66);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
.fb-box {
  width: min(94vw, 420px);
  max-height: 92vh;
  overflow: auto;
  padding: 20px;
  border: 1px solid var(--stroke-2);
  border-radius: var(--r-lg);
  background: var(--bg-card-solid);
  box-shadow: var(--card-sh);
  text-align: center;
}
.fb-box h3 {
  margin: 0 0 12px;
  font-size: var(--fs-body);
  color: var(--tx-1);
}
.fb-img {
  display: block;
  width: auto;
  max-width: 300px;
  max-height: 44vh;
  margin: 0 auto 14px;
  border: 1px solid var(--stroke);
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.16);
}
.fb-lead {
  margin: 0 0 14px;
  font-size: var(--fs-body);
  line-height: 1.65;
  color: var(--tx-1);
}
.fb-go {
  display: inline-flex;
  justify-content: center;
  min-width: 190px;
  text-decoration: none;
}
.fb-go:hover { text-decoration: none; }
.fb-save {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 190px;
  margin-top: 8px;
}
.fb-save:disabled {
  opacity: 0.6;
  cursor: default;
}
.fb-save svg { flex: none; }
.fb-close {
  display: inline-flex;
  justify-content: center;
  margin-top: 8px;
}
@media (pointer: coarse) {
  .fb-go, .fb-save, .fb-close { min-height: 44px; }
}
</style>
