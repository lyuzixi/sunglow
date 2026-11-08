/* 反馈弹层的全局开关：页脚、目录抽屉、设置面板与关于页共用同一实例 */
import { ref } from "vue";

export const feedbackOpen = ref(false);

export function openFeedback() {
  feedbackOpen.value = true;
}

export function closeFeedback() {
  feedbackOpen.value = false;
}
