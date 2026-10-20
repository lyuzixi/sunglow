/* Node ESM 解析钩子：把源码里的 "./x" 补成 "./x.ts"（工程内由打包器处理，探针直跑需要） */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (e) {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      for (const suffix of [".ts", "/index.ts"]) {
        try {
          return await next(specifier + suffix, context);
        } catch { /* 继续试 */ }
      }
    }
    throw e;
  }
}
