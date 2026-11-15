import { Fragment } from "react";
import { timelineCardSelectionColor } from "../../lib/collaboratorColors.js";
import { formatDate, formatMoney, formatTimeDisplay } from "../../lib/displayFormat.js";
import { transportCardTitle } from "../../lib/timelineTransportCategories.js";
import { isEstablishedTransportPair, isTransportationCard, transportPairKey } from "../../lib/timelineTransportationRoles.js";
import { timelineTypeColors as typeColors, timelineTypeLabels as typeLabels } from "../../lib/timelineTypeStyles.js";
import { buildTimelineVisitDisplayOrder, isTimedVisit } from "../../lib/timelineUntimedOrdering.js";
import TransportCategoryIcon from "./TransportCategoryIcon.jsx";

function buildAdjacentTransportMap(items, visits) {
  const adjacentKeys = new Set();
  visits.forEach((item, index) => {
    const nextItem = visits[index + 1];
    if (nextItem) adjacentKeys.add(transportPairKey(item.id, nextItem.id));
  });
  const next = {};
  items
    .filter((item) => isTransportationCard(item) && isEstablishedTransportPair(item) && item.from_item_id && item.to_item_id)
    .forEach((item) => {
      const key = transportPairKey(item.from_item_id, item.to_item_id);
      if (adjacentKeys.has(key) && !next[key]) next[key] = item;
    });
  return next;
}

export default function MultiDayTimelineColumns({
  activeDay,
  alternativesByItem = {},
  budgetsByItem = {},
  days,
  dayBoardPresenceByDay = new Map(),
  itemsByDay,
  onActiveDay,
  onFocusItem,
}) {
  const otherDays = days
    .map((date, index) => ({ date, index, items: itemsByDay[index] || [] }))
    .filter((day) => day.index !== activeDay);
  if (!otherDays.length) return null;

  return (
    <>
      {otherDays.map((day) => {
        const visits = buildTimelineVisitDisplayOrder(day.items);
        const adjacentTransportByPair = buildAdjacentTransportMap(day.items, visits);
        const dayBoardPresences = (dayBoardPresenceByDay.get(day.index) || []).slice(0, 3);
        return (
        <section
          className="timeline-day-preview"
          data-day-index={day.index}
          key={day.date.toISOString()}
          role="button"
          tabIndex={0}
          style={{ order: day.index }}
          onClick={() => onActiveDay(day.index)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onActiveDay(day.index);
            }
          }}
        >
          <div className="timeline-day-preview-heading timeline-column-header">
            <div className="timeline-column-title">
              <p className="eyebrow">Day {day.index + 1}</p>
              <h4>{formatDate(day.date)}</h4>
            </div>
            {dayBoardPresences.length ? (
              <div className="timeline-day-presence-dots" aria-label="Remote members on this day">
                {dayBoardPresences.map((presence) => (
                  <span
                    className="timeline-day-presence-dot"
                    key={presence.sessionId || `${presence.userId}-${presence.colorKey}`}
                    style={{ "--trip-presence-color": timelineCardSelectionColor(presence.colorKey) }}
                    title={presence.userName || "Remote member"}
                  />
                ))}
              </div>
            ) : null}
          </div>
          <div className="timeline-preview-list">
            {visits.length ? (
              visits.map((item, index) => {
                const destination = item.location_name || item.location || item.title;
                const secondaryText = item.note || item.description || item.transportation_note;
                const linkedBudgetTotal = (budgetsByItem[item.id] || []).reduce(
                  (sum, budget) => sum + Number(budget.twd_amount ?? budget.amount ?? 0),
                  0,
                );
                const displayCost = (budgetsByItem[item.id] || []).length ? linkedBudgetTotal : Number(item.cost || 0);
                const hasAlternative = Boolean((alternativesByItem[item.id] || []).length);
                const nextItem = visits[index + 1];
                const pairKey = nextItem ? transportPairKey(item.id, nextItem.id) : "";
                const transportItem = pairKey ? adjacentTransportByPair[pairKey] : null;
                return (
                  <Fragment key={item.id}>
                  <button
                    className="timeline-preview-card"
                    type="button"
                    onClick={() => {
                      onActiveDay(day.index);
                      onFocusItem(item.id);
                    }}
                  >
                    <span className="time-block">{isTimedVisit(item) ? formatTimeDisplay(item.start_time) : "--:--"}</span>
                    <span className="timeline-preview-content">
                      <strong>{destination}</strong>
                      {secondaryText ? <em>{secondaryText}</em> : null}
                      <span className="timeline-preview-meta">
                        {typeLabels[item.type] ? (
                          <span
                            className="pill"
                            style={{ background: `${typeColors[item.type]}22`, color: typeColors[item.type] }}
                          >
                            {typeLabels[item.type]}
                          </span>
                        ) : null}
                        {displayCost > 0 ? <span className="pill">{formatMoney(displayCost)}</span> : null}
                        {hasAlternative ? <span className="pill">備案</span> : null}
                      </span>
                    </span>
                  </button>
                  {transportItem ? (
                    <button
                      className="timeline-preview-card transport-preview-card"
                      type="button"
                      onClick={() => {
                        onActiveDay(day.index);
                        onFocusItem(transportItem.id);
                      }}
                    >
                      <span className="transport-icon" aria-hidden="true">
                        <TransportCategoryIcon category={transportItem.transport_category} />
                      </span>
                      <span>
                        <strong>{transportCardTitle(transportItem)}</strong>
                      </span>
                    </button>
                  ) : null}
                  </Fragment>
                );
              })
            ) : (
              <div className="timeline-empty compact">這一天還沒有行程</div>
            )}
          </div>
        </section>
        );
      })}
    </>
  );
}
