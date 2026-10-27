/* =========================================================================
   锚定弹层：Teleport 到 body + fixed 定位 + 视口内 clamp
   自绘下拉与月历共用这一套（原生 select 的弹层位置由浏览器决定，这里全部自己算）。

   为什么 Teleport：观测场面板有可能进全屏（.map-panel.fs 的 z-index 是 2100），
   章节容器 .reveal 又带 transform —— 留在原地会被层叠与包含块两头夹住。
   落到 body 上再按触发器坐标定位，这两种情况都不影响。
   ========================================================================= */
import { nextTick, onBeforeUnmount, ref, watch, type Ref } from "vue";

export interface Anchor {
  left: number;
  top: number;
  /** 触发器宽度，作为弹层最小宽度（下拉不该比触发器还窄） */
  width: number;
  ready: boolean;
  /** 是否向上翻 */
  up: boolean;
}

const MARGIN = 12; /* 距视口边缘 */
const GAP = 6; /* 距触发器 */

export function useAnchoredPopup(
  open: Ref<boolean>,
  trigger: Ref<HTMLElement | null>,
  pop: Ref<HTMLElement | null>,
  align: () => "start" | "end" = () => "start"
) {
  const anchor = ref<Anchor>({ left: 0, top: 0, width: 0, ready: false, up: false });

  function place() {
    const t = trigger.value?.getBoundingClientRect();
    const p = pop.value?.getBoundingClientRect();
    if (!t || !p) return;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;

    let left = align() === "end" ? t.right - p.width : t.left;
    left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, vw - MARGIN - p.width));

    let top = t.bottom + GAP;
    let up = false;
    if (top + p.height > vh - MARGIN) {
      const flipped = t.top - GAP - p.height;
      if (flipped >= MARGIN) {
        top = flipped;
        up = true;
      }
    }
    /* 最后再夹一道：触发器本身在视口外（自动化点击、锚点跳转途中）时，
       上面两条都会把弹层留在视口外，这里统一收进可视区。 */
    top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, vh - MARGIN - p.height));

    anchor.value = {
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(t.width),
      ready: true,
      up
    };
  }

  let raf = 0;
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      place();
    });
  }

  /* 打开后先量一次：nextTick 在浏览器绘制前，用户看不到未定位的闪动。
     量之前弹层是 visibility:hidden，占位尺寸仍然可测。 */
  watch(open, async (v) => {
    anchor.value = { ...anchor.value, ready: false };
    if (!v) return;
    await nextTick();
    place();
  });

  /* 滚动/改尺寸时跟着触发器走；capture 才能收到内部滚动容器的滚动事件 */
  function onMove() {
    if (open.value) schedule();
  }
  window.addEventListener("scroll", onMove, true);
  window.addEventListener("resize", onMove);
  onBeforeUnmount(() => {
    window.removeEventListener("scroll", onMove, true);
    window.removeEventListener("resize", onMove);
    if (raf) cancelAnimationFrame(raf);
  });

  return { anchor, place };
}
