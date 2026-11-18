export function saveGuide({ client, tripId, payload, editingId, meta, updateWithConflictCheck }) {
  const nextPayload = {
    trip_id: tripId,
    title: payload.title.trim(),
    description: payload.description.trim() || null,
    url: payload.url.trim() || null,
  };
  return editingId
    ? updateWithConflictCheck("guide_items", nextPayload, editingId, meta)
    : client.from("guide_items").insert(nextPayload);
}

export function deleteGuide({ client, guideId }) {
  return client.from("guide_items").delete().eq("id", guideId);
}

export function saveTodo({ client, tripId, payload, editingId, meta, updateWithConflictCheck }) {
  const nextPayload = {
    trip_id: tripId,
    title: payload.title.trim(),
    description: payload.description.trim() || null,
    due_date: payload.due_date || null,
    assignee_id: payload.assignee_id || null,
    guide_id: payload.guide_id || null,
  };
  return editingId
    ? updateWithConflictCheck("todo_items", nextPayload, editingId, meta)
    : client.from("todo_items").insert(nextPayload);
}

export function deleteTodo({ client, todoId }) {
  return client.from("todo_items").delete().eq("id", todoId);
}

export function toggleTodo({ client, todo }) {
  return client.from("todo_items").update({ completed: !todo.completed }).eq("id", todo.id);
}
