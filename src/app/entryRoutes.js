export function inviteTokenFromUrl() {
  return new URLSearchParams(window.location.search).get("invite");
}

export function clearInviteTokenFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("invite");
  window.history.replaceState({}, "", url.toString());
}

export function shareTokenFromUrl() {
  return new URLSearchParams(window.location.search).get("share");
}

export function demoSectionFromPath() {
  const path = window.location.pathname.replace(/\/+$/, "");
  if (path === "/demo" || path === "/demo/") return "timeline";
  if (path === "/demo/timeline") return "timeline";
  if (path === "/demo/budget") return "budget";
  if (path === "/demo/accommodation") return "accommodation";
  if (path === "/demo/todo") return "todo";
  if (path === "/demo/settlement") return "settlement";
  if (path === "/demo/luggage") return "luggage";
  return null;
}
