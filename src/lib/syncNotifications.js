import { friendlyError, isConnectionError, notificationDuration, syncToastId } from "./notifications.js";

// Observes existing authoritative reads. No requests, subscriptions or polling.
export function createSyncNotifications(notify, online = () => navigator.onLine !== false) {
  const failures = new Map();
  let account = null, trip = null, signature = "", retry = () => {}, revision = 0;
  function render() {
    if (!failures.size) return;
    const offline = !online();
    const messages = [...failures.values()].map(failure => failure.error);
    const network = offline || messages.some(isConnectionError);
    const message = offline ? "網路連線中斷，尚未同步的內容已保留。" : network ? "資料同步暫時失敗，請檢查連線或稍後重試。" : friendlyError(messages[0]);
    const description = [...failures.values()].some(failure => failure.cached) ? "目前顯示已快取資料，重新核對後會更新。" : undefined;
    const nextSignature = JSON.stringify([message, description]);
    if (signature === nextSignature) return;
    signature = nextSignature;
    notify[network ? "warning" : "error"](message, { id: syncToastId, description, duration: notificationDuration.error,
      action: { label: "重新嘗試", onClick: event => { event?.preventDefault(); signature = ""; void retry(); } } });
  }
  return {
    configure(userId, tripId) {
      if (account !== userId) { failures.clear(); signature = ""; notify.clear(); }
      else if (trip !== tripId) {
        for (const source of failures.keys()) if (!["trips", "connection", "action"].includes(source)) failures.delete(source);
        signature = ""; notify.dismiss(syncToastId);
      }
      account = userId; trip = tripId; render();
    },
    checkpoint: () => revision,
    failure(source, error, { cached = false } = {}) { failures.set(source, { error, cached, revision: ++revision }); render(); },
    verified(sources, readStartedAt = revision) {
      if (!online()) return;
      const hadFailures = failures.size > 0;
      for (const source of Array.isArray(sources) ? sources : [sources]) {
        if ((failures.get(source)?.revision || 0) <= readStartedAt) failures.delete(source);
      }
      if (!failures.size && hadFailures) {
        signature = "";
        notify.success("連線已恢復，資料已重新核對。", { id: syncToastId, action: undefined, description: undefined });
      } else render();
    },
    pending: () => [...failures.keys()],
    setRetry(callback) { retry = callback; },
    online: render,
    dispose() { failures.clear(); signature = ""; notify.dismiss(syncToastId); },
  };
}
