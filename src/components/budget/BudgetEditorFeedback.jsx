import { useEffect, useRef, useSyncExternalStore } from 'react';
import { notify } from '../../lib/notifications.js';

// One notification per failure episode, shared Sonner IDs, no field actions.
export function useBudgetFailureToast(error, id) {
  const seen = useRef('');
  useEffect(() => {
    if (error && error !== seen.current) { seen.current = error; notify.error(error, { id }); }
  }, [error, id]);
}

const noSubscribe = () => () => {}, noVersion = () => 0;
export default function BudgetEditorFeedback({ client, sourceClient, recordId }) {
  useSyncExternalStore(sourceClient?.subscribe || noSubscribe, sourceClient?.getVersion || noVersion);
  const state = client.status(), seen = useRef(new Set()), issued = useRef(new Set());
  const signature = JSON.stringify([state.verified, state.pending, state.failures]);
  useEffect(() => {
    for (const failure of state.failures || []) {
      const key = `${failure.key}:${failure.message}`;
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      issued.current.add(`budget-sync:${failure.key}`);
      const text = failure.conflict ? '內容已由其他成員更新，未儲存的變更已保留。請透過離開項目的確認流程處理。'
        : failure.invalid ? failure.message : failure.requiresDecision ? '無法儲存這次修改，變更已保留。請透過離開項目的確認流程處理。'
          : '暫時無法完成同步，變更已保留，系統會在連線恢復後重新確認。';
      notify.error(text, { id: `budget-sync:${failure.key}` });
    }
    if (!state.pending && state.verified) { for (const id of issued.current) notify.dismiss(id); issued.current.clear(); seen.current.clear(); }
  }, [signature]); // Only canonical controller transitions affect feedback.
  const pending = state.pending || sourceClient?.view('actual', recordId)?.active;
  const text = !state.verified ? '連線尚未確認，變更已保留。' : pending ? '尚有變更未同步。' : '';
  return text ? <p className="bw-sync-status" role="status" aria-label="預算同步狀態">{text}</p> : null;
}
