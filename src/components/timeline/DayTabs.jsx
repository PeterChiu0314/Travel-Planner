import { useEffect, useRef, useState } from "react";
import { timelineCardSelectionColor } from "../../lib/collaboratorColors.js";

function formatDayTabDate(date) {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "numeric",
    day: "numeric",
  }).format(date);
}

export default function DayTabs({ activeDay, days, layoutMode = "expanded", onActiveDay, dayTabPresenceByDay = new Map() }) {
  const dragStateRef = useRef({ isDragging: false, startX: 0, scrollLeft: 0, moved: false, lastX: 0, lastTime: 0, velocity: 0 });
  const momentumFrameRef = useRef(null);
  const navRef = useRef(null);
  const suppressClickRef = useRef(false);
  const [tabScrollState, setTabScrollState] = useState({ left: false, right: false });

  function updateTabScrollState() {
    const nav = navRef.current;
    if (!nav) return;
    const maxScrollLeft = Math.max(0, nav.scrollWidth - nav.clientWidth);
    setTabScrollState({
      left: nav.scrollLeft > 1,
      right: nav.scrollLeft < maxScrollLeft - 1,
    });
  }

  function stopMomentum() {
    if (momentumFrameRef.current) {
      window.cancelAnimationFrame(momentumFrameRef.current);
      momentumFrameRef.current = null;
    }
  }

  function glideTabs(nav, velocity) {
    if (Math.abs(velocity) < 0.02) {
      momentumFrameRef.current = null;
      return;
    }
    nav.scrollLeft -= velocity * 16;
    momentumFrameRef.current = window.requestAnimationFrame(() => glideTabs(nav, velocity * 0.92));
  }

  function startDrag(event) {
    const nav = event.currentTarget;
    stopMomentum();
    dragStateRef.current = {
      isDragging: true,
      startX: event.clientX,
      scrollLeft: nav.scrollLeft,
      moved: false,
      lastX: event.clientX,
      lastTime: performance.now(),
      velocity: 0,
    };
    nav.setPointerCapture(event.pointerId);
  }

  function dragTabs(event) {
    const dragState = dragStateRef.current;
    if (!dragState.isDragging) return;
    const now = performance.now();
    const distance = event.clientX - dragState.startX;
    const elapsed = Math.max(now - dragState.lastTime, 1);
    if (Math.abs(distance) > 12) dragState.moved = true;
    dragState.velocity = (event.clientX - dragState.lastX) / elapsed;
    dragState.lastX = event.clientX;
    dragState.lastTime = now;
    event.currentTarget.scrollLeft = dragState.scrollLeft - distance;
  }

  function endDrag(event) {
    const nav = event.currentTarget;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (dragStateRef.current.moved) {
      suppressClickRef.current = true;
      glideTabs(nav, dragStateRef.current.velocity);
    } else {
      const hitTarget = document.elementFromPoint(event.clientX, event.clientY);
      const tab = hitTarget ? hitTarget.closest(".day-tab") : null;
      const dayIndex = tab ? Number(tab.dataset.dayIndex) : NaN;
      if (Number.isInteger(dayIndex)) onActiveDay(dayIndex);
    }
    dragStateRef.current.isDragging = false;
  }

  function selectDay(index) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onActiveDay(index);
  }

  function scrollTabs(direction) {
    const nav = navRef.current;
    if (!nav) return;
    stopMomentum();
    nav.scrollBy({ left: direction * Math.max(nav.clientWidth * 0.72, 160), behavior: "smooth" });
  }

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    function alignActiveTab() {
      if (activeDay === 0) {
        nav.scrollLeft = 0;
        return;
      }
      if (activeDay === days.length - 1) {
        nav.scrollLeft = nav.scrollWidth - nav.clientWidth;
        return;
      }
      const activeTab = nav.querySelector(`[data-day-index="${activeDay}"]`);
      activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    alignActiveTab();
    updateTabScrollState();
    const frame = window.requestAnimationFrame(() => {
      alignActiveTab();
      updateTabScrollState();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeDay, days.length, layoutMode]);

  useEffect(() => {
    updateTabScrollState();
    window.addEventListener("resize", updateTabScrollState);
    return () => window.removeEventListener("resize", updateTabScrollState);
  }, [days.length, layoutMode]);

  return (
    <div
      className={`day-tabs-shell ${layoutMode === "collapsed" ? "is-collapsed" : "is-expanded"}${
        tabScrollState.left ? " has-left-edge" : ""
      }${tabScrollState.right ? " has-right-edge" : ""}`}
    >
      {tabScrollState.left ? (
        <button className="day-tabs-edge left" type="button" aria-label="向左滑動日期" onClick={() => scrollTabs(-1)}>
          ‹
        </button>
      ) : null}
      <nav
      className="day-tabs"
      ref={navRef}
      aria-label="日期切換"
      onPointerDown={startDrag}
      onPointerMove={dragTabs}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onScroll={updateTabScrollState}
      onPointerLeave={(event) => {
        if (dragStateRef.current.isDragging) endDrag(event);
      }}
    >
      {days.map((date, index) => {
        const presences = dayTabPresenceByDay.get(index) || [];
        const firstPresence = presences[0] || null;
        return (
          <button
            className={`day-tab${index === activeDay ? " active" : ""}${firstPresence ? " has-remote-presence" : ""}`}
            data-day-index={index}
            key={date.toISOString()}
            style={firstPresence ? { "--trip-presence-color": timelineCardSelectionColor(firstPresence.colorKey) } : undefined}
            type="button"
            onClick={() => selectDay(index)}
          >
          <span className="day-tab-index">DAY {index + 1}</span>
          <span className="day-tab-separator" aria-hidden="true">
            ·
          </span>
          <span className="day-tab-date">{formatDayTabDate(date)}</span>
          </button>
        );
      })}
      </nav>
      {tabScrollState.right ? (
        <button className="day-tabs-edge right" type="button" aria-label="向右滑動日期" onClick={() => scrollTabs(1)}>
          ›
        </button>
      ) : null}
    </div>
  );
}
