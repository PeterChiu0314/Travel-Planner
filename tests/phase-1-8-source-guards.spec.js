import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const appSource = readFileSync("src/App.jsx", "utf8");
const membersDialogSource = readFileSync("src/components/members/MembersInviteDialog.jsx", "utf8");
const memberNameSource = readFileSync("src/lib/memberName.js", "utf8");
const shareDialogSource = readFileSync("src/components/share/ShareDialog.jsx", "utf8");
const sidebarTripSource = readFileSync("src/components/sidebar/SidebarTripSection.jsx", "utf8");
const sidebarAccountSource = readFileSync("src/components/sidebar/SidebarAccountMenu.jsx", "utf8");
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
  expect(shareDialogSource).toContain("primaryLink.is_active ? (");
  expect(shareDialogSource).toContain("onClick={() => copyShareUrl(primaryLink.token, primaryLink.id)}");
  expect(shareDialogSource).toContain("{canManage ? (");
  expect(shareDialogSource).toContain("onClick={() => toggleShareLink(primaryLink)}");
  expect(shareDialogSource).toContain("onClick={createShareLink}");
});

test("phase 1.8 member mutations keep owner-only lock and trip boundary", () => {
  expect(appSource).toContain("if (!activeTrip || !canInviteMembers) return;");
  expect(appSource).toContain("if (!activeTrip || !canInviteMembers) return { ok: false };");
  expect(appSource).toMatch(/async function createMemberInviteToken\(\)\s*\{\s*if \(!activeTrip \|\| !canInviteMembers\) \{\s*const message = isTripDateLocked\s*\? "旅程已進入結算階段，無法邀請或管理成員。"/);
  expect(appSource).toContain(".update({ status: \"approved\" })");
  expect(appSource).toContain(".update({ role: nextRole })");
  expect(appSource).toContain(".delete().eq(\"id\", memberId).eq(\"trip_id\", activeTrip.id)");
  expect(appSource).toContain(".eq(\"trip_id\", activeTrip.id);");
  expect(appSource).toContain('!["editor", "viewer"].includes(nextRole)');
  expect(appSource).toContain('targetMember.role === "owner"');
  expect(appSource).toContain("targetMember.user_id === session?.user?.id");
});

test("phase 1.8 members dialog keeps required labels and disabled states", () => {
  expect(memberNameSource).toContain('owner: "擁有者"');
  expect(memberNameSource).toContain('editor: "編輯者"');
  expect(memberNameSource).toContain('viewer: "檢視者"');
  expect(membersDialogSource).toContain("旅程已進入結算階段，無法邀請或管理成員。");
  expect(membersDialogSource).toContain("<h3>邀請成員</h3>");
  expect(membersDialogSource).toContain("<h3>權限說明</h3>");
  expect(membersDialogSource).toContain("邀請朋友一起規劃這趟旅程。");
  expect(membersDialogSource).toContain('const pendingMembers = canManageMembers ? members.filter((member) => member.status === "pending") : [];');
  expect(appSource).toContain('className="trip-header-member-pending"');
  expect(membersDialogSource).toContain("disabled={!canManageMembers || busy}");
  expect(membersDialogSource).toContain('const canEditRole = canManageMembers && member.role !== "owner" && member.user_id !== currentUserId;');
});

test("phase 2.2 sidebar keeps trip selection guarded and moves creation entry", () => {
  expect(appSource).toContain('{ id: "today", label: "旅程總覽", shortLabel: "覽" }');
  expect(appSource).toContain('{ id: "timeline", label: "行程路線", shortLabel: "程" }');
  expect(appSource).toContain('{ id: "budget", label: "預算管理", shortLabel: "錢" }');
  expect(appSource).toContain('{ id: "accommodation", label: "住宿資訊", shortLabel: "宿" }');
  expect(appSource).toContain('{ id: "todo", label: "待辦指南", shortLabel: "辦" }');
  expect(appSource).toContain('{ id: "luggage", label: "行李清單", shortLabel: "李" }');
  expect(appSource).toContain('{ id: "settlement", label: "分帳結算", shortLabel: "結" }');
  expect(styleSource).toContain("gap: 19px");
  expect(styleSource).toContain("padding: 4px 10px 4px 11px");
  expect(styleSource).toContain("font-weight: 500");
  expect(styleSource).toContain("gap: 18px");
  expect(styleSource).toContain("padding: 5px 8px 5px 12px");
  expect(appSource).not.toContain('{ id: "settings", label: "設定", shortLabel: "設" }');
  expect(sidebarTripSource).toContain("function SidebarTripSection({");
  expect(appSource).toContain('headingId="sidebar-trips-title"');
  expect(appSource).toContain('headingId="demo-sidebar-trips-title"');
  expect(sidebarTripSource).toContain('className="mini-button sidebar-create-trip"');
  expect(sidebarTripSource).toContain('className={`mini-button sidebar-trip-menu-button${isFlyoutOpen ? " active" : ""}`}');
  expect(sidebarTripSource).toContain("<TripList trips={trips} activeTripId={activeTripId} compact={false} onCreate={handleCreate} onSelect={handleSelect} />");
  expect(sidebarTripSource).toContain('className="trip-empty-card"');
  expect(sidebarTripSource).toContain("+ 建立第一個旅程");
  expect(appSource + sidebarTripSource).not.toContain('className="primary-button create-trip-button"');
  expect(appSource + sidebarTripSource).not.toContain('className="sidebar-members"');
  expect(appSource).toContain("if (!await requestActiveEditorHandoff({ tripId: activeTripId }) || !requestGuard.sameContext(tripDataContext)) return false;");
  expect(appSource).toMatch(/async function selectTrip\(nextTripId\) \{[^}]*await navigateWithEditorHandoff\(\(\) => \{\s*setActiveDay\(tripTodayIndex\(nextTrip\)\);\s*setActiveTripId\(nextTripId\);/);
});

test("phase 2.3 app shell owns desktop scroll and demo sidebar uses local parity shell", () => {
  expect(appSource).toContain("<Shell appLayout collapsed={isSidebarCollapsed}>");
  expect(appSource).toContain("<Shell appLayout collapsed={isDemoSidebarCollapsed}>");
  expect(appSource).toContain("const demoTrips = [");
  expect(appSource).toContain('className={`sidebar demo-sidebar${isDemoSidebarCollapsed ? " collapsed" : ""}`}');
  expect(appSource).toContain('headingId="demo-sidebar-trips-title"');
  expect(appSource).toContain("Click to return to login");
  expect(appSource).toContain('className={`app-shell${appLayout ? " app-shell-workspace" : ""}${collapsed ? " sidebar-collapsed" : ""}`}');
  expect(styleSource).toContain(".app-shell-workspace {");
  expect(styleSource).toContain("height: 100dvh;");
  expect(styleSource).toContain("overflow: hidden;");
  expect(styleSource).toContain(".app-shell-workspace .sidebar {");
  expect(styleSource).toContain("overflow-y: auto;");
  expect(styleSource).toContain(".app-shell-workspace .trip-header {");
  expect(styleSource).toContain("position: sticky;");
  expect(styleSource).toContain("z-index: 40;");
  expect(styleSource).toContain(".app-shell-workspace .demo-sidebar {");
  expect(styleSource).toMatch(/\.app-shell-workspace\s*{\s*height:\s*auto;/);
  expect(styleSource).toMatch(/\.app-shell-workspace \.workspace\s*{\s*height:\s*auto;/);
  expect(styleSource).toMatch(/\.app-shell-workspace \.trip-header\s*{\s*position:\s*relative;/);
});

test("development version dialog stays in the formal account menu", () => {
  expect(appSource).toContain("VersionInfoDialog");
  expect(appSource).toContain("Development Preview");
  expect(appSource).toContain('const appVersion = "0.1.6";');
  expect(appSource).toContain('<h2 id="version-dialog-title">旅程工房 | Travel Studio</h2>');
  expect(appSource).toContain('className="modal-backdrop version-dialog-backdrop"');
  expect(appSource).toContain("Collaborative Travel Web App");
  expect(appSource).toContain("onVersion={() => setIsVersionDialogOpen(true)}");
  expect(sidebarAccountSource).toContain('aria-label="帳號選單"');
  expect(sidebarAccountSource).toContain("onVersion();");
  expect(styleSource).toContain(".version-dialog {");
  expect(styleSource).toContain("background: var(--map-glass-bg);");
  expect(styleSource).toContain("backdrop-filter: blur(18px) saturate(var(--map-glass-saturation));");
  expect(styleSource).toMatch(/\.version-dialog-backdrop\s*{[^}]*background:\s*transparent;/s);
  expect(styleSource).toMatch(/\.version-dialog-facts\s*{[^}]*background:\s*transparent;/s);
  expect(styleSource).toMatch(/\.version-dialog-close\s*{[^}]*background:\s*transparent;/s);
});

test("phase 2.6 collapsed sidebar trip flyout stays local to formal and demo sidebars", () => {
  expect(appSource).toContain("const [isSidebarTripMenuOpen, setIsSidebarTripMenuOpen] = useState(false);");
  expect(appSource).toContain("const [isDemoSidebarTripMenuOpen, setIsDemoSidebarTripMenuOpen] = useState(false);");
  expect(appSource).toContain('flyoutId="sidebar-trips-flyout"');
  expect(appSource).toContain('flyoutId="demo-sidebar-trips-flyout"');
  expect(sidebarTripSource).toContain('className="sidebar-trip-menu-divider"');
  expect(sidebarTripSource).toContain('<LayoutList size={19} strokeWidth={2.2} aria-hidden="true" />');
  expect(styleSource).toContain(".sidebar.collapsed .sidebar-trip-section-collapsed");
  expect(styleSource).toContain(".sidebar.collapsed .sidebar-trip-menu-divider");
  expect(styleSource).toContain(".sidebar.collapsed .sidebar-trip-flyout");
  expect(styleSource).toContain(".sidebar.collapsed .sidebar-trip-flyout .trip-card");
  expect(styleSource).toContain(".sidebar.collapsed .user-box");
  expect(styleSource).toContain("border-top: 0;");
});
