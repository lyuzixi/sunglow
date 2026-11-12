/* =========================================================================
   分享中心动作注册表（2026-11-12 · 方案 A「一处总览」）
   ---------------------------------------------------------------------------
   四张图片产物原本各由自己那张卡的按钮生成：结论卡 / 竖版故事卡在
   ShareDropdown，趋势图在 TrendSection，观测场图在 MapView。观测场卡要的
   MapCardOpts（当前点集、屏幕截图、色面缓存、方位角…）只存在于 MapView 里，
   底部板块不可能重建一份。

   所以八个磁贴只负责派发，不复制取数口径、不重复算数：各卡挂载时把自己
   那个「保存图片」函数登记进来，磁贴点击时原样调用，产物与就地保存逐像素同源。
   ready() 让底部磁贴能正确禁用并给出原因，绝不因为点了一下就自动取数。
   ========================================================================= */
import { inject, onBeforeUnmount, onMounted, provide, reactive } from "vue";

export type ShareImageKey = "card" | "story" | "trend" | "map";
/** 底部八个磁贴：前四个是图片产物，后四个是链接 / 提醒动作 */
export type ShareTileKey = ShareImageKey | "link" | "qr" | "caption" | "ics";
export type ShareTileItem = {
  k: ShareTileKey;
  n: string;
  s: string;
  ready: boolean;
  main?: boolean;
  /** 禁用原因（放 title），不给「点了没反应」留空 */
  hint?: string;
};

export type ShareImageEntry = {
  /** 真正出图（就地按钮的同一个函数） */
  save: () => void | Promise<void>;
  /** 数据是否就绪：决定磁贴禁用态 */
  ready: () => boolean;
};

export type ShareHub = {
  entries: Partial<Record<ShareImageKey, ShareImageEntry>>;
  register: (key: ShareImageKey, entry: ShareImageEntry) => void;
  unregister: (key: ShareImageKey) => void;
};

const HUB_KEY = "sunglow.shareHub";

/** 在 HomeView 顶层调用一次 */
export function provideShareHub(): ShareHub {
  const entries = reactive<Partial<Record<ShareImageKey, ShareImageEntry>>>({});
  const hub: ShareHub = {
    entries,
    register(key, entry) { entries[key] = entry; },
    unregister(key) { delete entries[key]; }
  };
  provide(HUB_KEY, hub);
  return hub;
}

/** 子组件：挂载时登记自己那张图，卸载时注销（快照模式下组件不渲染也不会误登记） */
export function useShareImage(key: ShareImageKey, entry: ShareImageEntry): void {
  const hub = inject<ShareHub | null>(HUB_KEY, null);
  if (!hub) return; // 单独挂载组件做预览时不报错
  onMounted(() => hub.register(key, entry));
  onBeforeUnmount(() => hub.unregister(key));
}
