/* =========================================================================
   GLOWCAST v2 · 三语词典（简 / 繁 / 英）
   键 = 简体中文原文。词条只写繁/英两份；简体直接返回键本身。
   与V1 _pi18n.js 独立（v2 界面文案更精简，不搬运V1全量词典）。
   ========================================================================= */

export type Lang = "zh" | "hant" | "en";

export const LANGS: Lang[] = ["zh", "hant", "en"];
export const LANG_NAMES: Record<Lang, string> = {
  zh: "简体中文", hant: "繁體中文", en: "English"
};
export const LANG_SHORT: Record<Lang, string> = {
  zh: "简", hant: "繁", en: "EN"
};

type Dict = Record<string, string>;

const HANT: Dict = {
  "霞光预报": "霞光預報",
  "大气光谱观测站": "大氣光譜觀測站",
  "晨光实验室": "晨光實驗室",
  "出现概率": "出現概率",
  "观赏质量": "觀賞質量",
  "多模型综合": "多模型綜合",
  "晚霞": "晚霞",
  "朝霞": "朝霞",
  "日落": "日落",
  "日出": "日出",
  "今天": "今天",
  "明天": "明天",
  "计算": "計算",
  "重新计算": "重新計算",
  "地点": "地點",
  "搜索城市": "搜尋城市",
  "使用我的位置": "使用我的位置",
  "结论": "結論",
  "天色带": "天色帶",
  "七日趋势": "七日趨勢",
  "观测场": "觀測場",
  "模式对比": "模式對比",
  "影响因素": "影響因素",
  "实况校准": "實況校準",
  "使用教程": "使用教程",
  "返回首页": "返回首頁",
  "页面未找到": "頁面未找到",
  "概率": "概率",
  "质量": "質量",
  "等级": "等級",
  "优秀": "優秀",
  "良好": "良好",
  "一般": "一般",
  "较差": "較差",
  "可信度": "可信度",
  "高": "高",
  "中": "中",
  "低": "低",
  "云量": "雲量",
  "云底高度": "雲底高度",
  "能见度": "能見度",
  "气溶胶": "氣溶膠",
  "持续时间": "持續時間",
  "深色": "深色",
  "浅色": "淺色",
  "跟随系统": "跟隨系統",
  "语言": "語言",
  "主题": "主題",
  "分享快照": "分享快照",
  "复制链接": "複製連結",
  "已复制": "已複製",
  "低云": "低雲",
  "中云": "中雲",
  "高云": "高雲",
  "云型": "雲型",
  "查看全部": "查看全部",
  "收起": "收起",
  "排名": "排名",
  "城市": "城市",
  "距离": "距離",
  "维度": "維度",
  "图例": "圖例",
  "模型": "模型",
  "综合": "綜合",
  "样本不足": "樣本不足",
  "标注实况": "標註實況",
  "看到了": "看到了",
  "没有看到": "沒有看到",
  "无法判断": "無法判斷",
  "清除全部": "清除全部",
  "关闭校准": "關閉校準",
  "开启校准": "開啟校準",
  "设置": "設置",
  "关于": "關於",
  "V1": "V1",
  "切换到V1": "切換到V1",
  "切换到Skyglow": "切換到Skyglow",
  "预报": "預報",
  "数据源": "數據源",
  "非商业用途": "非商業用途",
  "分钟": "分鐘",
  "小时": "小時",
  "天": "天",
  "公里": "公里",
  "米": "米",
  "千米": "千米",
  "摄氏度": "攝氏度",
  "百分比": "百分比",
  "开始观测": "開始觀測",
  "了解原理": "了解原理",
  "沉浸式预报体验": "沉浸式預報體驗",
  "光谱分析": "光譜分析",
  "此刻": "此刻",
  "晨光始": "晨光始",
  "昏影终": "昏影終",
  "民用": "民用",
  "航海": "航海",
  "天文": "天文",
  "太阳高度角": "太陽高度角",
  "日出日落线": "日出日落線",
  "本地时间": "本地時間",
  "刷新数据": "刷新數據",
  "加载中": "載入中",
  "暂无数据": "暫無數據",
  "网络错误": "網絡錯誤",
  "重试": "重試",
  "朝向": "朝向",
  "方位角": "方位角",
  "高度角": "高度角",
  "预报准据": "預報準據",
  "算法说明": "算法說明",
  "目录": "目錄",
  "关闭": "關閉",
  "打开菜单": "打開選單"
};

const EN: Dict = {
  "霞光预报": "Glow Forecast",
  "大气光谱观测站": "Atmospheric Spectrum Observatory",
  "晨光实验室": "Dawn Light Laboratory",
  "出现概率": "Probability",
  "观赏质量": "Viewing Quality",
  "多模型综合": "Multi-Model Consensus",
  "晚霞": "Sunset Glow",
  "朝霞": "Sunrise Glow",
  "日落": "Sunset",
  "日出": "Sunrise",
  "今天": "Today",
  "明天": "Tomorrow",
  "计算": "Forecast",
  "重新计算": "Recalculate",
  "地点": "Location",
  "搜索城市": "Search city",
  "使用我的位置": "Use my location",
  "结论": "Verdict",
  "天色带": "Sky Band",
  "七日趋势": "7-Day Trend",
  "观测场": "Observation Field",
  "模式对比": "Model Comparison",
  "影响因素": "Contributing Factors",
  "实况校准": "Field Calibration",
  "使用教程": "Tutorial",
  "返回首页": "Back to Home",
  "页面未找到": "Page Not Found",
  "概率": "Prob.",
  "质量": "Quality",
  "等级": "Grade",
  "优秀": "Excellent",
  "良好": "Good",
  "一般": "Fair",
  "较差": "Poor",
  "可信度": "Confidence",
  "高": "High",
  "中": "Medium",
  "低": "Low",
  "云量": "Cloud Cover",
  "云底高度": "Cloud Base",
  "能见度": "Visibility",
  "气溶胶": "Aerosol",
  "持续时间": "Duration",
  "深色": "Dark",
  "浅色": "Light",
  "跟随系统": "System",
  "语言": "Language",
  "主题": "Theme",
  "分享快照": "Share Snapshot",
  "复制链接": "Copy Link",
  "已复制": "Copied",
  "低云": "Low Cloud",
  "中云": "Mid Cloud",
  "高云": "High Cloud",
  "云型": "Cloud Type",
  "查看全部": "Show All",
  "收起": "Collapse",
  "排名": "Rank",
  "城市": "City",
  "距离": "Distance",
  "维度": "Dimension",
  "图例": "Legend",
  "模型": "Model",
  "综合": "Consensus",
  "样本不足": "Not enough samples",
  "标注实况": "Log Observation",
  "看到了": "Saw it",
  "没有看到": "Didn't see it",
  "无法判断": "Can't tell",
  "清除全部": "Clear All",
  "关闭校准": "Disable Calibration",
  "开启校准": "Enable Calibration",
  "设置": "Settings",
  "关于": "About",
  "V1": "V1",
  "切换到V1": "Switch to V1",
  "切换到Skyglow": "Switch to Skyglow",
  "预报": "Forecast",
  "数据源": "Data Source",
  "非商业用途": "Non-commercial use",
  "分钟": "min",
  "小时": "hours",
  "天": "days",
  "公里": "km",
  "米": "m",
  "千米": "km",
  "摄氏度": "°C",
  "百分比": "%",
  "开始观测": "Start Observing",
  "了解原理": "How It Works",
  "沉浸式预报体验": "Immersive forecast experience",
  "光谱分析": "Spectral Analysis",
  "此刻": "Now",
  "晨光始": "Dawn begins",
  "昏影终": "Dusk ends",
  "民用": "Civil",
  "航海": "Nautical",
  "天文": "Astronomical",
  "太阳高度角": "Solar Altitude",
  "日出日落线": "Terminator Line",
  "本地时间": "Local Time",
  "刷新数据": "Refresh Data",
  "加载中": "Loading",
  "暂无数据": "No data",
  "网络错误": "Network error",
  "重试": "Retry",
  "朝向": "Toward",
  "方位角": "Azimuth",
  "高度角": "Altitude",
  "预报准据": "Forecast Basis",
  "算法说明": "Methodology",
  "目录": "Contents",
  "关闭": "Close",
  "打开菜单": "Open menu"
};

import { HANT_EXTRA, EN_EXTRA } from "./i18n-extra";

/* 词典增量合入（地图/设置/趋势/因素等新组件词条） */
Object.assign(HANT, HANT_EXTRA);
Object.assign(EN, EN_EXTRA);

const DICTS: Record<Exclude<Lang, "zh">, Dict> = { hant: HANT, en: EN };

let curLang: Lang = "zh";

export function setLang(l: Lang): void {
  curLang = LANGS.includes(l) ? l : "zh";
}
export function getLang(): Lang {
  return curLang;
}

/** 三语取词：简体原文即键 */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = curLang === "zh" ? key : DICTS[curLang][key] ?? key;
  if (vars) {
    for (const k of Object.keys(vars)) {
      s = s.replace(new RegExp("\\{" + k + "\\}", "g"), String(vars[k]));
    }
  }
  return s;
}

/** 缓存年龄文案：「刚刚 / N 分钟 / N 小时」。地图、趋势、结论卡三处共用同一口径。 */
export function ageText(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 1) return t("刚刚");
  if (m < 60) return t("{n} 分钟", { n: m });
  return t("{n} 小时", { n: Math.floor(m / 60) });
}

/** 从浏览器语言探测 */
export function detectLang(): Lang {
  if (typeof navigator === "undefined") return "zh";
  const n = (navigator.language || "").toLowerCase();
  if (n.startsWith("zh-tw") || n.startsWith("zh-hk") || n.startsWith("zh-hant")) return "hant";
  if (n.startsWith("zh")) return "zh";
  if (n.startsWith("en")) return "en";
  return "zh";
}
