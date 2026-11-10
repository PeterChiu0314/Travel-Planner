export function roundMinutesUpToStep(totalMinutes, stepMinutes = 5) {
  if (!Number.isFinite(totalMinutes) || !Number.isFinite(stepMinutes) || stepMinutes <= 0) return null;
  return Math.ceil(totalMinutes / stepMinutes) * stepMinutes;
}

export function tripDays(trip) {
  if (!trip?.start_date || !trip?.end_date) return [];
  const start = new Date(`${trip.start_date}T00:00:00`);
  const end = new Date(`${trip.end_date}T00:00:00`);
  const diff = Math.max(0, Math.round((end - start) / 86400000));
  return Array.from({ length: diff + 1 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}
