export function memberName(member) {
  return member?.display_name || member?.email || member?.user_id || "未指定";
}

export function memberInitial(member) {
  const source = member?.display_name || member?.email || member?.user_id || "?";
  return source.trim().slice(0, 1).toUpperCase();
}

export function memberRoleLabel(role) {
  return {
    owner: "擁有者",
    editor: "編輯者",
    viewer: "檢視者",
  }[role] || "成員";
}
