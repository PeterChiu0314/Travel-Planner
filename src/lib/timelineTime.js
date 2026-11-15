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

export function normalizeTimelineTimeInput(value) {
  const text = String(value || "").trim();
  if (!text) return { ok: true, value: "" };
  const compact = text.replace(/\s+/g, "");
  let hours;
  let minutes;
  if (/^\d{1,2}:\d{1,2}$/.test(compact)) {
    [hours, minutes] = compact.split(":").map(Number);
  } else if (/^\d{3,4}$/.test(compact)) {
    hours = Number(compact.slice(0, -2));
    minutes = Number(compact.slice(-2));
  } else {
    return { ok: false, value: text };
  }
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return { ok: false, value: text };
  }
  const rounded = ((hours * 60 + Math.round(minutes / 5) * 5) % (24 * 60) + 24 * 60) % (24 * 60);
  return { ok: true, value: minutesToTimeValue(rounded) };
}

export function minutesToTimeValue(totalMinutes) {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0 || totalMinutes >= 24 * 60) return "";
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function timeToMinutes(value) {
  if (!value) return null;
  const [hours, minutes] = String(value).split(":");
  const parsedHours = Number(hours);
  const parsedMinutes = Number(minutes);
  if (!Number.isFinite(parsedHours) || !Number.isFinite(parsedMinutes)) return null;
  return parsedHours * 60 + parsedMinutes;
}

export function formatDurationMinutes(value) {
  const minutes = Number(value || 0);
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (!hours) return `${remainingMinutes}分鐘`;
  if (!remainingMinutes) return `${hours}小時`;
  return `${hours}小時${remainingMinutes}分鐘`;
}

export function parseDurationMinutes(value) {
  const text = String(value || "").trim();
  const hourMatch = text.match(/(\d+)\s*小時/);
  const minuteMatch = text.match(/(\d+)\s*分鐘/);
  return /^\d+$/.test(text)
    ? Number(text)
    : Number(hourMatch?.[1] || 0) * 60 + Number(minuteMatch?.[1] || 0);
}

export function formatTransportDurationMinutes(value) {
  const minutes = Number(value || 0);
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (!hours) return `${remainingMinutes} 分鐘`;
  if (!remainingMinutes) return `${hours} 小時`;
  return `${hours} 小時 ${remainingMinutes} 分鐘`;
}
