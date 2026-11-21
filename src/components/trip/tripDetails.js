import { dateToInputValue, todayInput } from "../../lib/displayFormat.js";
import { formatDateKey, formatHeaderDate, parseDateOnly } from "../../lib/tripDateUi.js";
import { tripDays } from "../../lib/timelineTime.js";

export function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(date.getDate() + amount);
  return next;
}

export function tripTodayIndex(trip) {
  const days = tripDays(trip);
  if (!days.length) return 0;
  const today = todayInput();
  const index = days.findIndex((date) => dateToInputValue(date) === today);
  if (index >= 0) return index;
  if (today < dateToInputValue(days[0])) return 0;
  return days.length - 1;
}

function getTodayDateKey() {
  return todayInput();
}

function normalizeDateOnlyKey(value) {
  const date = parseDateOnly(value);
  return date ? formatDateKey(date) : "";
}

export function deriveTripStage(startDate, endDate, todayDate = getTodayDateKey()) {
  const startKey = normalizeDateOnlyKey(startDate);
  const endKey = normalizeDateOnlyKey(endDate);
  const todayKey = normalizeDateOnlyKey(todayDate);
  if (!startKey || !endKey || !todayKey || endKey < startKey) return "unset";
  if (todayKey < startKey) return "planning";
  if (todayKey > endKey) return "settled";
  return "traveling";
}

export function tripStageLabel(stage) {
  return {
    unset: "階段未設定",
    planning: "規劃階段",
    traveling: "旅行階段",
    settled: "結算階段",
  }[stage || "unset"] || "階段未設定";
}

function splitTripDestinationFallback(destination) {
  const value = String(destination || "").trim();
  if (!value) return { city: "", country: "" };
  const dotParts = value
    .split(" · ")
    .map((part) => part.trim())
    .filter(Boolean);
  if (dotParts.length === 2) return { country: dotParts[0], city: dotParts[1] };
  const parts = value
    .split(/[,，]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 2) return { country: parts[1], city: parts[0] };
  return { city: value, country: "" };
}

export function tripDestinationParts(trip) {
  const country = String(trip?.destination_country || "").trim();
  const city = String(trip?.destination_city || "").trim();
  if (country || city) return { country, city };
  return splitTripDestinationFallback(trip?.destination);
}

export function combineTripDestination(country, city) {
  return [country, city].map((part) => String(part || "").trim()).filter(Boolean).join(" · ");
}

function tripDestinationLabel(trip) {
  const { country, city } = tripDestinationParts(trip);
  return combineTripDestination(country, city) || "目的地未設定";
}

export function destinationPatchFromParts(country, city) {
  const nextCountry = String(country || "").trim();
  const nextCity = String(city || "").trim();
  return {
    destination: combineTripDestination(nextCountry, nextCity),
    destination_city: nextCity || null,
    destination_country: nextCountry || null,
  };
}

export function destinationPatchFromText(destination) {
  const parts = splitTripDestinationFallback(destination);
  return destinationPatchFromParts(parts.country, parts.city);
}

export function buildTripHeaderMeta(trip, members, days) {
  if (!trip) return {};
  const approvedMemberCount = members.filter((member) => member.status === "approved").length;
  const destinationLabel = tripDestinationLabel(trip);
  const startDate = formatHeaderDate(trip.start_date);
  const endDate = formatHeaderDate(trip.end_date);
  const stage = deriveTripStage(trip.start_date, trip.end_date);
  return {
    destinationLabel,
    dateRangeLabel: startDate && endDate ? `${startDate} - ${endDate}` : "",
    dayCountLabel: days.length ? `${days.length} 天` : "",
    stage,
    statusLabel: tripStageLabel(stage),
    membersLabel: `${approvedMemberCount} 位成員`,
  };
}
