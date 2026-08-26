/**
 * 官方 0.84+ 的 tui 引用是惰性 Proxy（createInteractiveTuiReference）：
 * 函数属性每次 get 都返回新包装，执行时才解析到当前实现。
 * 通过它捕获 doRender/render/handleInput 会解析到自身形成无限递归，
 * 因此检测到惰性 Proxy 时必须跳过所有"捕获后包装"类 patch。
 */
export function isLazyProxyTui(tui: any): boolean {
  if (!tui || typeof tui !== "object") return false;
  const probe = tui.requestRender;
  return typeof probe === "function" && probe !== tui.requestRender;
}
