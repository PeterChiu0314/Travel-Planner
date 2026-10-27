// Shared with Timeline: stable per-user palette, with session fallback only.
export const collaboratorColors = { blue: "#2f6df6", purple: "#7c4dff", orange: "#e57a1f", pink: "#d94d8c", cyan: "#1598b7", yellow: "#c99a00" };
export function collaboratorColorKey(seed = "") {
  let hash = 0;
  const text = String(seed || "");
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return Object.keys(collaboratorColors)[hash % Object.keys(collaboratorColors).length] || "blue";
}
export const collaboratorColor = userId => collaboratorColors[collaboratorColorKey(userId)];
