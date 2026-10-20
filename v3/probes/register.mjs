/* 注册 TS 解析钩子（node --import ./probes/register.mjs） */
import { register } from "node:module";
register("./ts-resolver.mjs", import.meta.url);
