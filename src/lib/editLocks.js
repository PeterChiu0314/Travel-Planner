export const editLockTimeoutMs = 7 * 60 * 1000;

export function lockExpiresAt(lockedAt) {
  if (!lockedAt) return 0;
  return new Date(lockedAt).getTime() + editLockTimeoutMs;
}

export function isLockActive(record) {
  return Boolean(record?.locked_by && record?.locked_at && lockExpiresAt(record.locked_at) > Date.now());
}

export function isLockedByAnotherUser(record, userId) {
  return isLockActive(record) && record.locked_by !== userId;
}

export async function acquireEditLock({ record, supabase, table, userId }) {
  if (!record?.id || !userId) return { data: record, error: null, lockedByAnotherUser: false };
  if (isLockedByAnotherUser(record, userId)) return { data: record, error: null, lockedByAnotherUser: true };

  const { data, error } = await supabase
    .from(table)
    .update({ locked_by: userId, locked_at: new Date().toISOString() })
    .eq("id", record.id)
    .select("*")
    .single();

  return { data: data || record, error, lockedByAnotherUser: false };
}

export async function releaseEditLock({ recordId, supabase, table, userId }) {
  if (!recordId || !userId) return { error: null };
  return supabase.from(table).update({ locked_by: null, locked_at: null }).eq("id", recordId).eq("locked_by", userId);
}
