import { useEffect, useRef, useSyncExternalStore } from 'react';
import { notify } from '../../lib/notifications.js';
const budgetErrorToastId = 'budget-editor-error';

// One notification per failure episode, shared Sonner IDs, no field actions.
export function useBudgetFailureToast(error) {
  const seen = useRef('');
  useEffect(() => {
    if (error && error !== seen.current) { seen.current = error; notify.error(error, { id: budgetErrorToastId }); }
  }, [error]);
}

const noSubscribe = () => () => {}, noVersion = () => 0;
export default function BudgetEditorFeedback({ client, sourceClient, recordId }) {
  useSyncExternalStore(sourceClient?.subscribe || noSubscribe, sourceClient?.getVersion || noVersion);
  const state = client.status(), seen = useRef(new Set());
  // Pending is still authoritative internal state, including Source outcomes.
  // It must not become a banner during normal editing or background saves.
  const pending = state.pending || sourceClient?.view('actual', recordId)?.active;
  const signature = JSON.stringify([state.verified, pending, state.failures]);
  useEffect(() => {
    for (const failure of state.failures || []) {
      const text = failure.conflict ? '內容已由其他成員更新，未儲存的變更已保留。請透過離開項目的確認流程處理。'
        : failure.invalid ? failure.message : failure.requiresDecision ? '無法儲存這次修改，變更已保留。請透過離開項目的確認流程處理。'
          : '暫時無法完成同步，變更已保留，系統會在連線恢復後重新確認。';
      if (seen.current.has(text)) continue;
      seen.current.add(text);
      // One shared Sonner slot: an outage affecting several fields must not
      // fan out into one notification per group/record/Source operation.
      notify.error(text, { id: budgetErrorToastId });
    }
    if (!pending && state.verified) { notify.dismiss(budgetErrorToastId); seen.current.clear(); }
  }, [signature]); // Only canonical controller transitions affect feedback.
  return null;
}
