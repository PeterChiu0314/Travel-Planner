import { useEffect, useRef } from "react";
import { LayoutList } from "lucide-react";

export default function SidebarTripSection({
  activeTripId,
  collapsed = false,
  createDisabled = false,
  createTitle = "新增旅程",
  flyoutId,
  headingId,
  isFlyoutOpen,
  onCloseFlyout,
  onCreate,
  onSelect,
  onToggleFlyout,
  trips,
}) {
  const flyoutRef = useRef(null);

  useEffect(() => {
    if (!collapsed || !isFlyoutOpen) return undefined;
    function handlePointerDown(event) {
      if (!flyoutRef.current || flyoutRef.current.contains(event.target)) return;
      onCloseFlyout();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [collapsed, isFlyoutOpen, onCloseFlyout]);

  function handleCreate() {
    if (createDisabled) return;
    onCloseFlyout();
    onCreate();
  }

  function handleSelect(tripId) {
    onCloseFlyout();
    onSelect(tripId);
  }

  if (!collapsed) {
    return (
      <section className="sidebar-trip-section" aria-labelledby={headingId}>
        <div className="sidebar-trip-heading">
          <div className="sidebar-trip-heading-copy">
            <h2 id={headingId}>我的旅程</h2>
            <p>{trips.length} 個旅程</p>
          </div>
          <button className="mini-button sidebar-create-trip" type="button" title={createTitle} aria-label={createTitle} disabled={createDisabled} onClick={handleCreate}>
            +
          </button>
        </div>
        <div className="sidebar-trip-list-region">
          <TripList trips={trips} activeTripId={activeTripId} compact={false} onCreate={handleCreate} onSelect={handleSelect} />
        </div>
      </section>
    );
  }

  return (
    <section className="sidebar-trip-section sidebar-trip-section-collapsed" aria-label="旅程操作" ref={flyoutRef}>
      <div className="sidebar-trip-menu-divider" aria-hidden="true" />
      <button
        className={`mini-button sidebar-trip-menu-button${isFlyoutOpen ? " active" : ""}`}
        type="button"
        title="我的旅程"
        aria-label="我的旅程"
        aria-controls={flyoutId}
        aria-expanded={isFlyoutOpen}
        onClick={onToggleFlyout}
      >
        <LayoutList size={19} strokeWidth={2.2} aria-hidden="true" />
      </button>
      {isFlyoutOpen ? (
        <div className="sidebar-trip-flyout" id={flyoutId}>
          <div className="sidebar-trip-heading">
            <div className="sidebar-trip-heading-copy">
              <h2 id={headingId}>我的旅程</h2>
              <p>{trips.length} 個旅程</p>
            </div>
            <button className="mini-button sidebar-create-trip" type="button" title={createTitle} aria-label={createTitle} disabled={createDisabled} onClick={handleCreate}>
              +
            </button>
          </div>
          <div className="sidebar-trip-list-region">
            <TripList trips={trips} activeTripId={activeTripId} compact={false} onCreate={handleCreate} onSelect={handleSelect} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function getTripInitials(title = "") {
  const compactTitle = title.trim();
  if (!compactTitle) return "旅";
  return Array.from(compactTitle).slice(0, 1).join("");
}

function TripList({ trips, activeTripId, compact = false, onCreate, onSelect }) {
  if (!trips.length) {
    return (
      <button className="trip-empty-card" type="button" onClick={onCreate}>
        + 建立第一個旅程
      </button>
    );
  }

  return (
    <div className="trip-list" aria-label="旅程列表">
      {trips.map((trip) => (
        <button
          className={`trip-card${trip.id === activeTripId ? " active" : ""}`}
          key={trip.id}
          type="button"
          title={trip.title}
          aria-label={`${trip.title}${trip.id === activeTripId ? "，目前旅程" : ""}`}
          onClick={() => onSelect(trip.id)}
        >
          <strong>{compact ? getTripInitials(trip.title) : trip.title}</strong>
          <span>
            {trip.destination} · {trip.start_date}
          </span>
          {trip.membership.status === "pending" ? <em>等待核准</em> : null}
        </button>
      ))}
    </div>
  );
}
