/* 单文件构建用的最小全局工具。
   clamp / round 由 model.js 提供（构建顺序在 meteo 之前），这里只补 pad2。 */
const pad2 = n => String(n).padStart(2, "0");
