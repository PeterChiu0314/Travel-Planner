import { useCallback, useEffect, useRef, useState } from "react";

export function useDayBoardNavigation(activeDay, isEnabled) {
  const boardRef = useRef(null);
  const [scrollState, setScrollState] = useState({ left: false, right: false });
  const updateScrollState = useCallback(() => {
    const board = boardRef.current;
    if (!board || !isEnabled) {
      setScrollState({ left: false, right: false });
      return;
    }
    const hasVerticalScrollbar = board.scrollHeight > board.clientHeight + 1;
    const measuredScrollbarWidth = Math.max(0, board.offsetWidth - board.clientWidth);
    const scrollbarWidth = hasVerticalScrollbar ? Math.max(12, measuredScrollbarWidth) : 0;
    board.closest(".timeline-workbench")?.style.setProperty("--board-scrollbar-width", `${scrollbarWidth}px`);
    setScrollState({
      left: board.scrollLeft > 4,
      right: board.scrollLeft + board.clientWidth < board.scrollWidth - 4,
    });
  }, [isEnabled]);

  const scrollToDay = useCallback(
    (dayIndex) => {
      if (!isEnabled) return;
      requestAnimationFrame(() => {
        const board = boardRef.current;
        const column = board?.querySelector(`[data-day-index="${dayIndex}"]`);
        if (!board || !column) return;
        board.scrollTo({
          left: Math.max(0, column.offsetLeft - board.offsetLeft - 340),
          behavior: "smooth",
        });
        requestAnimationFrame(updateScrollState);
      });
    },
    [isEnabled, updateScrollState],
  );

  const scrollByDirection = useCallback(
    (direction) => {
      const board = boardRef.current;
      if (!board || !isEnabled) return;
      const column = board.querySelector(".timeline-day-column, .timeline-day-preview");
      const distance = column ? column.getBoundingClientRect().width + 14 : 360;
      board.scrollBy({ left: direction * distance, behavior: "smooth" });
      requestAnimationFrame(updateScrollState);
    },
    [isEnabled, updateScrollState],
  );

  useEffect(() => {
    if (!isEnabled) return;
    scrollToDay(activeDay);
    updateScrollState();
  }, [activeDay, isEnabled, scrollToDay, updateScrollState]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board || !isEnabled) return;
    board.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(board);
    updateScrollState();
    return () => {
      board.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
      resizeObserver.disconnect();
    };
  }, [isEnabled, updateScrollState]);

  return { boardRef, scrollByDirection, scrollState, scrollToDay };
}

const timelineMapTransitionMs = 220;

export function useTimelineMapTransition() {
  const [isRouteCollapsed, setIsRouteCollapsed] = useState(false);
  const [isMapClosing, setIsMapClosing] = useState(false);
  const closeTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) window.clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  const toggleRouteMap = useCallback(() => {
    if (isMapClosing) return;
    if (isRouteCollapsed) {
      setIsRouteCollapsed(false);
      return;
    }

    setIsMapClosing(true);
    const closeDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : timelineMapTransitionMs;
    closeTimeoutRef.current = window.setTimeout(() => {
      setIsRouteCollapsed(true);
      setIsMapClosing(false);
      closeTimeoutRef.current = null;
    }, closeDelay);
  }, [isMapClosing, isRouteCollapsed]);

  const openRouteMap = useCallback(() => {
    if (closeTimeoutRef.current) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setIsMapClosing(false);
    setIsRouteCollapsed(false);
  }, []);

  return {
    isMapClosing,
    isRouteCollapsed,
    isRouteLayoutCollapsed: isRouteCollapsed,
    openRouteMap,
    toggleRouteMap,
  };
}
