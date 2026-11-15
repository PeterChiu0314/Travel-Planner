import { useEffect, useRef, useState } from "react";

export default function useTimelineVisitDragSession({ activeDay, tripId, onClearDragPresence }) {
  const [draggedVisitId, setDraggedVisitId] = useState(null);
  const [dragOverlaySize, setDragOverlaySize] = useState(null);
  const [dragTarget, setDragTarget] = useState(null);
  const lastDndOverIdRef = useRef(null);

  function clearVisitDrag(reason = "manual") {
    setDraggedVisitId(null);
    setDragOverlaySize(null);
    setDragTarget(null);
    lastDndOverIdRef.current = null;
    if (typeof onClearDragPresence === "function") onClearDragPresence(reason);
  }

  useEffect(() => {
    clearVisitDrag("scope-change");
  }, [activeDay, tripId]);

  useEffect(() => {
    if (!draggedVisitId) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") clearVisitDrag("escape");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      lastDndOverIdRef.current = null;
    };
  }, [draggedVisitId]);

  return {
    clearVisitDrag,
    draggedVisitId,
    dragOverlaySize,
    dragTarget,
    lastDndOverIdRef,
    setDraggedVisitId,
    setDragOverlaySize,
    setDragTarget,
  };
}
