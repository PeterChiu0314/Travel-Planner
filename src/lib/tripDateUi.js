import { dateToInputValue } from "./displayFormat.js";

export function parseDateOnly(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

export function formatDateKey(date) {
  return dateToInputValue(date);
}

export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function isDateBefore(first, second) {
  return Boolean(first && second && first < second);
}

function normalizeDateInput(value) {
  const text = String(value || "").trim();
  let match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) match = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return "";
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function parseDateTextInput(value) {
  const normalized = normalizeDateInput(value);
  if (!normalized) return "";
  return parseDateOnly(normalized) ? normalized : "";
}

export function formatHeaderDate(value) {
  if (!value) return "";
  const date = parseDateOnly(value);
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

export function dateRangeDayCount(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end || end < start) return null;
  return Math.round((end - start) / 86400000) + 1;
}

export function initialDateSelectionStep(startDate, endDate) {
  return startDate && !endDate ? "end" : "start";
}
