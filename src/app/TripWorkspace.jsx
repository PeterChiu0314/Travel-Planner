import AccommodationPanel from "../components/AccommodationPanel.jsx";
import TodoGuidePanel from "../components/TodoGuidePanel.jsx";
import SettlementPanel from "../components/SettlementPanel.jsx";
import TodayMode from "../components/TodayMode.jsx";
import { formatDate } from "../lib/displayFormat.js";
import { getMapProviderConfig } from "../lib/mapProviderConfig.js";
import { useMemo, useRef, useState } from "react";
import { LuggagePanel } from "../components/luggage/LuggagePanel.jsx";
import { ChevronLeft, ChevronRight, Map as MapIcon, PanelRightClose } from "lucide-react";
import RoutePanel from "../components/map/RoutePanel.jsx";
import DayTabs from "../components/timeline/DayTabs.jsx";
import useTimelineMapPointPicker from "../components/timeline/useTimelineMapPointPicker.js";
import MultiDayTimelineColumns from "../components/timeline/MultiDayTimelineColumns.jsx";
import { sortScheduleItems } from "../lib/timelineUntimedOrdering.js";
import { useDayBoardNavigation, useTimelineMapTransition } from "../components/timeline/timelineNavigation.js";
import { ItineraryTimeline } from "../components/timeline/ItineraryTimeline.jsx";
import { BudgetPanel } from "../components/budget/BudgetPanel.jsx";

export function TripWorkspace(props) {
  const {
    activeTrip,
    activeDay,
    activeSection,
    actualExpenses,
    actualParticipants,
    accommodations,
    alternatives,
    attachments,
    budgetItems,
    budgetParticipants,
    budgetSnapshot,
    budgetsByItem,
    onRefreshBudget,
    canEditBudget,
    canEdit,
    dayItems,
    days,
    isOwner,
    items,
    guideItems,
    currentUserId,
    foreignCardSelection,
    foreignDragPresence,
    foreignSameDayDragActive,
    luggageItems,
    luggageTab,
    members,
    packItems,
    routeOverridePointsBySegment = {},
    routeOverrideSaveError = "",
    routeEditCollaboration = {},
    sharedLuggageItems,
    todayDayIndex,
    todayItems,
    todoItems,
    timelineDayTabPresenceByDay,
    onActiveDay,
    packCommands,
    timelineCommands,
    memberCommands,
    stayActions,
    attachmentCommands,
    todoGuideActions,
    luggageCommands,
    onClearCardSelection,
    onClearDragPresence,
    onPublishDragPresence,
    onPublishCardSelection,
    onSaveRouteOverride,
    onRouteEditCollaborationEvent,
    onRouteEditPresenceChange,
    onLuggageTabChange,
    onSectionChange,
  } = props;
  const isTodayMode = activeSection === "today";
  const isBudgetMode = activeSection === "budget";
  const isAccommodationMode = activeSection === "accommodation";
  const isTodoMode = activeSection === "todo";
  const isLuggageMode = activeSection === "luggage";
  const isSettlementMode = activeSection === "settlement";
  const [focusedItemId, setFocusedItemId] = useState(null);
  const sidePanelsRef = useRef(null);
  const { isMapClosing, isRouteCollapsed, isRouteLayoutCollapsed, openRouteMap, toggleRouteMap } = useTimelineMapTransition();
  const alternativesByItem = useMemo(() => {
    const next = {};
    alternatives.forEach((alternative) => {
      next[alternative.itinerary_item_id] = [...(next[alternative.itinerary_item_id] || []), alternative];
    });
    return next;
  }, [alternatives]);
  const itemsByDay = useMemo(
    () => days.map((_, index) => sortScheduleItems(items.filter((item) => item.day_index === index))),
    [days, items],
  );
  const dayBoardNavigation = useDayBoardNavigation(activeDay, isRouteLayoutCollapsed);

  const { mapPointPicker, toggleRouteMapWithAddLocationCleanup } = useTimelineMapPointPicker({
    activeDay,
    activeTripId: activeTrip?.id,
    activeSection,
    canEdit,
    canLoadRealMap: getMapProviderConfig({
      providerId: import.meta.env.VITE_MAP_PROVIDER,
      apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
      enableRealMap: true,
    }).canLoadRealMap,
    isMapClosing,
    isRouteCollapsed,
    isRouteLayoutCollapsed,
    openRouteMap,
    sidePanelsRef,
    toggleRouteMap,
  });

  function selectTimelineDay(dayIndex) {
    if (Number(dayIndex) !== Number(activeDay)) setFocusedItemId(null);
    onActiveDay(dayIndex);
    if (isRouteLayoutCollapsed) dayBoardNavigation.scrollToDay(dayIndex);
  }

  return (
    <section className="trip-editor">

      {isTodayMode ? (
        <TodayMode
          canEdit={canEdit}
          dayIndex={todayDayIndex}
          days={days}
          items={todayItems}
          packItems={packItems}
          trip={activeTrip}
          onGoBudget={() => onSectionChange("budget")}
          onGoTimeline={async () => {
            if (await onSectionChange("timeline")) selectTimelineDay(todayDayIndex);
          }}
        />
      ) : null}

      {isTodayMode || isBudgetMode || isAccommodationMode || isTodoMode || isLuggageMode || isSettlementMode ? null : (
        <div className={`timeline-top-row${isRouteLayoutCollapsed ? " route-collapsed" : ""}`}>
          <DayTabs
            activeDay={activeDay}
            days={days}
            layoutMode={isRouteLayoutCollapsed ? "collapsed" : "expanded"}
            onActiveDay={selectTimelineDay}
            dayTabPresenceByDay={timelineDayTabPresenceByDay}
          />
          <button
            className="ghost-button compact timeline-map-toggle"
            type="button"
            title={isRouteCollapsed ? "顯示地圖" : "隱藏地圖"}
            aria-label={isRouteCollapsed ? "顯示地圖" : "隱藏地圖"}
            onClick={toggleRouteMapWithAddLocationCleanup}
          >
            {isRouteCollapsed ? (
              <MapIcon size={18} strokeWidth={2.2} aria-hidden="true" />
            ) : (
              <PanelRightClose size={18} strokeWidth={2.2} aria-hidden="true" />
            )}
          </button>
        </div>
      )}

      <div className={isBudgetMode ? "" : "hidden-section"}>
        <BudgetPanel
          workspaceActive={isBudgetMode}
          activeTrip={activeTrip}
          metadataSnapshot={budgetSnapshot}
          onRefreshBudget={onRefreshBudget}
          canEdit={canEditBudget ?? canEdit}
          members={members}
          currentUserId={currentUserId}
        />
      </div>

      <div className={isAccommodationMode ? "" : "hidden-section"}>
        <AccommodationPanel
          activeTrip={activeTrip}
          accommodations={accommodations}
          attachments={attachments}
          expenseGraph={budgetSnapshot?.expenseGraph}
          canEdit={canEdit}
          currentUserId={currentUserId}
          trip={activeTrip}
          onDeleteAttachment={attachmentCommands.deleteAttachment}
          onDelete={stayActions.deleteAccommodation}
          onOpenAttachment={attachmentCommands.openAttachment}
          onSave={stayActions.saveAccommodation}
          onUploadAttachment={attachmentCommands.uploadAttachment}
          restoreDrafts={isAccommodationMode}
        />
      </div>

      <div className={isTodoMode ? "" : "hidden-section"}>
        <TodoGuidePanel
          activeTrip={activeTrip}
          canEdit={canEdit}
          currentUserId={currentUserId}
          guideItems={guideItems}
          members={members}
          todoItems={todoItems}
          onDeleteGuide={todoGuideActions.deleteGuide}
          onDeleteTodo={todoGuideActions.deleteTodo}
          onSaveGuide={todoGuideActions.saveGuide}
          onSaveTodo={todoGuideActions.saveTodo}
          onToggleTodo={todoGuideActions.toggleTodo}
          restoreDrafts={isTodoMode}
        />
      </div>

      <div className={isLuggageMode ? "" : "hidden-section"}>
        <LuggagePanel key={`${activeTrip.id}:${currentUserId}`}
          activeTrip={activeTrip}
          activeTab={luggageTab}
          canEdit={members.some(member => member.user_id === currentUserId && member.status === "approved")}
          currentUserId={currentUserId}
          isOwner={activeTrip.owner_id === currentUserId}
          luggageItems={luggageItems}
          members={members}
          restoreDrafts={isLuggageMode}
          sharedLuggageItems={sharedLuggageItems}
          onDeletePersonal={luggageCommands.deleteLuggageItem}
          onDeleteShared={luggageCommands.deleteSharedLuggageItem}
          onSavePersonal={luggageCommands.saveLuggageItem}
          onSaveShared={luggageCommands.saveSharedLuggageItem}
          onAssign={luggageCommands.assignTripLuggage}
          onPrivatize={luggageCommands.privatizeTripLuggage}
          onReorder={luggageCommands.reorderTripLuggage}
          onTabChange={onLuggageTabChange}
          onTogglePersonal={luggageCommands.toggleLuggageItem}
          onUpdateShared={luggageCommands.updateSharedLuggageItem}
        />
      </div>

      <div className={isSettlementMode ? "" : "hidden-section"}>
        <SettlementPanel
          activeTrip={activeTrip}
          expenseGraph={budgetSnapshot?.expenseGraph}
          actualExpenses={actualExpenses}
          actualParticipants={actualParticipants}
          budgetItems={budgetItems}
          members={members}
        />
      </div>

      <div
        className={`content-grid timeline-workbench${isRouteLayoutCollapsed ? " route-collapsed" : ""}${
          isTodayMode || isBudgetMode || isAccommodationMode || isTodoMode || isLuggageMode || isSettlementMode
            ? " hidden-section"
            : ""
        }`}
      >
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
                activeTrip={activeTrip}
                activeDay={activeDay}
                alternativesByItem={alternativesByItem}
                budgetsByItem={budgetsByItem}
                canEdit={canEdit}
                currentUserId={currentUserId}
                foreignCardSelection={foreignCardSelection}
                foreignDragPresence={foreignDragPresence}
                foreignSameDayDragActive={foreignSameDayDragActive}
                members={members}
                dayItems={dayItems}
                dayDateLabel={days[activeDay] ? formatDate(days[activeDay]) : ""}
                dayLabel={days[activeDay] ? `Day ${activeDay + 1} · ${formatDate(days[activeDay])}` : ""}
                dayTitle={`DAY ${activeDay + 1}`}
                focusedItemId={focusedItemId}
                {...mapPointPicker}
                onApplyAlternative={timelineCommands.applyAlternative}
                onClearDragPresence={onClearDragPresence}
                onConfirmTransportWarning={timelineCommands.confirmTransportWarning}
                onDeleteAlternative={timelineCommands.deleteAlternative}
                onDeleteItem={timelineCommands.deleteItem}
                onClearCardSelection={onClearCardSelection}
                onFocusItem={setFocusedItemId}
                onPublishCardSelection={onPublishCardSelection}
                onPublishDragPresence={onPublishDragPresence}
                onReorderDestinationPackages={timelineCommands.reorderDestinationPackages}
                onReorderUntimedVisit={timelineCommands.reorderUntimedVisit}
                onSaveAlternative={timelineCommands.saveAlternative}
                onSaveItem={timelineCommands.saveItem}
                onToggleItemFixed={timelineCommands.toggleItemFixed}
                restoreDrafts={activeSection === "timeline"}
              />
              {isRouteLayoutCollapsed ? (
                <MultiDayTimelineColumns
                  activeDay={activeDay}
                  alternativesByItem={alternativesByItem}
                  budgetsByItem={budgetsByItem}
                  days={days}
                  itemsByDay={itemsByDay}
                  dayBoardPresenceByDay={timelineDayTabPresenceByDay}
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
              <aside className={`side-panels${isMapClosing ? " is-closing" : ""}`} ref={sidePanelsRef}>
                <RoutePanel
                  dayItems={dayItems}
                  focusedItemId={focusedItemId}
                  {...mapPointPicker}
                  mode="formal"
                  routeOverridePointsBySegment={routeOverridePointsBySegment}
                  routeOverrideSaveError={routeOverrideSaveError}
                  routeEditCollaboration={routeEditCollaboration}
                  viewportKey={`formal-day:${activeDay}`}
                  onFocusItem={setFocusedItemId}
                  onRouteOverrideChange={onSaveRouteOverride}
                  onRouteEditCollaborationEvent={onRouteEditCollaborationEvent}
                  onRouteEditPresenceChange={onRouteEditPresenceChange}
                />
              </aside>
            )}
      </div>
    </section>
  );
}
