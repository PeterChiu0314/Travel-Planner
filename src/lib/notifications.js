import { toast } from "sonner";

export const notificationDuration = Object.freeze({ success: 3500, info: 5000, warning: 7000, error: Infinity });
export const syncToastId = "app-data-sync";
export const isConnectionError = error => /failed to fetch|fetch failed|networkerror|network request failed|load failed|connection (lost|reset)|^offline$/i.test(String(error?.message || error || ""));
export function friendlyError(error, online = globalThis.navigator?.onLine !== false) {
  if (isConnectionError(error)) return online ? "資料同步暫時失敗，請檢查連線或稍後重試。" : "網路連線中斷，尚未同步的內容已保留。";
  return String(error?.message || error || "操作未完成，請重試。");
}
let transportHandler = null;
function show(type, value, options = {}) {
  if (type === "error" && isConnectionError(value) && transportHandler && !options.id) return transportHandler(value);
  const message = type === "error" ? friendlyError(value) : String(value);
  return toast[type](message, { duration: notificationDuration[type], id: options.id || `${type}:${message}`, ...options });
}
export const notify = {
  success: (message, options) => show("success", message, options),
  info: (message, options) => show("info", message, options),
  warning: (message, options) => show("warning", message, options),
  error: (error, options) => show("error", error, options),
  dismiss: id => toast.dismiss(id),
  clear: () => toast.dismiss(),
  onTransportError(handler) { transportHandler = handler; return () => { if (transportHandler === handler) transportHandler = null; }; },
};
