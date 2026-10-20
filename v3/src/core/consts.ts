/* =========================================================================
   GLOWCAST v3「追光航志」· 共享常量
   口径来源：原版 _p4.js / _p5.js / _p6.js —— 与 v3/vendor/src-verbatim 对照保持一致。
   存储命名空间 glowcast.v3.*（与原版 sunsetbot.*、v2 glowcast.v2.* 三方隔离）。
   ========================================================================= */

/** 沿日出/日落方位的样带距离（km，17 点）—— 与原版 TRANSECT 逐字一致 */
export const TRANSECT = [0, 25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400];

export const MODEL_NAME = { gfs: "gfs_seamless", ec: "ecmwf_ifs025" };
export const MODEL_LABEL: Record<string, string> = { gfs: "GFS 模式", ec: "ECMWF-IFS 模式" };

/** 单点/样带取数字段集（14 项，与原版 F_VARS 一致） */
export const F_VARS = [
  "temperature_2m", "dew_point_2m", "relative_humidity_2m", "cloud_cover_low",
  "cloud_cover_mid", "cloud_cover_high", "visibility", "pressure_msl", "wind_speed_10m",
  "wind_direction_10m", "boundary_layer_height", "freezing_level_height", "precipitation", "cape"
];

/** 地图批量采样字段集（10 项，落在计费下限档，含露点 —— 与原版 F_MAP_VARS 一致） */
export const F_MAP_VARS = [
  "temperature_2m", "dew_point_2m", "relative_humidity_2m",
  "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "visibility",
  "pressure_msl", "boundary_layer_height", "freezing_level_height"
];

export const AQ_VARS = ["aerosol_optical_depth", "pm2_5", "pm10", "dust"];

/** 局部观测场网格（原版 B13：500 km 半径 / 120 km 间距 → 约 57 点） */
export const MAP_RADIUS_KM = 500;
export const MAP_GRID_KM = 120;
/** IDW 最远可信距离（样带外点云场插值用） */
export const FIELD_REACH_KM = 425;

/** 机会日历窗口（天）—— 原版 TREND_DAYS=10，V3 主链路取 7 天 */
export const TREND_DAYS = 7;

/** 缓存 TTL / 容量（沿原版：3 小时；地图 LRU 6 个日期条目，趋势 3 条） */
export const CACHE_TTL = 3 * 3600000;
export const MAP_CACHE_MAX = 6;
export const TREND_CACHE_MAX = 3;
export const POINT_CACHE_MAX = 4;

/** 存储键族（版本号写进键里；升版本旧值自然作废） */
export const PREF_KEY = "glowcast.v3.pref";
export const CALIB_KEY = "glowcast.v3.calib";
export const MAP_CACHE_PREFIX = "glowcast.v3.map.v1.";
export const MAP_CACHE_FAMILY = "glowcast.v3.map.";
export const TREND_CACHE_PREFIX = "glowcast.v3.trend.v1.";
export const TREND_CACHE_FAMILY = "glowcast.v3.trend.";
export const POINT_CACHE_PREFIX = "glowcast.v3.point.v1.";
export const POINT_CACHE_FAMILY = "glowcast.v3.point.";

/** 取数超时预算（ms，V2 约定沿用） */
export const BUDGET_POINT = 9000;
export const BUDGET_TRANSECT = 6000;
