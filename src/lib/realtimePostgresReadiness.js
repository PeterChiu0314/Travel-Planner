// A Phoenix JOIN/SUBSCRIBED acknowledgement precedes the asynchronous
// Postgres Changes subscription. Do not infer CDC readiness from JOIN alone.
export function isPostgresChangesReady(payload) {
  return payload?.extension === 'postgres_changes' && payload.status === 'ok';
}

export function onPostgresChangesReady(channel, onReady) {
  return channel.on('system', {}, payload => {
    if (isPostgresChangesReady(payload)) onReady();
  });
}
