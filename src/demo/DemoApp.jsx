import AccommodationPanel from "../components/AccommodationPanel.jsx";
import TodoGuidePanel from "../components/TodoGuidePanel.jsx";
import { ActiveEditorGuardDialog, requestActiveEditorHandoff } from "../app/activeEditorGuard.jsx";
import SettlementPanel from "../components/SettlementPanel.jsx";
import { formatDate } from "../lib/displayFormat.js";
import ExpenseWorkspace from "../components/budget/ExpenseWorkspace.jsx";
import { expenseFinancialSnapshot, expenseTimelineCosts } from "../lib/expenseSnapshot.js";
import { createDemoExpenseService } from "./expenseService.js";
import { useSiteDialog } from "../components/SiteDialog.jsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { createDemoGuides, createDemoStays, createDemoTodos } from "../components/workspace/demoWorkspaceData.js";
import MenuSelect from "../components/MenuSelect.jsx";
import { LuggagePanel } from "../components/luggage/LuggagePanel.jsx";
import { createDemoLuggageItems, createDemoSharedLuggageItems } from "./luggageFixtures.js";
import {
  reorderLuggageSnapshot,
  privatizeLuggageSnapshot,
  assignLuggageSnapshot,
  transitionSharedLuggage,
  luggageErrorMessage,
} from "../lib/luggageService.js";
import { budgetStage } from "../lib/budgetFinance.js";
import {
  ChevronLeft,
  ChevronRight,
  LogIn,
  Map as MapIcon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
} from "lucide-react";
import { tripDays } from "../lib/timelineTime.js";
import RoutePanel from "../components/map/RoutePanel.jsx";
import MembersInviteDialog from "../components/members/MembersInviteDialog.jsx";
import SidebarTripSection from "../components/sidebar/SidebarTripSection.jsx";
import DayTabs from "../components/timeline/DayTabs.jsx";
import MultiDayTimelineColumns from "../components/timeline/MultiDayTimelineColumns.jsx";
import { sortScheduleItems } from "../lib/timelineUntimedOrdering.js";
import { desktopNavItems, desktopNavIcons } from "../app/navigation.js";
import { tripTodayIndex } from "../components/trip/tripDetails.js";
import { useDayBoardNavigation, useTimelineMapTransition } from "../components/timeline/timelineNavigation.js";
import { buildTripDateChangePreview, syncTimelineItemDatesForTripStart, timelineItemIdsRemovedByShortening } from "../components/trip/tripDateChange.js";
import {
  demoId,
  demoSectionLabel,
  demoTrips,
  demoMembers,
  createDemoTimelineItems,
} from "./timelineFixtures.js";
import { Shell } from "../app/WorkspaceShell.jsx";
import { TripHeader } from "../components/trip/TripHeader.jsx";
import { ItineraryTimeline } from "../components/timeline/ItineraryTimeline.jsx";
import { budgetEditorServices } from "../components/budget/BudgetPanel.jsx";
import { createDemoTimelineCommands } from "./timelineCommands.js";

export function DemoApp({ initialSection }) {
  const { ask: askDemo, dialog: demoDialog } = useSiteDialog();
  const [activeSection, setActiveSection] = useState(initialSection || "timeline");
  const [activeDay, setActiveDay] = useState(0);
  const [isDemoMembersDialogOpen, setIsDemoMembersDialogOpen] = useState(false);
  const [demoActiveTrip, setDemoActiveTrip] = useState(() => demoTrips[0]);
  const [isDemoSidebarCollapsed, setIsDemoSidebarCollapsed] = useState(false);
  const [isDemoSidebarTripMenuOpen, setIsDemoSidebarTripMenuOpen] = useState(false);
  const [timelineItems, setTimelineItems] = useState(() => createDemoTimelineItems());
  const [timelineAlternatives, setTimelineAlternatives] = useState([]);
  const demoExpenseItems = useRef(timelineItems); demoExpenseItems.current = timelineItems;
  const [demoExpenseServices, setDemoExpenseServices] = useState(() => Object.fromEntries(demoTrips.map(trip => [trip.id,
    createDemoExpenseService({trip,members:demoMembers,getItems:()=>demoExpenseItems.current.filter(item=>item.trip_id===trip.id)})])));
  const [demoExpenseSnapshots, setDemoExpenseSnapshots] = useState(() => Object.fromEntries(Object.entries(demoExpenseServices).map(([id,service])=>[id,service.snapshot()])));
  const [demoScenario, setDemoScenario] = useState("live");
  const [demoClock, setDemoClock] = useState(Date.now);
  const demoStage = demoScenario === "live" ? budgetStage(demoActiveTrip, new Date(demoClock)) : demoScenario;
  const finance = expenseFinancialSnapshot(demoExpenseSnapshots[demoActiveTrip.id]);
  const { budgetItems, budgetParticipants, actualExpenses, actualParticipants, itineraryBudgetLinks } = finance;
  useEffect(() => {
    const timer = window.setInterval(() => setDemoClock(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const [demoSupportByTrip, setDemoSupportByTrip] = useState(() => Object.fromEntries(demoTrips.map((trip, index) => [trip.id, {
    accommodations: index === 0 ? createDemoStays(trip) : [],
    todoItems: index === 0 ? createDemoTodos(trip) : [],
    guideItems: index === 0 ? createDemoGuides() : [],
    luggageItems: index === 0 ? createDemoLuggageItems(trip.id) : [],
    sharedLuggageItems: index === 0 ? createDemoSharedLuggageItems(trip.id) : [],
  }])));
  const support = demoSupportByTrip[demoActiveTrip.id];
  const { accommodations, todoItems, guideItems, luggageItems, sharedLuggageItems } = support;
  function setSupportField(key, update) {
    const tripId = demoActiveTrip.id;
    setDemoSupportByTrip((current) => ({ ...current, [tripId]: { ...current[tripId],
      [key]: typeof update === "function" ? update(current[tripId][key]) : update } }));
  }
  const setAccommodations = (update) => setSupportField("accommodations", update);
  const setTodoItems = (update) => setSupportField("todoItems", update);
  const setGuideItems = (update) => setSupportField("guideItems", update);
  const setLuggageItems = (update) => setSupportField("luggageItems", update);
  const setSharedLuggageItems = (update) => setSupportField("sharedLuggageItems", update);
  const [luggageTab, setLuggageTab] = useState("personal");
  const [focusedItemId, setFocusedItemId] = useState(null);
  const { isMapClosing, isRouteCollapsed, isRouteLayoutCollapsed, toggleRouteMap } = useTimelineMapTransition();
  const demoMapPointPicker = {
    canPickMapPoint: false,
    isPickingMapPoint: false,
    mapPointPickFeedback: "",
    pickedMapPoint: null,
    onCancelMapPointPick: null,
    onPickMapPoint: null,
    onStartMapPointPick: null,
  };
  const days = useMemo(() => tripDays(demoActiveTrip), [demoActiveTrip]);
  useEffect(() => {
    setIsDemoSidebarTripMenuOpen(false);
  }, [activeSection, demoActiveTrip.id, isDemoSidebarCollapsed]);
  const dayItems = useMemo(
    () => sortScheduleItems(timelineItems.filter((item) => item.day_index === activeDay)),
    [activeDay, timelineItems],
  );
  const itemsByDay = useMemo(
    () => days.map((_, index) => sortScheduleItems(timelineItems.filter((item) => item.day_index === index))),
    [days, timelineItems],
  );
  const dayBoardNavigation = useDayBoardNavigation(activeDay, isRouteLayoutCollapsed);
  const budgetsByItem = useMemo(() => {
    const byId = new Map(expenseTimelineCosts(finance.expenseGraph).map(item=>[item.id,item]));
    const next = {};
    itineraryBudgetLinks.forEach((link) => {
      const budget = byId.get(link.budget_item_id);
      if (!budget) return;
      next[link.itinerary_item_id] = [...(next[link.itinerary_item_id] || []), budget];
    });
    return next;
  }, [budgetItems, itineraryBudgetLinks]);
  const alternativesByItem = useMemo(() => {
    const next = {};
    timelineAlternatives.forEach((alternative) => {
      next[alternative.itinerary_item_id] = [...(next[alternative.itinerary_item_id] || []), alternative];
    });
    return next;
  }, [timelineAlternatives]);
  const tripDateChangePreviewData = useMemo(
    () => ({
      accommodations: [],
      alternatives: timelineAlternatives,
      itineraryBudgetLinks,
      items: timelineItems,
      todoItems: [],
    }),
    [itineraryBudgetLinks, timelineAlternatives, timelineItems],
  );

  async function changeSection(section) {
    if (section === activeSection) return;
    if (!(await requestActiveEditorHandoff({ tripId: demoActiveTrip.id }))) return;
    setActiveSection(section);
    window.history.pushState({}, "", `/demo/${section}`);
  }

  async function changeDemoTrip(tripId) {
    const nextTrip = demoTrips.find((trip) => trip.id === tripId);
    if (!nextTrip || tripId === demoActiveTrip.id || !(await requestActiveEditorHandoff({ tripId: demoActiveTrip.id }))) return;
    setActiveDay(tripTodayIndex(nextTrip));
    setFocusedItemId(null);
    setDemoScenario("live");
    setDemoActiveTrip(nextTrip);
  }

  async function changeDemoScenario(scenario) {
    if (!(await requestActiveEditorHandoff({ tripId: demoActiveTrip.id, workspace: "budget" }))) return;
    setDemoScenario(scenario);
  }

  async function resetDemoBudget() {
    if (!(await requestActiveEditorHandoff({ tripId: demoActiveTrip.id, workspace: "budget" }))) return;
    if (!await askDemo({ title: "重設 Demo 預算？", message: "將重設這個旅程的 Demo 預算、實付與附件。", confirmLabel: "重設", danger: true })) return;
    const service=createDemoExpenseService({trip:demoActiveTrip,members:demoMembers,getItems:()=>demoExpenseItems.current.filter(item=>item.trip_id===demoActiveTrip.id)});
    setDemoExpenseServices(current=>({...current,[demoActiveTrip.id]:service}));
    setDemoExpenseSnapshots(current=>({...current,[demoActiveTrip.id]:service.snapshot()}));
    setDemoScenario("live");
  }

  async function returnToLogin() {
    if (!(await requestActiveEditorHandoff({ tripId: demoActiveTrip.id }))) return;
    window.location.assign("/");
  }

  function selectTimelineDay(dayIndex) {
    if (Number(dayIndex) !== Number(activeDay)) setFocusedItemId(null);
    setActiveDay(dayIndex);
    if (isRouteLayoutCollapsed) dayBoardNavigation.scrollToDay(dayIndex);
  }

  function updateDemoTripDateRange({ confirmTimelineRemoval = false, startDate, endDate }) {
    if (!startDate || !endDate || endDate < startDate) return { ok: false };
    const preview = buildTripDateChangePreview({
      ...tripDateChangePreviewData,
      newEndDate: endDate,
      newStartDate: startDate,
      trip: demoActiveTrip,
    });
    if (preview.hasTimelineRemoval && !confirmTimelineRemoval) return { ok: false, unsafeShortening: true };
    const removedIds = confirmTimelineRemoval
      ? timelineItemIdsRemovedByShortening(timelineItems, preview.newDayCount)
      : new Set();
    setDemoActiveTrip((current) => ({ ...current, start_date: startDate, end_date: endDate }));
    setTimelineItems((current) =>
      syncTimelineItemDatesForTripStart(
        current.filter((item) => !removedIds.has(item.id)),
        startDate,
      ),
    );
    if (removedIds.size) {
      setTimelineAlternatives((current) =>
        current.filter((alternative) => !removedIds.has(alternative.itinerary_item_id)),
      );
      setItineraryBudgetLinks((current) =>
        current.filter((link) => !removedIds.has(link.itinerary_item_id)),
      );
    }
    setActiveDay((current) => Math.min(current, Math.max((preview.newDayCount || 1) - 1, 0)));
    return { ok: true };
  }

  const demoLuggageRef = useRef(support);
  demoLuggageRef.current = support;
  function mutateDemoLuggage(scope, action, payload, id, meta = {}) {
    if (meta.tripId && meta.tripId !== demoActiveTrip.id) return { ok: false, crossTrip: true };
    const key = scope === "personal" ? "luggageItems" : "sharedLuggageItems";
    const list = demoLuggageRef.current[key];
    const old = list.find(row => row.id === id);
    if (id && (!old || old.trip_id !== demoActiveTrip.id)) return { ok: false, error: new Error("找不到此旅程的物品。") };
    if (old && old.updated_at !== meta.baseUpdatedAt) return { ok: false, conflict: true };
    try {
      const normalized = action === "save" ? { title: payload.title.trim(), category: payload.category.trim(), notes: (payload.notes || "").trim(), ...(scope === "shared" ? { assigned_to: payload.assigned_to || null } : {}) } : payload;
      if (action === "save" && !normalized.title) return { ok: false };
      const next = action === "delete" ? null : { ...(scope === "shared" ? transitionSharedLuggage(old || { packed_by_assignee: false }, normalized, {
        userId: "demo-peter", isOwner: true, approvedMemberIds: demoMembers.filter(row => row.status === "approved").map(row => row.user_id),
      }) : { ...old, ...normalized, owner_id: "demo-peter", packed: action === "save" ? Boolean(old?.packed) : payload.packed }),
        id: id || demoId("demo-luggage"), trip_id: demoActiveTrip.id, updated_at: new Date(Math.max(Date.now(), Date.parse(old?.updated_at || 0) + 1)).toISOString() };
      const nextList = action === "delete" ? list.filter(row => row.id !== id) : id ? list.map(row => row.id === id ? next : row) : [...list, next];
      demoLuggageRef.current = { ...demoLuggageRef.current, [key]: nextList };
      setSupportField(key, nextList);
      return { ok: true, data: next };
    } catch(error) { return { ok: false, error: new Error(luggageErrorMessage(error)) }; }
  }
  const {
    saveTimelineItem,
    reorderTimelineDestinationPackages,
    reorderTimelineUntimedVisit,
    confirmTimelineTransportWarning,
    saveTimelineAlternative,
    deleteTimelineAlternative,
    deleteTimelineItem,
    toggleTimelineItemFixed,
    applyTimelineAlternative,
  } = createDemoTimelineCommands({
    activeDay,
    demoActiveTrip,
    timelineItems,
    setTimelineItems,
    timelineAlternatives,
    setTimelineAlternatives,
    itineraryBudgetLinks,
  });
  function savePersonalLuggage(payload, editingId, meta) { return mutateDemoLuggage("personal", "save", payload, editingId, meta); }

  function saveSharedLuggage(payload, editingId, meta) { return mutateDemoLuggage("shared", "save", payload, editingId, meta); }

  function assignDemoLuggage(scope, item, assignedTo) {
    try {
      const next = assignLuggageSnapshot(demoLuggageRef.current, { scope, item, assignedTo, tripId: demoActiveTrip.id, userId: "demo-peter", approvedMemberIds: demoMembers.filter(member => member.status === "approved").map(member => member.user_id) });
      demoLuggageRef.current = next;
      setDemoSupportByTrip(current => ({ ...current, [demoActiveTrip.id]: next }));
      return { ok: true, data: next.sharedLuggageItems.find(row => row.id === item.id) };
    } catch (error) { return { ok: false, error: new Error(luggageErrorMessage(error)) }; }
  }

  function privatizeDemoLuggage(item, category) {
    try {
      const next = privatizeLuggageSnapshot(demoLuggageRef.current, { item, category, tripId: demoActiveTrip.id, userId: "demo-peter", approvedMemberIds: demoMembers.filter(member => member.status === "approved").map(member => member.user_id) });
      demoLuggageRef.current = next;
      setDemoSupportByTrip(current => ({ ...current, [demoActiveTrip.id]: next }));
      return { ok: true, data: next.luggageItems.find(row => row.id === item.id) };
    } catch (error) { return { ok: false, error: new Error(luggageErrorMessage(error)) }; }
  }

  function reorderDemoLuggage(scope, item, target, placement, items) {
    try {
      const next = reorderLuggageSnapshot(demoLuggageRef.current, { scope, item, target, placement, items, tripId: demoActiveTrip.id,
        userId: "demo-peter", approvedMemberIds: demoMembers.filter(member => member.status === "approved").map(member => member.user_id) });
      demoLuggageRef.current = next;
      setDemoSupportByTrip(current => ({ ...current, [demoActiveTrip.id]: next }));
      return { ok: true };
    } catch (error) { return { ok: false, error: new Error(luggageErrorMessage(error)) }; }
  }

  function saveDemoRecord(key, form, editingId, meta = {}) {
    if (!(form.title || form.name || "").trim() || (meta.tripId && meta.tripId !== demoActiveTrip.id)) return { ok: false };
    if (editingId && !support[key].some((item) => item.id === editingId)) return { ok: false };
    const record = { ...form, updated_at: new Date().toISOString() };
    setSupportField(key, (current) => editingId
      ? current.map((item) => item.id === editingId ? { ...item, ...record } : item)
      : [...current, { ...record, id: demoId(`demo-${key}`), completed: false }]);
    return { ok: true };
  }

  return (
    <Shell appLayout collapsed={isDemoSidebarCollapsed}>
      <aside className={`sidebar demo-sidebar${isDemoSidebarCollapsed ? " collapsed" : ""}`}>
        <div className="brand">
          <button
            className="brand-mark"
            type="button"
            title={isDemoSidebarCollapsed ? "展開 Demo 側欄" : "回到登入介面"}
            aria-label={isDemoSidebarCollapsed ? "展開 Demo 側欄" : "回到登入介面"}
            onClick={() => {
              if (isDemoSidebarCollapsed) {
                setIsDemoSidebarCollapsed(false);
                return;
              }
              returnToLogin();
            }}
          >
            <span className="brand-logo-text">TP</span>
            {isDemoSidebarCollapsed ? (
              <PanelLeftOpen className="brand-logo-action" size={22} strokeWidth={2.2} aria-hidden="true" />
            ) : null}
          </button>
          <div className="brand-copy">
            <h1>旅程工房</h1>
            <p>Travel Studio</p>
          </div>
          <button
            className="mini-button sidebar-toggle"
            type="button"
            title={isDemoSidebarCollapsed ? "展開側欄" : "收合側欄"}
            aria-label={isDemoSidebarCollapsed ? "展開側欄" : "收合側欄"}
            aria-expanded={!isDemoSidebarCollapsed}
            onClick={() => setIsDemoSidebarCollapsed((value) => !value)}
          >
            <PanelLeftClose size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
        <nav className="section-nav" aria-label="Demo 導覽">
          {desktopNavItems.map((navItem) => {
            const section = navItem.id;
            const available = ["timeline", "budget", "accommodation", "todo", "luggage", "settlement"].includes(section);
            const Icon = navItem ? desktopNavIcons[navItem.id] : null;
            return (
              <button
                className={`section-nav-button${activeSection === section ? " active" : ""}`}
                key={section}
                type="button"
                title={available ? navItem.label : `${navItem.label}（此 Demo 尚未提供）`}
                aria-label={navItem.label}
                disabled={!available}
                aria-current={activeSection === section ? "page" : undefined}
                onClick={() => changeSection(section)}
              >
                <span className="section-nav-icon" aria-hidden="true">
                  {Icon ? <Icon size={15} strokeWidth={2.2} /> : navItem?.shortLabel}
                </span>
                <span className="nav-label">{navItem.label}</span>
              </button>
            );
          })}
        </nav>
        <SidebarTripSection
          activeTripId={demoActiveTrip.id}
          collapsed={isDemoSidebarCollapsed}
          createDisabled
          createTitle="Demo 模式不支援新增旅程"
          flyoutId="demo-sidebar-trips-flyout"
          headingId="demo-sidebar-trips-title"
          isFlyoutOpen={isDemoSidebarTripMenuOpen}
          onCloseFlyout={() => setIsDemoSidebarTripMenuOpen(false)}
          onCreate={() => {}}
          onSelect={changeDemoTrip}
          onToggleFlyout={() => setIsDemoSidebarTripMenuOpen((value) => !value)}
          trips={demoTrips.map((trip) => ({
            ...trip,
            membership: { role: "owner", status: "approved" },
          }))}
        />
        <div className="user-box demo-login-return">
          <button
            className="user-box-card"
            type="button"
            title="回到登入介面"
            aria-label="Return to login"
            onClick={returnToLogin}
          >
            <span className="user-avatar" aria-hidden="true">
              <LogIn size={17} strokeWidth={2.1} />
            </span>
            <span className="user-account">
              <strong className="nav-label">回到登入</strong>
              <span className="user-email nav-label">Click to return to login</span>
            </span>
          </button>
        </div>
      </aside>
      <main className="workspace demo-workspace">
        <TripHeader
          activeSection={activeSection}
          trip={demoActiveTrip}
          members={demoMembers}
          days={days}
          dateChangePreviewData={tripDateChangePreviewData}
          demoNotice="Demo Mode 資料不會永久保存。"
          demoStage={activeSection === "budget" || activeSection === "settlement" ? demoStage : undefined}
          canShare={false}
          canEditTrip
          canOpenMembers
          onDelete={() => {}}
          onExport={() => {}}
          onInvite={() => setIsDemoMembersDialogOpen(true)}
          onOpenMembers={() => setIsDemoMembersDialogOpen(true)}
          onShare={() => {}}
          onUpdateTrip={(patch) => {
            setDemoActiveTrip((current) => ({ ...current, ...patch }));
            return { ok: true };
          }}
          onUpdateTripDateRange={updateDemoTripDateRange}
        />
        {new URLSearchParams(window.location.search).get("budgetTools") === "1" && (activeSection === "budget" || activeSection === "settlement") ? <div className="demo-budget-controls">
          <div className="demo-budget-scenario"><span>Demo 情境</span><MenuSelect label="Demo 情境" value={demoScenario} onValueChange={(value)=>void changeDemoScenario(value)} options={[{value:"live",label:"依目前日期"},{value:"planning",label:"行前規劃"},{value:"traveling",label:"行程中"},{value:"settled",label:"旅程結算"}]} /></div>
          <span>{demoMembers.length} 位成員 · {budgetItems.length} 筆預算</span>
          <button className="ghost-button compact" type="button" onClick={() => void resetDemoBudget()}>重設預算案例</button>
        </div> : null}
        {activeSection === "timeline" ? (
          <>
            <div className={`timeline-top-row${isRouteLayoutCollapsed ? " route-collapsed" : ""}`}>
              <DayTabs
                activeDay={activeDay}
                dayPrefix="第"
                daySuffix="天"
                days={days}
                layoutMode={isRouteLayoutCollapsed ? "collapsed" : "expanded"}
                onActiveDay={selectTimelineDay}
              />
              <button
                className="ghost-button compact timeline-map-toggle"
                type="button"
                title={isRouteCollapsed ? "顯示地圖" : "隱藏地圖"}
                aria-label={isRouteCollapsed ? "顯示地圖" : "隱藏地圖"}
                onClick={toggleRouteMap}
              >
                {isRouteCollapsed ? (
                  <MapIcon size={18} strokeWidth={2.2} aria-hidden="true" />
                ) : (
                  <PanelRightClose size={18} strokeWidth={2.2} aria-hidden="true" />
                )}
              </button>
            </div>
            <div className={`content-grid timeline-workbench${isRouteLayoutCollapsed ? " route-collapsed" : ""}`}>
              {isRouteLayoutCollapsed ? (
                <button
                  className="board-scroll-button left"
                  disabled={!dayBoardNavigation.scrollState.left}
                  type="button"
                  aria-label="前一天"
                  onClick={() => dayBoardNavigation.scrollByDirection(-1)}
                >
                  <ChevronLeft aria-hidden="true" />
                </button>
              ) : null}
              <section className="panel itinerary-panel" ref={dayBoardNavigation.boardRef}>
                <ItineraryTimeline
                  activeDay={activeDay}
                  activeTrip={demoActiveTrip}
                  alternativesByItem={alternativesByItem}
                  budgetsByItem={budgetsByItem}
                  canEdit
                  currentUserId="demo-peter"
                  dayItems={dayItems}
                  dayDateLabel={days[activeDay] ? formatDate(days[activeDay]) : ""}
                  dayLabel={days[activeDay] ? `第 ${activeDay + 1} 天 / ${formatDate(days[activeDay])}` : ""}
                  dayTitle={`DAY ${activeDay + 1}`}
                  disableDraftAutosave
                  focusedItemId={focusedItemId}
                  {...demoMapPointPicker}
                  headingEyebrow="行程"
                  members={demoMembers}
                  onApplyAlternative={applyTimelineAlternative}
                  onConfirmTransportWarning={confirmTimelineTransportWarning}
                  onDeleteAlternative={deleteTimelineAlternative}
                  onDeleteItem={deleteTimelineItem}
                  onFocusItem={setFocusedItemId}
                  onReorderDestinationPackages={reorderTimelineDestinationPackages}
                  onReorderUntimedVisit={reorderTimelineUntimedVisit}
                  onSaveAlternative={saveTimelineAlternative}
                  onSaveItem={saveTimelineItem}
                  onToggleItemFixed={toggleTimelineItemFixed}
                  restoreDrafts={false}
                  useEditLocks={false}
                />
                {isRouteLayoutCollapsed ? (
                  <MultiDayTimelineColumns
                    activeDay={activeDay}
                    alternativesByItem={alternativesByItem}
                    budgetsByItem={budgetsByItem}
                    days={days}
                    itemsByDay={itemsByDay}
                    onActiveDay={selectTimelineDay}
                    onFocusItem={setFocusedItemId}
                  />
              ) : null}
              </section>
              {isRouteLayoutCollapsed ? (
                <button
                  className="board-scroll-button right"
                  disabled={!dayBoardNavigation.scrollState.right}
                  type="button"
                  aria-label="後一天"
                  onClick={() => dayBoardNavigation.scrollByDirection(1)}
                >
                  <ChevronRight aria-hidden="true" />
                </button>
              ) : null}
              {isRouteLayoutCollapsed ? null : (
                <aside className={`side-panels${isMapClosing ? " is-closing" : ""}`}>
                  <RoutePanel
                    dayItems={dayItems}
                    focusedItemId={focusedItemId}
                    {...demoMapPointPicker}
                    headingEyebrow="路線"
                    mode="demo"
                    viewportKey={`demo-day:${activeDay}`}
                    onFocusItem={setFocusedItemId}
                  />
                </aside>
              )}
            </div>
          </>
        ) : null}
        {activeSection === "budget" ? (
          <ExpenseWorkspace key={demoExpenseServices[demoActiveTrip.id].instanceId} demo activeTrip={demoActiveTrip} demoStage={demoStage}
            metadataSnapshot={finance} expenseService={demoExpenseServices[demoActiveTrip.id]}
            onExpenseSnapshot={data=>setDemoExpenseSnapshots(current=>({...current,[data.tripId]:data}))}
            canEdit currentUserId="demo-peter" services={budgetEditorServices}/>

        ) : null}
        {activeSection === "accommodation" ? <AccommodationPanel
          activeTrip={demoActiveTrip} trip={demoActiveTrip} accommodations={accommodations} attachments={[]} expenseGraph={finance.expenseGraph}
          canEdit currentUserId="demo-peter" disableDraftAutosave useEditLocks={false} restoreDrafts={false} enableAttachments={false}
          onSave={(form, id, meta) => saveDemoRecord("accommodations", form, id, meta)}
          onDelete={(id) => setAccommodations((current) => current.filter((item) => item.id !== id))}
        /> : null}
        {activeSection === "todo" ? <TodoGuidePanel
          activeTrip={demoActiveTrip} canEdit currentUserId="demo-peter" members={demoMembers} todoItems={todoItems} guideItems={guideItems}
          disableDraftAutosave useEditLocks={false} restoreDrafts={false}
          onSaveTodo={(form, id, meta) => saveDemoRecord("todoItems", form, id, meta)}
          onSaveGuide={(form, id, meta) => saveDemoRecord("guideItems", form, id, meta)}
          onDeleteTodo={(id) => setTodoItems((current) => current.filter((item) => item.id !== id))}
          onDeleteGuide={(id) => { setGuideItems((current) => current.filter((item) => item.id !== id)); setTodoItems((current) => current.map((item) => item.guide_id === id ? { ...item, guide_id: "" } : item)); }}
          onToggleTodo={(item) => setTodoItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, completed: !entry.completed } : entry))}
        /> : null}
        {activeSection === "settlement" ? <SettlementPanel expenseGraph={finance.expenseGraph}
          actualExpenses={actualExpenses} actualParticipants={actualParticipants} budgetItems={budgetItems} members={demoMembers} /> : null}
        {activeSection === "luggage" ? (
          <LuggagePanel key={`${demoActiveTrip.id}:demo-peter`}
            activeTrip={demoActiveTrip} activeTab={luggageTab} onTabChange={setLuggageTab}
            canEdit isOwner disableDraftAutosave useEditLocks={false} restoreDrafts={false}
            currentUserId="demo-peter"
            luggageItems={luggageItems}
            members={demoMembers}
            sharedLuggageItems={sharedLuggageItems}
            onDeletePersonal={(id, item) => mutateDemoLuggage("personal", "delete", {}, id, { tripId: item.trip_id, baseUpdatedAt: item.updated_at })}
            onDeleteShared={(id, item) => mutateDemoLuggage("shared", "delete", {}, id, { tripId: item.trip_id, baseUpdatedAt: item.updated_at })}
            onSavePersonal={savePersonalLuggage}
            onSaveShared={saveSharedLuggage}
            onAssign={assignDemoLuggage}
            onPrivatize={privatizeDemoLuggage}
            onReorder={reorderDemoLuggage}
            onTogglePersonal={(item) => mutateDemoLuggage("personal", "patch", { packed: !item.packed }, item.id, { tripId: item.trip_id, baseUpdatedAt: item.updated_at })}
            onUpdateShared={(id, patch, item) => mutateDemoLuggage("shared", "patch", patch, id, { tripId: item.trip_id, baseUpdatedAt: item.updated_at })}
          />
        ) : null}
      </main>
      <nav className="bottom-nav" aria-label="Demo 手機導覽">
        {["timeline", "budget", "luggage", "settlement"].map((section) => (
          <button
            className={`bottom-nav-button${activeSection === section ? " active" : ""}`}
            key={section}
            type="button"
            onClick={() => changeSection(section)}
          >
            {demoSectionLabel(section)}
          </button>
        ))}
      </nav>
      <ActiveEditorGuardDialog />
      {demoDialog}
      {isDemoMembersDialogOpen ? (
        <MembersInviteDialog
          canManageMembers={false}
          currentRole="owner"
          currentUserId="demo-peter"
          isTripDateLocked={false}
          members={demoMembers}
          onApprove={() => {}}
          onClose={() => setIsDemoMembersDialogOpen(false)}
          onCreateInvite={() => ({ ok: false, message: "Demo 不會產生正式邀請連結。" })}
          onReject={() => {}}
          onRemoveMember={() => {}}
          onUpdateRole={() => {}}
        />
      ) : null}
    </Shell>
  );
}
