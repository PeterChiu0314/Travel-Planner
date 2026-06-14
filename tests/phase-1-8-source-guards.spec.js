import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const appSource = readFileSync("src/App.jsx", "utf8");
const styleSource = readFileSync("src/styles.css", "utf8");

test("phase 1.8 formal member and share gates stay separated", () => {
  expect(appSource).toContain('const canInviteMembers = isOwner && !isTripDateLocked;');
  expect(appSource).toContain('const canOpenMembersDialog = activeMembership?.status === "approved";');
  expect(appSource).toContain(
    'const canOpenShareDialog = isOwner || (activeMembership?.status === "approved" && activeMembership?.role === "editor");',
  );
  expect(appSource).toContain("const canManageShareLinks = isOwner;");
  expect(appSource).toContain("canManageMembers={canInviteMembers}");
  expect(appSource).toContain("canManage={canManageShareLinks}");
  expect(appSource).toContain("if (activeTripId && canOpenShareDialog)");
  expect(appSource).toContain("}, [activeTripId, canOpenShareDialog, loadShareLinks]);");
});

test("phase 1.8 editor share dialog can copy active links but cannot manage them", () => {
  expect(appSource).toContain("primaryLink.is_active ? (");
  expect(appSource).toContain("onClick={() => copyShareUrl(primaryLink.token, primaryLink.id)}");
  expect(appSource).toContain("{canManage ? (");
  expect(appSource).toContain("onClick={() => toggleShareLink(primaryLink)}");
  expect(appSource).toContain("{canManage ? (");
  expect(appSource).toContain("onClick={createShareLink}");
});

test("phase 1.8 member mutations keep owner-only lock and trip boundary", () => {
  expect(appSource).toContain("if (!activeTrip || !canInviteMembers) return;");
  expect(appSource).toContain("if (!activeTrip || !canInviteMembers) return { ok: false };");
  expect(appSource).toContain(".update({ status: \"approved\" })");
  expect(appSource).toContain(".update({ role: nextRole })");
  expect(appSource).toContain(".delete().eq(\"id\", memberId).eq(\"trip_id\", activeTrip.id)");
  expect(appSource).toContain(".eq(\"trip_id\", activeTrip.id);");
  expect(appSource).toContain('!["editor", "viewer"].includes(nextRole)');
  expect(appSource).toContain('targetMember.role === "owner"');
  expect(appSource).toContain("targetMember.user_id === session?.user?.id");
});

test("phase 1.8 members dialog keeps required labels and disabled states", () => {
  expect(appSource).toContain('owner: "擁有者"');
  expect(appSource).toContain('editor: "編輯者"');
  expect(appSource).toContain('viewer: "檢視者"');
  expect(appSource).toContain("旅程已進入結算階段，無法邀請或管理成員。");
  expect(appSource).toContain("<h3>邀請成員</h3>");
  expect(appSource).toContain("<h3>權限說明</h3>");
  expect(appSource).toContain("邀請朋友一起規劃這趟旅程。");
  expect(appSource).toContain('const pendingMembers = canManageMembers ? members.filter((member) => member.status === "pending") : [];');
  expect(appSource).toContain('className="trip-header-member-pending"');
  expect(appSource).toContain("disabled={!canManageMembers || busy}");
  expect(appSource).toContain('const canEditRole = canManageMembers && member.role !== "owner" && member.user_id !== currentUserId;');
});

test("phase 2.2 sidebar keeps trip selection guarded and moves creation entry", () => {
  expect(appSource).toContain('{ id: "today", label: "總覽", shortLabel: "覽" }');
  expect(appSource).not.toContain('{ id: "settings", label: "設定", shortLabel: "設" }');
  expect(appSource).toContain('<h2 id="sidebar-trips-title">我的旅程</h2>');
  expect(appSource).toContain('className="mini-button sidebar-create-trip"');
  expect(appSource).toContain('aria-label="新增旅程"');
  expect(appSource).toContain('<TripList trips={trips} activeTripId={activeTripId} onCreate={() => setIsTripDialogOpen(true)} onSelect={selectTrip} />');
  expect(appSource).toContain('className="trip-empty-card"');
  expect(appSource).toContain("+ 建立第一個旅程");
  expect(appSource).not.toContain('className="primary-button create-trip-button"');
  expect(appSource).not.toContain('className="sidebar-members"');
  expect(appSource).toContain("const canContinue = await requestActiveEditorGuardResolution();");
  expect(appSource).toContain("if (canContinue) setActiveTripId(nextTripId);");
});

test("phase 2.3 app shell owns desktop scroll without changing demo/share shell", () => {
  expect(appSource).toContain("<Shell appLayout collapsed={isSidebarCollapsed}>");
  expect(appSource).toContain('className={`app-shell${appLayout ? " app-shell-workspace" : ""}${collapsed ? " sidebar-collapsed" : ""}`}');
  expect(styleSource).toContain(".app-shell-workspace {");
  expect(styleSource).toContain("height: 100dvh;");
  expect(styleSource).toContain("overflow: hidden;");
  expect(styleSource).toContain(".app-shell-workspace .sidebar {");
  expect(styleSource).toContain("overflow-y: auto;");
  expect(styleSource).toContain(".app-shell-workspace .trip-header {");
  expect(styleSource).toContain("position: sticky;");
  expect(styleSource).toContain("z-index: 40;");
  expect(styleSource).toContain(".app-shell-workspace {\n    height: auto;");
  expect(styleSource).toContain(".app-shell-workspace .workspace {\n    height: auto;");
  expect(styleSource).toContain(".app-shell-workspace .trip-header {\n    position: relative;");
});
