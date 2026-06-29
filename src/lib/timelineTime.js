export function roundMinutesUpToStep(totalMinutes, stepMinutes = 5) {
  if (!Number.isFinite(totalMinutes) || !Number.isFinite(stepMinutes) || stepMinutes <= 0) return null;
  return Math.ceil(totalMinutes / stepMinutes) * stepMinutes;
}
