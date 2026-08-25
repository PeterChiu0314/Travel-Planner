import { isValidTripJsonDate, tripJsonDateForDay, tripJsonDayCount } from "./tripJsonContract.js";

export const aiItineraryDocumentType = "travel_studio_ai_itinerary";
export const aiItineraryCurrentSchemaVersion = "1";
export const aiItineraryMaxTextCharacters = 5_000_000;
export const aiItineraryMigrationSteps = Object.freeze({});

const maxSurroundingTextCharacters = 10_000;
const rootKeys = ["schema_version", "document_type", "trip", "days"];
const tripKeys = ["title", "destination", "start_date", "end_date"];
const destinationKeys = ["display_name", "country", "city"];
const dayKeys = ["day_index", "date", "visits", "transports"];
const visitKeys = ["category", "title", "location", "schedule", "fixed", "notes", "alternatives"];
const alternativeKeys = ["category", "title", "location", "schedule", "notes"];
const locationKeys = ["name", "map_url", "latitude", "longitude"];
const transportKeys = ["from_visit_number", "to_visit_number", "category", "name", "duration_minutes", "notes"];
const scheduleKeysByKind = Object.freeze({
  timed: ["kind", "start", "end"],
  start_duration: ["kind", "start", "duration_minutes"],
  duration: ["kind", "duration_minutes"],
  untimed: ["kind"],
});
const visitCategories = new Set(["attraction", "food", "hotel", "transport", "note"]);
const transportCategories = new Set(["jr", "train", "bus", "walk", "drive", "taxi", "ferry", "flight", "other"]);
const aiVisitCategoryAliases = Object.freeze({ accommodation: "hotel", dining: "food" });
const transportCategoryNames = Object.freeze({
  jr: "JR",
  train: "電車",
  bus: "公車",
  walk: "步行",
  drive: "自駕",
  taxi: "計程車",
  ferry: "渡輪",
  flight: "飛機",
  other: "其他",
});
const refDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const startTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const endTimePattern = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/;
const fencedBlockPattern = /```(?:json)?\s*([\s\S]*?)```/gi;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function issue(target, code, path, message) {
  target.push({ code, path, message });
}

function trimKnownString(value) {
  return typeof value === "string" ? value.trim() : value;
}

function nullableString(value) {
  if (value === null) return null;
  return typeof value === "string" ? value.trim() || null : value;
}

function canonicalizeScheduleAliases(schedule, changes) {
  if (!isPlainObject(schedule)) return schedule;
  const result = { ...schedule };
  if (!Object.hasOwn(result, "start") && Object.hasOwn(result, "start_time")) {
    result.start = result.start_time;
    delete result.start_time;
    changes.add("schedule.start_time->start");
  }
  if (!Object.hasOwn(result, "end") && Object.hasOwn(result, "end_time")) {
    result.end = result.end_time;
    delete result.end_time;
    changes.add("schedule.end_time->end");
  }
  return result;
}

function canonicalizeVisitAliases(visit, changes, { alternative = false } = {}) {
  if (!isPlainObject(visit)) return visit;
  const rawCategory = trimKnownString(visit.category);
  const category = Object.hasOwn(aiVisitCategoryAliases, rawCategory) ? aiVisitCategoryAliases[rawCategory] : visit.category;
  if (category !== visit.category) changes.add(`category.${visit.category}->${category}`);
  return {
    ...visit,
    category,
    location: canonicalizeLocationAliases(visit.location, changes),
    schedule: canonicalizeScheduleAliases(visit.schedule, changes),
    ...(!alternative && Array.isArray(visit.alternatives)
      ? { alternatives: visit.alternatives.map((item) => canonicalizeVisitAliases(item, changes, { alternative: true })) }
      : {}),
  };
}

function canonicalizeLocationAliases(location, changes) {
  const emptyLocation = { name: null, map_url: null, latitude: null, longitude: null };
  if (location === null) {
    changes.add("location:null->object");
    return emptyLocation;
  }
  if (!isPlainObject(location)) return location;
  const result = { ...location };
  if (Object.hasOwn(result, "address")) {
    delete result.address;
    changes.add("location.address:removed");
  }
  if (Object.hasOwn(result, "area")) {
    delete result.area;
    changes.add("location.area:removed");
  }
  if (Object.hasOwn(result, "search_hint")) {
    delete result.search_hint;
    changes.add("location.search_hint:removed");
  }
  locationKeys.forEach((key) => {
    if (!Object.hasOwn(result, key)) {
      result[key] = null;
      changes.add(`location.${key}<-null`);
    }
  });
  return result;
}

function durationMinutesFromNotes(notes) {
  if (typeof notes !== "string") return null;
  const match = notes.match(/(?:約\s*)?(\d{1,4})\s*(?:分鐘|分|min(?:ute)?s?)/i);
  const minutes = match ? Number(match[1]) : null;
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : null;
}

function canonicalizeTransportAliases(transport, changes) {
  if (!isPlainObject(transport)) return transport;
  const result = { ...transport };
  if (!Object.hasOwn(result, "category") && Object.hasOwn(result, "mode")) {
    result.category = result.mode;
    delete result.mode;
    changes.add("transport.mode->category");
  }
  const category = trimKnownString(result.category);
  if (typeof result.name !== "string" || !result.name.trim()) {
    const fallbackName = Object.hasOwn(transportCategoryNames, category) ? transportCategoryNames[category] : null;
    if (fallbackName) {
      result.name = fallbackName;
      changes.add("transport.name<-category");
    }
  }
  if (!Object.hasOwn(result, "duration_minutes")) {
    const durationMinutes = durationMinutesFromNotes(result.notes);
    if (durationMinutes !== null) {
      result.duration_minutes = durationMinutes;
      changes.add("transport.duration_minutes<-notes");
    }
  }
  return result;
}

function canonicalizeZeroBasedTransportNumbers(transports, visitCount, changes) {
  if (!Array.isArray(transports) || !transports.length || !Number.isInteger(visitCount) || visitCount < 1) return transports;
  const refs = transports.flatMap((transport) => [transport?.from_visit_number, transport?.to_visit_number]);
  const isCompleteZeroBasedSet = refs.some((ref) => ref === 0)
    && refs.every((ref) => Number.isInteger(ref) && ref >= 0 && ref < visitCount);
  if (!isCompleteZeroBasedSet) return transports;
  changes.add("transport.visit_numbers:0-based->1-based");
  return transports.map((transport) => ({
    ...transport,
    from_visit_number: transport.from_visit_number + 1,
    to_visit_number: transport.to_visit_number + 1,
  }));
}

function canonicalizeAiGeneratedAliases(document) {
  if (!isPlainObject(document) || !Array.isArray(document.days)) return { document, migrations: [] };
  const changes = new Set();
  const canonical = {
    ...document,
    days: document.days.map((day) => {
      if (!isPlainObject(day)) return day;
      const visits = Array.isArray(day.visits)
        ? day.visits.map((visit) => canonicalizeVisitAliases(visit, changes))
        : day.visits;
      const transports = Array.isArray(day.transports)
        ? day.transports.map((transport) => canonicalizeTransportAliases(transport, changes))
        : day.transports;
      return {
        ...day,
        visits,
        transports: canonicalizeZeroBasedTransportNumbers(transports, Array.isArray(visits) ? visits.length : 0, changes),
      };
    }),
  };
  return { document: canonical, migrations: changes.size ? ["ai_field_aliases_v1"] : [] };
}

function normalizeLocation(location) {
  if (!isPlainObject(location)) return location;
  return {
    ...location,
    name: nullableString(location.name),
    map_url: nullableString(location.map_url),
  };
}

function normalizeSchedule(schedule) {
  if (!isPlainObject(schedule)) return schedule;
  return {
    ...schedule,
    kind: trimKnownString(schedule.kind),
    ...(Object.hasOwn(schedule, "start") ? { start: trimKnownString(schedule.start) } : {}),
    ...(Object.hasOwn(schedule, "end") ? { end: trimKnownString(schedule.end) } : {}),
  };
}

function normalizeAlternative(alternative) {
  if (!isPlainObject(alternative)) return alternative;
  return {
    ...alternative,
    category: trimKnownString(alternative.category),
    title: trimKnownString(alternative.title),
    location: normalizeLocation(alternative.location),
    schedule: normalizeSchedule(alternative.schedule),
    notes: nullableString(alternative.notes),
  };
}

function normalizeVisit(visit) {
  if (!isPlainObject(visit)) return visit;
  return {
    ...visit,
    category: trimKnownString(visit.category),
    title: trimKnownString(visit.title),
    location: normalizeLocation(visit.location),
    schedule: normalizeSchedule(visit.schedule),
    notes: nullableString(visit.notes),
    alternatives: Array.isArray(visit.alternatives) ? visit.alternatives.map(normalizeAlternative) : visit.alternatives,
  };
}

function normalizeTransport(transport) {
  if (!isPlainObject(transport)) return transport;
  return {
    ...transport,
    category: trimKnownString(transport.category),
    name: trimKnownString(transport.name),
    notes: nullableString(transport.notes),
  };
}

export function normalizeAiItineraryDocument(document) {
  if (!isPlainObject(document)) return document;
  const trip = isPlainObject(document.trip)
    ? {
        ...document.trip,
        title: trimKnownString(document.trip.title),
        start_date: trimKnownString(document.trip.start_date),
        end_date: trimKnownString(document.trip.end_date),
        destination: isPlainObject(document.trip.destination)
          ? {
              ...document.trip.destination,
              display_name: trimKnownString(document.trip.destination.display_name),
              country: nullableString(document.trip.destination.country),
              city: nullableString(document.trip.destination.city),
            }
          : document.trip.destination,
      }
    : document.trip;
  return {
    ...document,
    schema_version: trimKnownString(document.schema_version),
    document_type: trimKnownString(document.document_type),
    trip,
    days: Array.isArray(document.days)
      ? document.days.map((day) =>
          isPlainObject(day)
            ? {
                ...day,
                date: trimKnownString(day.date),
                visits: Array.isArray(day.visits) ? day.visits.map(normalizeVisit) : day.visits,
                transports: Array.isArray(day.transports) ? day.transports.map(normalizeTransport) : day.transports,
              }
            : day,
        )
      : document.days,
  };
}

function requireObject(value, path, errors) {
  if (isPlainObject(value)) return true;
  issue(errors, "invalid_type", path, "必須是物件。");
  return false;
}

function requireArray(value, path, errors) {
  if (Array.isArray(value)) return true;
  issue(errors, "invalid_type", path, "必須是陣列。");
  return false;
}

function requireString(value, path, errors, { nullable = false, maxLength = 1000 } = {}) {
  if (nullable && value === null) return true;
  if (typeof value !== "string") {
    issue(errors, "invalid_type", path, nullable ? "必須是字串或 null。" : "必須是字串。");
    return false;
  }
  if (!nullable && !value.trim()) {
    issue(errors, "missing_value", path, "不可空白。");
    return false;
  }
  if (value.length > maxLength) issue(errors, "limit_exceeded", path, `文字不可超過 ${maxLength} 字元。`);
  return true;
}

function requireInteger(value, path, errors, { min, max } = {}) {
  if (!Number.isInteger(value)) {
    issue(errors, "invalid_type", path, "必須是整數。");
    return false;
  }
  if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
    issue(errors, "invalid_range", path, `數值必須介於 ${min} 與 ${max}。`);
    return false;
  }
  return true;
}

function requireFiniteNumber(value, path, errors, { min, max } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issue(errors, "invalid_type", path, "必須是有限數字。");
    return false;
  }
  if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
    issue(errors, "invalid_range", path, `數值必須介於 ${min} 與 ${max}。`);
    return false;
  }
  return true;
}

function checkAllowedKeys(value, keys, path, errors) {
  const allowed = new Set(keys);
  Object.keys(value).forEach((key) => {
    if (!allowed.has(key)) issue(errors, "unknown_field", `${path}.${key}`, `不支援欄位 ${key}。`);
  });
}

function checkRequiredKeys(value, keys, path, errors) {
  keys.forEach((key) => {
    if (!Object.hasOwn(value, key)) issue(errors, "missing_field", `${path}.${key}`, `缺少欄位 ${key}。`);
  });
}

export function aiTimeToMinutes(value, { allowDayBoundary = false } = {}) {
  const normalized = String(value || "").trim();
  if (allowDayBoundary && normalized === "24:00") return 1440;
  const match = normalized.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function validateSchedule(schedule, path, errors, { allowDurationOnly = true } = {}) {
  if (!requireObject(schedule, path, errors)) return { kind: null, valid: false };
  const kind = schedule.kind;
  const allowedKeys = scheduleKeysByKind[kind];
  if (!allowedKeys) {
    issue(errors, "invalid_schedule_kind", `${path}.kind`, "schedule.kind 必須是 timed、start_duration、duration 或 untimed。");
    checkAllowedKeys(schedule, ["kind", "start", "end", "duration_minutes"], path, errors);
    return { kind, valid: false };
  }
  checkAllowedKeys(schedule, allowedKeys, path, errors);
  checkRequiredKeys(schedule, allowedKeys, path, errors);
  if (kind === "untimed") return { kind, valid: true };
  if (kind === "duration" && !allowDurationOnly) {
    issue(errors, "alternative_duration_requires_anchor", `${path}.kind`, "備案不可只提供停留時間，請使用精確時間、開始時間加停留時間或 Untimed。");
  }
  if (kind === "timed") {
    if (typeof schedule.start !== "string" || !startTimePattern.test(schedule.start)) {
      issue(errors, "invalid_time", `${path}.start`, "開始時間必須是 HH:MM，且不可為 24:00。");
    }
    if (typeof schedule.end !== "string" || !endTimePattern.test(schedule.end)) {
      issue(errors, "invalid_time", `${path}.end`, "結束時間必須是 HH:MM，可使用 24:00。");
    }
    const start = aiTimeToMinutes(schedule.start);
    const end = aiTimeToMinutes(schedule.end, { allowDayBoundary: true });
    if (start !== null && end !== null && end <= start) {
      issue(errors, "invalid_time_range", path, "結束時間必須晚於開始時間。");
    }
  } else {
    if (kind === "start_duration" && (typeof schedule.start !== "string" || !startTimePattern.test(schedule.start))) {
      issue(errors, "invalid_time", `${path}.start`, "開始時間必須是 HH:MM，且不可為 24:00。");
    }
    requireInteger(schedule.duration_minutes, `${path}.duration_minutes`, errors, { min: 1, max: 1440 });
    if (kind === "start_duration") {
      const start = aiTimeToMinutes(schedule.start);
      if (start !== null && Number.isInteger(schedule.duration_minutes) && start + schedule.duration_minutes > 1440) {
        issue(errors, "day_boundary_exceeded", path, "開始時間加停留時間不可超過 24:00。");
      }
    }
  }
  return { kind, valid: true };
}

function validateLocation(location, path, errors) {
  if (!requireObject(location, path, errors)) return;
  checkAllowedKeys(location, locationKeys, path, errors);
  checkRequiredKeys(location, locationKeys, path, errors);
  requireString(location.name, `${path}.name`, errors, { nullable: true, maxLength: 500 });
  requireString(location.map_url, `${path}.map_url`, errors, { nullable: true, maxLength: 2000 });
  if (location.latitude !== null) requireFiniteNumber(location.latitude, `${path}.latitude`, errors, { min: -90, max: 90 });
  if (location.longitude !== null) requireFiniteNumber(location.longitude, `${path}.longitude`, errors, { min: -180, max: 180 });
  if ((location.latitude === null) !== (location.longitude === null)) {
    issue(errors, "invalid_coordinate_pair", path, "緯度與經度必須同時存在或同時為 null。");
  }
}

function validateAlternative(alternative, path, errors) {
  if (!requireObject(alternative, path, errors)) return;
  checkAllowedKeys(alternative, alternativeKeys, path, errors);
  checkRequiredKeys(alternative, alternativeKeys, path, errors);
  if (!visitCategories.has(alternative.category)) issue(errors, "invalid_item_type", `${path}.category`, "不支援的行程分類。");
  requireString(alternative.title, `${path}.title`, errors, { maxLength: 500 });
  validateLocation(alternative.location, `${path}.location`, errors);
  validateSchedule(alternative.schedule, `${path}.schedule`, errors, { allowDurationOnly: false });
  requireString(alternative.notes, `${path}.notes`, errors, { nullable: true, maxLength: 5000 });
}

function validateVisit(visit, path, errors) {
  if (!requireObject(visit, path, errors)) return;
  checkAllowedKeys(visit, visitKeys, path, errors);
  checkRequiredKeys(visit, visitKeys, path, errors);
  if (!visitCategories.has(visit.category)) issue(errors, "invalid_item_type", `${path}.category`, "不支援的行程分類。");
  requireString(visit.title, `${path}.title`, errors, { maxLength: 500 });
  validateLocation(visit.location, `${path}.location`, errors);
  const schedule = validateSchedule(visit.schedule, `${path}.schedule`, errors);
  if (typeof visit.fixed !== "boolean") issue(errors, "invalid_type", `${path}.fixed`, "fixed 必須是布林值。");
  if (visit.fixed === true && !["timed", "start_duration"].includes(schedule.kind)) {
    issue(errors, "fixed_requires_time", `${path}.fixed`, "Fixed 行程必須提供精確時間或開始時間加停留時間。");
  }
  requireString(visit.notes, `${path}.notes`, errors, { nullable: true, maxLength: 5000 });
  if (requireArray(visit.alternatives, `${path}.alternatives`, errors)) {
    if (visit.alternatives.length > 100) issue(errors, "limit_exceeded", `${path}.alternatives`, "單一行程最多 100 個備案。");
    visit.alternatives.forEach((alternative, index) => validateAlternative(alternative, `${path}.alternatives[${index}]`, errors));
  }
}

function validateTransport(transport, path, errors, visitCount, seenPairs) {
  if (!requireObject(transport, path, errors)) return;
  checkAllowedKeys(transport, transportKeys, path, errors);
  checkRequiredKeys(transport, transportKeys, path, errors);
  const fromValid = requireInteger(transport.from_visit_number, `${path}.from_visit_number`, errors, { min: 1, max: Math.max(visitCount, 1) });
  const toValid = requireInteger(transport.to_visit_number, `${path}.to_visit_number`, errors, { min: 1, max: Math.max(visitCount, 1) });
  if (fromValid && toValid) {
    if (transport.to_visit_number <= transport.from_visit_number) {
      issue(errors, "invalid_transport_relation", path, "交通終點必須位於起點之後。");
    }
    const pair = `${transport.from_visit_number}:${transport.to_visit_number}`;
    if (seenPairs.has(pair)) issue(errors, "duplicate_transport", path, "同一組行程端點不可重複建立交通。");
    seenPairs.add(pair);
  }
  if (!transportCategories.has(transport.category)) issue(errors, "invalid_transport_category", `${path}.category`, "不支援的交通分類。");
  requireString(transport.name, `${path}.name`, errors, { maxLength: 500 });
  requireInteger(transport.duration_minutes, `${path}.duration_minutes`, errors, { min: 1, max: 1440 });
  requireString(transport.notes, `${path}.notes`, errors, { nullable: true, maxLength: 5000 });
}

function validateTrip(trip, path, errors) {
  if (!requireObject(trip, path, errors)) return;
  checkAllowedKeys(trip, tripKeys, path, errors);
  checkRequiredKeys(trip, tripKeys, path, errors);
  requireString(trip.title, `${path}.title`, errors, { maxLength: 500 });
  if (requireObject(trip.destination, `${path}.destination`, errors)) {
    checkAllowedKeys(trip.destination, destinationKeys, `${path}.destination`, errors);
    checkRequiredKeys(trip.destination, destinationKeys, `${path}.destination`, errors);
    requireString(trip.destination.display_name, `${path}.destination.display_name`, errors, { maxLength: 500 });
    requireString(trip.destination.country, `${path}.destination.country`, errors, { nullable: true, maxLength: 250 });
    requireString(trip.destination.city, `${path}.destination.city`, errors, { nullable: true, maxLength: 250 });
  }
  if (typeof trip.start_date !== "string" || !refDatePattern.test(trip.start_date) || !isValidTripJsonDate(trip.start_date)) {
    issue(errors, "invalid_date", `${path}.start_date`, "開始日期無效。");
  }
  if (typeof trip.end_date !== "string" || !refDatePattern.test(trip.end_date) || !isValidTripJsonDate(trip.end_date)) {
    issue(errors, "invalid_date", `${path}.end_date`, "結束日期無效。");
  }
  if (isValidTripJsonDate(trip.start_date) && isValidTripJsonDate(trip.end_date) && trip.end_date < trip.start_date) {
    issue(errors, "invalid_date_range", path, "結束日期不可早於開始日期。");
  }
}

function collectWarnings(document) {
  const warnings = [];
  document.days.forEach((day, dayArrayIndex) => {
    day.visits.forEach((visit, visitIndex) => {
      const path = `$.days[${dayArrayIndex}].visits[${visitIndex}]`;
      if (visit.schedule?.kind === "untimed") issue(warnings, "untimed_visit", `${path}.schedule`, `「${visit.title}」是 Untimed 行程。`);
      if (visit.location === null) issue(warnings, "missing_location", `${path}.location`, `「${visit.title}」沒有可搜尋地點。`);
      visit.alternatives.forEach((alternative, alternativeIndex) => {
        const alternativePath = `${path}.alternatives[${alternativeIndex}]`;
        if (alternative.schedule?.kind === "untimed") issue(warnings, "untimed_alternative", `${alternativePath}.schedule`, `備案「${alternative.title}」是 Untimed。`);
        if (alternative.location === null) issue(warnings, "missing_alternative_location", `${alternativePath}.location`, `備案「${alternative.title}」沒有可搜尋地點。`);
      });
    });
  });
  return warnings;
}

export function validateAiItineraryDocument(document) {
  const errors = [];
  if (!requireObject(document, "$", errors)) return { errors, ok: false, warnings: [] };
  checkAllowedKeys(document, rootKeys, "$", errors);
  checkRequiredKeys(document, rootKeys, "$", errors);
  if (document.schema_version !== aiItineraryCurrentSchemaVersion) {
    issue(errors, "unsupported_schema_version", "$.schema_version", `不支援 AI schema_version ${String(document.schema_version)}。`);
  }
  if (document.document_type !== aiItineraryDocumentType) {
    issue(errors, "invalid_document_type", "$.document_type", `AI document_type 必須是 ${aiItineraryDocumentType}。`);
  }
  validateTrip(document.trip, "$.trip", errors);
  if (requireArray(document.days, "$.days", errors)) {
    if (!document.days.length) issue(errors, "missing_day", "$.days", "至少需要一個 Day。");
    if (document.days.length > 366) issue(errors, "limit_exceeded", "$.days", "旅程最多 366 天。");
    document.days.forEach((day, dayIndex) => {
      const path = `$.days[${dayIndex}]`;
      if (!requireObject(day, path, errors)) return;
      checkAllowedKeys(day, dayKeys, path, errors);
      checkRequiredKeys(day, dayKeys, path, errors);
      if (!Number.isInteger(day.day_index) || day.day_index !== dayIndex) {
        issue(errors, "invalid_day_index", `${path}.day_index`, `day_index 必須是 ${dayIndex}。`);
      }
      const expectedDate = tripJsonDateForDay(document.trip?.start_date, dayIndex);
      if (!isValidTripJsonDate(day.date) || (expectedDate && day.date !== expectedDate)) {
        issue(errors, "invalid_day_date", `${path}.date`, expectedDate ? `Day 日期必須是 ${expectedDate}。` : "Day 日期無效。");
      }
      if (requireArray(day.visits, `${path}.visits`, errors)) {
        if (day.visits.length > 500) issue(errors, "limit_exceeded", `${path}.visits`, "單日最多 500 個行程。");
        day.visits.forEach((visit, visitIndex) => validateVisit(visit, `${path}.visits[${visitIndex}]`, errors));
      }
      if (requireArray(day.transports, `${path}.transports`, errors)) {
        if (day.transports.length > 500) issue(errors, "limit_exceeded", `${path}.transports`, "單日最多 500 個交通。");
        const seenPairs = new Set();
        day.transports.forEach((transport, transportIndex) =>
          validateTransport(transport, `${path}.transports[${transportIndex}]`, errors, Array.isArray(day.visits) ? day.visits.length : 0, seenPairs),
        );
      }
    });
    const expectedDayCount = tripJsonDayCount(document.trip?.start_date, document.trip?.end_date);
    if (expectedDayCount && document.days.length !== expectedDayCount) {
      issue(errors, "day_count_mismatch", "$.days", `日期範圍應包含 ${expectedDayCount} 個 Day。`);
    }
  }
  return { errors, ok: errors.length === 0, warnings: errors.length ? [] : collectWarnings(document) };
}

export function migrateAiItineraryDocument(document) {
  if (!isPlainObject(document)) return { errors: [{ code: "invalid_root", path: "$", message: "JSON 根節點必須是物件。" }], ok: false };
  if (!Object.hasOwn(document, "schema_version")) return { errors: [{ code: "missing_schema_version", path: "$.schema_version", message: "缺少 schema_version。" }], ok: false };
  if (typeof document.schema_version !== "string") return { errors: [{ code: "invalid_schema_version", path: "$.schema_version", message: "schema_version 必須是字串。" }], ok: false };
  let current = document;
  let version = document.schema_version.trim();
  const migrations = [];
  const seen = new Set();
  while (version !== aiItineraryCurrentSchemaVersion) {
    if (seen.has(version)) return { errors: [{ code: "migration_cycle", path: "$.schema_version", message: "AI Schema migration 發生循環。" }], ok: false };
    seen.add(version);
    const step = aiItineraryMigrationSteps[version];
    if (!step) return { errors: [{ code: "unsupported_schema_version", path: "$.schema_version", message: `不支援 AI schema_version ${version}。` }], ok: false };
    current = step.migrate(current);
    migrations.push(`${version}->${step.to}`);
    version = step.to;
  }
  return { document: current, migrations, ok: true };
}

function balancedJsonObjectSpans(text) {
  const spans = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"' && depth > 0) {
      inString = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        spans.push({ end: index + 1, start });
        start = -1;
      }
    }
  }
  return { balanced: depth === 0, spans };
}

export function extractAiItineraryJsonText(rawText) {
  if (typeof rawText !== "string") return { errors: [{ code: "invalid_input", path: "$", message: "AI 回覆必須是文字。" }], ok: false };
  if (rawText.length > aiItineraryMaxTextCharacters) return { errors: [{ code: "input_too_large", path: "$", message: "AI 回覆超過 5 MB 安全上限。" }], ok: false };
  const text = rawText.trim();
  if (!text) return { errors: [{ code: "empty_input", path: "$", message: "請貼上 AI 回覆。" }], ok: false };

  try {
    JSON.parse(text);
    return { jsonText: text, ok: true, sourceKind: "json" };
  } catch {
    // Continue into the explicitly supported wrapped-response formats.
  }

  const fences = [...text.matchAll(fencedBlockPattern)];
  if (fences.length > 1) return { errors: [{ code: "ambiguous_json", path: "$", message: "AI 回覆包含多個 code block，無法判斷要匯入哪一份。" }], ok: false };
  if (fences.length === 1) {
    const match = fences[0];
    const before = text.slice(0, match.index);
    const after = text.slice((match.index || 0) + match[0].length);
    if (before.length + after.length > maxSurroundingTextCharacters) {
      return { errors: [{ code: "surrounding_text_too_large", path: "$", message: "JSON 前後文字過長，請只保留行程 JSON。" }], ok: false };
    }
    return { jsonText: match[1].trim(), ok: true, sourceKind: "markdown_fence" };
  }

  const balanced = balancedJsonObjectSpans(text);
  if (balanced.spans.length > 1) return { errors: [{ code: "ambiguous_json", path: "$", message: "AI 回覆包含多個 JSON 物件，無法判斷要匯入哪一份。" }], ok: false };
  if (balanced.spans.length === 1) {
    const span = balanced.spans[0];
    const surroundingLength = span.start + (text.length - span.end);
    if (surroundingLength > maxSurroundingTextCharacters) {
      return { errors: [{ code: "surrounding_text_too_large", path: "$", message: "JSON 前後文字過長，請只保留行程 JSON。" }], ok: false };
    }
    return { jsonText: text.slice(span.start, span.end), ok: true, sourceKind: "wrapped_json" };
  }
  return {
    errors: [{ code: text.includes("{") && !balanced.balanced ? "malformed_json" : "json_not_found", path: "$", message: "找不到一份完整且可辨識的 JSON 物件。" }],
    ok: false,
  };
}

export function parseAiItineraryText(rawText) {
  const extracted = extractAiItineraryJsonText(rawText);
  if (!extracted.ok) return { ...extracted, warnings: [] };
  let parsed;
  try {
    parsed = JSON.parse(extracted.jsonText);
  } catch (error) {
    return { errors: [{ code: "malformed_json", path: "$", message: `JSON 格式錯誤：${error.message}` }], ok: false, sourceKind: extracted.sourceKind, warnings: [] };
  }
  const migration = migrateAiItineraryDocument(parsed);
  if (!migration.ok) return { ...migration, sourceKind: extracted.sourceKind, warnings: [] };
  const compatibility = canonicalizeAiGeneratedAliases(migration.document);
  const document = normalizeAiItineraryDocument(compatibility.document);
  const validation = validateAiItineraryDocument(document);
  return {
    document,
    errors: validation.errors,
    migrations: [...migration.migrations, ...compatibility.migrations],
    ok: validation.ok,
    sourceKind: extracted.sourceKind,
    warnings: validation.warnings,
  };
}

export function buildAiItineraryPreview(document, { errors = [], warnings = [] } = {}) {
  const days = Array.isArray(document?.days) ? document.days : [];
  const counts = days.reduce(
    (summary, day) => {
      const visits = Array.isArray(day?.visits) ? day.visits : [];
      summary.days += 1;
      summary.visits += visits.length;
      summary.transports += Array.isArray(day?.transports) ? day.transports.length : 0;
      visits.forEach((visit) => {
        summary.alternatives += Array.isArray(visit?.alternatives) ? visit.alternatives.length : 0;
        if (visit?.schedule?.kind === "untimed") summary.untimed += 1;
        else summary.timed += 1;
        if (visit?.fixed) summary.fixed += 1;
      });
      return summary;
    },
    { alternatives: 0, days: 0, fixed: 0, timed: 0, transports: 0, untimed: 0, visits: 0 },
  );
  return { counts, days, errors, trip: document?.trip || null, warnings };
}

export function stringifyAiItineraryDocument(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function aiItineraryFileName(title) {
  const safeTitle = String(title || "trip").trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").slice(0, 80) || "trip";
  return `${safeTitle}-ai-itinerary-v${aiItineraryCurrentSchemaVersion}.json`;
}
