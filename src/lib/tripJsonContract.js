export const tripJsonDocumentType = "travel_studio_trip";
export const tripJsonCurrentSchemaVersion = "1";
export const tripJsonMaxFileCharacters = 5_000_000;

export const tripJsonMigrationSteps = Object.freeze({});

const rootKeys = ["schema_version", "document_type", "trip", "days"];
const tripKeys = ["title", "destination", "start_date", "end_date", "status"];
const destinationKeys = ["display_name", "country", "city"];
const dayKeys = ["day_index", "date", "visits", "transports"];
const visitKeys = ["ref", "category", "title", "location", "notes", "estimated_cost", "time", "fixed", "alternatives"];
const alternativeKeys = ["category", "title", "location", "notes", "estimated_cost", "time"];
const locationKeys = ["name", "address", "map_url", "latitude", "longitude"];
const timeKeys = ["start", "end"];
const transportKeys = ["ref", "from_visit_ref", "to_visit_ref", "category", "name", "duration_minutes", "notes"];
const visitCategories = new Set(["attraction", "food", "hotel", "transport", "note"]);
const tripStatuses = new Set(["planning", "traveling", "settled"]);
const refPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const endTimePattern = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function trimKnownString(value) {
  return typeof value === "string" ? value.trim() : value;
}

function nullableString(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeTime(time) {
  if (!isPlainObject(time)) return time;
  return {
    ...time,
    start: trimKnownString(time.start),
    end: trimKnownString(time.end),
  };
}

function normalizeLocation(location) {
  if (!isPlainObject(location)) return location;
  return {
    ...location,
    name: nullableString(location.name),
    address: nullableString(location.address),
    map_url: nullableString(location.map_url),
  };
}

function normalizeAlternative(alternative) {
  if (!isPlainObject(alternative)) return alternative;
  return {
    ...alternative,
    category: trimKnownString(alternative.category),
    title: trimKnownString(alternative.title),
    location: normalizeLocation(alternative.location),
    notes: nullableString(alternative.notes),
    time: alternative.time === null ? null : normalizeTime(alternative.time),
  };
}

function normalizeVisit(visit) {
  if (!isPlainObject(visit)) return visit;
  return {
    ...visit,
    ref: trimKnownString(visit.ref),
    category: trimKnownString(visit.category),
    title: trimKnownString(visit.title),
    location: normalizeLocation(visit.location),
    notes: nullableString(visit.notes),
    time: visit.time === null ? null : normalizeTime(visit.time),
    alternatives: Array.isArray(visit.alternatives) ? visit.alternatives.map(normalizeAlternative) : visit.alternatives,
  };
}

function normalizeTransport(transport) {
  if (!isPlainObject(transport)) return transport;
  return {
    ...transport,
    ref: trimKnownString(transport.ref),
    from_visit_ref: trimKnownString(transport.from_visit_ref),
    to_visit_ref: trimKnownString(transport.to_visit_ref),
    category: trimKnownString(transport.category),
    name: trimKnownString(transport.name),
    notes: nullableString(transport.notes),
  };
}

export function normalizeTripJsonDocument(document) {
  if (!isPlainObject(document)) return document;
  const trip = isPlainObject(document.trip)
    ? {
        ...document.trip,
        title: trimKnownString(document.trip.title),
        start_date: trimKnownString(document.trip.start_date),
        end_date: trimKnownString(document.trip.end_date),
        status: trimKnownString(document.trip.status),
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
  const days = Array.isArray(document.days)
    ? document.days.map((day) => {
        if (!isPlainObject(day)) return day;
        return {
          ...day,
          date: trimKnownString(day.date),
          visits: Array.isArray(day.visits) ? day.visits.map(normalizeVisit) : day.visits,
          transports: Array.isArray(day.transports) ? day.transports.map(normalizeTransport) : day.transports,
        };
      })
    : document.days;
  return {
    ...document,
    schema_version: trimKnownString(document.schema_version),
    document_type: trimKnownString(document.document_type),
    trip,
    days,
  };
}

function issue(list, code, path, message) {
  list.push({ code, path, message });
}

function checkAllowedKeys(value, allowedKeys, path, errors) {
  if (!isPlainObject(value)) return;
  const allowed = new Set(allowedKeys);
  Object.keys(value).forEach((key) => {
    if (!allowed.has(key)) issue(errors, "unknown_field", `${path}.${key}`, "此欄位不屬於目前 JSON 契約。 ");
  });
}

function checkRequiredKeys(value, requiredKeys, path, errors) {
  if (!isPlainObject(value)) return;
  requiredKeys.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(value, key)) issue(errors, "missing_field", `${path}.${key}`, "缺少必要欄位。 ");
  });
}

function requireObject(value, path, errors) {
  if (isPlainObject(value)) return true;
  issue(errors, "invalid_type", path, "必須是物件。 ");
  return false;
}

function requireArray(value, path, errors) {
  if (Array.isArray(value)) return true;
  issue(errors, "invalid_type", path, "必須是陣列。 ");
  return false;
}

function requireString(value, path, errors, { maxLength = 4000, nullable = false } = {}) {
  if (nullable && value === null) return true;
  if (typeof value !== "string") {
    issue(errors, "invalid_type", path, nullable ? "必須是字串或 null。 " : "必須是字串。 ");
    return false;
  }
  if (!nullable && !value.trim()) issue(errors, "missing_value", path, "不可為空白。 ");
  if (value.length > maxLength) issue(errors, "value_too_long", path, `長度不可超過 ${maxLength}。`);
  return true;
}

function requireFiniteNumber(value, path, errors, { integer = false, max = Number.MAX_SAFE_INTEGER, min = -Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || (integer && !Number.isInteger(value))) {
    issue(errors, "invalid_type", path, integer ? "必須是整數。 " : "必須是數字。 ");
    return false;
  }
  if (value < min || value > max) issue(errors, "invalid_range", path, `數值必須介於 ${min} 與 ${max}。`);
  return true;
}

function parseDateParts(value) {
  if (typeof value !== "string" || !datePattern.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return { day, month, timestamp, year };
}

export function isValidTripJsonDate(value) {
  return Boolean(parseDateParts(value));
}

export function tripJsonDateForDay(startDate, dayIndex) {
  const parts = parseDateParts(startDate);
  if (!parts || !Number.isInteger(dayIndex) || dayIndex < 0) return "";
  return new Date(parts.timestamp + dayIndex * 86400000).toISOString().slice(0, 10);
}

export function tripJsonDayCount(startDate, endDate) {
  const start = parseDateParts(startDate);
  const end = parseDateParts(endDate);
  if (!start || !end || end.timestamp < start.timestamp) return 0;
  return Math.round((end.timestamp - start.timestamp) / 86400000) + 1;
}

function timeToMinutes(value, allow24 = false) {
  const pattern = allow24 ? endTimePattern : timePattern;
  if (typeof value !== "string" || !pattern.test(value)) return null;
  if (value === "24:00") return 1440;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function normalizeTripJsonTime(value) {
  const match = String(value || "").trim().match(/^(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  return match ? match[1] : String(value || "").trim();
}

function validateTime(value, path, errors) {
  if (value === null) return { end: null, start: null, valid: true };
  if (!requireObject(value, path, errors)) return { valid: false };
  checkAllowedKeys(value, timeKeys, path, errors);
  checkRequiredKeys(value, timeKeys, path, errors);
  const start = timeToMinutes(value.start, false);
  const end = timeToMinutes(value.end, true);
  if (start === null) issue(errors, "invalid_time", `${path}.start`, "開始時間必須是有效的 HH:MM，且不可為 24:00。 ");
  if (end === null) issue(errors, "invalid_time", `${path}.end`, "結束時間必須是有效的 HH:MM，可使用 24:00。 ");
  if (start !== null && end !== null && end <= start) {
    issue(errors, "invalid_time_range", path, "結束時間必須晚於開始時間。 ");
  }
  return { end, start, valid: start !== null && end !== null && end > start };
}

function validateLocation(location, path, errors) {
  if (!requireObject(location, path, errors)) return;
  checkAllowedKeys(location, locationKeys, path, errors);
  checkRequiredKeys(location, locationKeys, path, errors);
  ["name", "address", "map_url"].forEach((key) => requireString(location[key], `${path}.${key}`, errors, { nullable: true }));
  if (location.latitude !== null) requireFiniteNumber(location.latitude, `${path}.latitude`, errors, { min: -90, max: 90 });
  if (location.longitude !== null) requireFiniteNumber(location.longitude, `${path}.longitude`, errors, { min: -180, max: 180 });
  if ((location.latitude === null) !== (location.longitude === null)) {
    issue(errors, "invalid_coordinate_pair", path, "緯度與經度必須同時存在或同時為 null。 ");
  }
}

function validateAlternative(alternative, path, errors) {
  if (!requireObject(alternative, path, errors)) return;
  checkAllowedKeys(alternative, alternativeKeys, path, errors);
  checkRequiredKeys(alternative, alternativeKeys, path, errors);
  if (!visitCategories.has(alternative.category)) issue(errors, "invalid_item_type", `${path}.category`, "不支援的行程類型。 ");
  requireString(alternative.title, `${path}.title`, errors, { maxLength: 500 });
  validateLocation(alternative.location, `${path}.location`, errors);
  requireString(alternative.notes, `${path}.notes`, errors, { nullable: true });
  requireFiniteNumber(alternative.estimated_cost, `${path}.estimated_cost`, errors, { min: 0, max: 9999999999 });
  validateTime(alternative.time, `${path}.time`, errors);
}

function validateVisit(visit, path, errors) {
  if (!requireObject(visit, path, errors)) return;
  checkAllowedKeys(visit, visitKeys, path, errors);
  checkRequiredKeys(visit, visitKeys, path, errors);
  if (typeof visit.ref !== "string" || !refPattern.test(visit.ref)) {
    issue(errors, "invalid_ref", `${path}.ref`, "ref 格式不合法。 ");
  }
  if (!visitCategories.has(visit.category)) issue(errors, "invalid_item_type", `${path}.category`, "不支援的行程類型。 ");
  requireString(visit.title, `${path}.title`, errors, { maxLength: 500 });
  validateLocation(visit.location, `${path}.location`, errors);
  requireString(visit.notes, `${path}.notes`, errors, { nullable: true });
  requireFiniteNumber(visit.estimated_cost, `${path}.estimated_cost`, errors, { min: 0, max: 9999999999 });
  const time = validateTime(visit.time, `${path}.time`, errors);
  if (typeof visit.fixed !== "boolean") issue(errors, "invalid_type", `${path}.fixed`, "fixed 必須是布林值。 ");
  if (visit.fixed === true && !time.valid) issue(errors, "fixed_requires_time", `${path}.fixed`, "固定行程必須有完整有效時間。 ");
  if (requireArray(visit.alternatives, `${path}.alternatives`, errors)) {
    if (visit.alternatives.length > 100) issue(errors, "limit_exceeded", `${path}.alternatives`, "單一行程最多 100 個備案。 ");
    visit.alternatives.forEach((alternative, index) => validateAlternative(alternative, `${path}.alternatives[${index}]`, errors));
  }
}

function validateTransport(transport, path, errors) {
  if (!requireObject(transport, path, errors)) return;
  checkAllowedKeys(transport, transportKeys, path, errors);
  checkRequiredKeys(transport, transportKeys, path, errors);
  ["ref", "from_visit_ref", "to_visit_ref"].forEach((key) => {
    if (typeof transport[key] !== "string" || !refPattern.test(transport[key])) {
      issue(errors, "invalid_ref", `${path}.${key}`, "關聯 ref 格式不合法。 ");
    }
  });
  requireString(transport.category, `${path}.category`, errors, { maxLength: 120 });
  requireString(transport.name, `${path}.name`, errors, { maxLength: 500 });
  requireFiniteNumber(transport.duration_minutes, `${path}.duration_minutes`, errors, { integer: true, min: 1, max: 1440 });
  requireString(transport.notes, `${path}.notes`, errors, { nullable: true });
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
    requireString(trip.destination.country, `${path}.destination.country`, errors, { maxLength: 250, nullable: true });
    requireString(trip.destination.city, `${path}.destination.city`, errors, { maxLength: 250, nullable: true });
  }
  if (!isValidTripJsonDate(trip.start_date)) issue(errors, "invalid_date", `${path}.start_date`, "開始日期無效。 ");
  if (!isValidTripJsonDate(trip.end_date)) issue(errors, "invalid_date", `${path}.end_date`, "結束日期無效。 ");
  if (isValidTripJsonDate(trip.start_date) && isValidTripJsonDate(trip.end_date) && trip.end_date < trip.start_date) {
    issue(errors, "invalid_date_range", path, "結束日期不可早於開始日期。 ");
  }
  if (!tripStatuses.has(trip.status)) issue(errors, "invalid_trip_status", `${path}.status`, "不支援的旅程狀態。 ");
}

function validateDayRelationships(day, path, errors) {
  if (!Array.isArray(day.visits) || !Array.isArray(day.transports)) return;
  const visitByRef = new Map();
  const visitIndexByRef = new Map();
  day.visits.forEach((visit, index) => {
    if (!isPlainObject(visit) || typeof visit.ref !== "string") return;
    if (visitByRef.has(visit.ref)) {
      issue(errors, "duplicate_ref", `${path}.visits[${index}].ref`, "同一天的 visit ref 不可重複。 ");
      return;
    }
    visitByRef.set(visit.ref, visit);
    visitIndexByRef.set(visit.ref, index);
  });
  const transportRefs = new Set();
  const pairRefs = new Set();
  day.transports.forEach((transport, index) => {
    if (!isPlainObject(transport)) return;
    const transportPath = `${path}.transports[${index}]`;
    if (typeof transport.ref === "string") {
      if (transportRefs.has(transport.ref) || visitByRef.has(transport.ref)) {
        issue(errors, "duplicate_ref", `${transportPath}.ref`, "transport ref 必須在 Day 內唯一。 ");
      }
      transportRefs.add(transport.ref);
    }
    const fromIndex = visitIndexByRef.get(transport.from_visit_ref);
    const toIndex = visitIndexByRef.get(transport.to_visit_ref);
    if (fromIndex === undefined) issue(errors, "invalid_relation", `${transportPath}.from_visit_ref`, "找不到來源行程 ref。 ");
    if (toIndex === undefined) issue(errors, "invalid_relation", `${transportPath}.to_visit_ref`, "找不到目的行程 ref。 ");
    if (transport.from_visit_ref === transport.to_visit_ref) {
      issue(errors, "invalid_relation", transportPath, "交通的來源與目的不可相同。 ");
    }
    if (fromIndex !== undefined && toIndex !== undefined) {
      if (fromIndex >= toIndex) issue(errors, "invalid_relation", transportPath, "交通必須由較前方行程連向較後方行程。 ");
      const timedBetween = day.visits.slice(fromIndex + 1, toIndex).some((visit) => visit?.time !== null);
      if (timedBetween) issue(errors, "invalid_relation", transportPath, "交通端點之間不可跨越另一個有時間行程。 ");
      const pairKey = `${transport.from_visit_ref}->${transport.to_visit_ref}`;
      if (pairRefs.has(pairKey)) issue(errors, "duplicate_transport_pair", transportPath, "同一組行程端點只能有一張交通卡。 ");
      pairRefs.add(pairKey);
    }
  });
}

function validateDay(day, index, document, errors) {
  const path = `$.days[${index}]`;
  if (!requireObject(day, path, errors)) return;
  checkAllowedKeys(day, dayKeys, path, errors);
  checkRequiredKeys(day, dayKeys, path, errors);
  if (typeof day.day_index !== "number" || !Number.isInteger(day.day_index)) {
    issue(errors, "invalid_type", `${path}.day_index`, "day_index 必須是整數。 ");
  } else if (day.day_index !== index) {
    issue(errors, "invalid_day_sequence", `${path}.day_index`, `day_index 應為 ${index}。`);
  }
  if (!isValidTripJsonDate(day.date)) issue(errors, "invalid_date", `${path}.date`, "Day 日期無效。 ");
  const expectedDate = tripJsonDateForDay(document.trip?.start_date, index);
  if (expectedDate && day.date !== expectedDate) issue(errors, "day_date_mismatch", `${path}.date`, `此 Day 日期應為 ${expectedDate}。`);
  if (requireArray(day.visits, `${path}.visits`, errors)) {
    if (day.visits.length > 2000) issue(errors, "limit_exceeded", `${path}.visits`, "單一 Day 最多 2000 筆行程。 ");
    day.visits.forEach((visit, visitIndex) => validateVisit(visit, `${path}.visits[${visitIndex}]`, errors));
  }
  if (requireArray(day.transports, `${path}.transports`, errors)) {
    if (day.transports.length > 2000) issue(errors, "limit_exceeded", `${path}.transports`, "單一 Day 最多 2000 筆交通。 ");
    day.transports.forEach((transport, transportIndex) => validateTransport(transport, `${path}.transports[${transportIndex}]`, errors));
  }
  validateDayRelationships(day, path, errors);
}

function collectWarnings(document) {
  const warnings = [];
  const days = Array.isArray(document.days) ? document.days : [];
  const visitCount = days.reduce((count, day) => count + (Array.isArray(day.visits) ? day.visits.length : 0), 0);
  if (!visitCount) issue(warnings, "empty_timeline", "$.days", "此檔案沒有 Timeline 行程，匯入後會建立空白旅程。 ");
  if (document.trip?.status === "settled") {
    issue(warnings, "settled_trip", "$.trip.status", "匯入後旅程會維持結算狀態，內容將依現有規則鎖定。 ");
  }
  days.forEach((day, dayIndex) => {
    if (!Array.isArray(day.visits) || !Array.isArray(day.transports)) return;
    const visitIndexByRef = new Map(day.visits.map((visit, index) => [visit.ref, index]));
    day.transports.forEach((transport, transportIndex) => {
      const fromIndex = visitIndexByRef.get(transport.from_visit_ref);
      const toIndex = visitIndexByRef.get(transport.to_visit_ref);
      if (fromIndex === undefined || toIndex === undefined) return;
      const endpointsUntimed = day.visits[fromIndex]?.time === null || day.visits[toIndex]?.time === null;
      const interruptedByUntimed = day.visits.slice(fromIndex + 1, toIndex).some((visit) => visit?.time === null);
      if (endpointsUntimed || interruptedByUntimed) {
        issue(
          warnings,
          "suspended_transport",
          `$.days[${dayIndex}].transports[${transportIndex}]`,
          "此交通會保留，但因未設定時間行程而暫停參與 Phase 6 排程。 ",
        );
      }
    });
  });
  return warnings;
}

export function validateTripJsonDocument(document) {
  const errors = [];
  if (!requireObject(document, "$", errors)) return { errors, ok: false, warnings: [] };
  checkAllowedKeys(document, rootKeys, "$", errors);
  checkRequiredKeys(document, rootKeys, "$", errors);
  if (document.schema_version !== tripJsonCurrentSchemaVersion) {
    issue(errors, "unsupported_schema_version", "$.schema_version", `不支援 schema_version ${String(document.schema_version)}。`);
  }
  if (document.document_type !== tripJsonDocumentType) {
    issue(errors, "invalid_document_type", "$.document_type", `document_type 必須是 ${tripJsonDocumentType}。`);
  }
  validateTrip(document.trip, "$.trip", errors);
  if (requireArray(document.days, "$.days", errors)) {
    if (!document.days.length) issue(errors, "missing_day", "$.days", "至少需要一個 Day。 ");
    if (document.days.length > 366) issue(errors, "limit_exceeded", "$.days", "旅程最多 366 天。 ");
    document.days.forEach((day, index) => validateDay(day, index, document, errors));
    const expectedDayCount = tripJsonDayCount(document.trip?.start_date, document.trip?.end_date);
    if (expectedDayCount && document.days.length !== expectedDayCount) {
      issue(errors, "day_count_mismatch", "$.days", `日期範圍應包含 ${expectedDayCount} 個 Day。`);
    }
  }
  return { errors, ok: errors.length === 0, warnings: errors.length ? [] : collectWarnings(document) };
}

export function migrateTripJsonDocument(document) {
  if (!isPlainObject(document)) {
    return { errors: [{ code: "invalid_root", path: "$", message: "JSON 根節點必須是物件。 " }], ok: false };
  }
  if (!Object.prototype.hasOwnProperty.call(document, "schema_version")) {
    return { errors: [{ code: "missing_schema_version", path: "$.schema_version", message: "缺少 schema_version。 " }], ok: false };
  }
  if (typeof document.schema_version !== "string") {
    return { errors: [{ code: "invalid_schema_version", path: "$.schema_version", message: "schema_version 必須是字串。 " }], ok: false };
  }
  let current = document;
  let version = document.schema_version.trim();
  const migrations = [];
  const seen = new Set();
  while (version !== tripJsonCurrentSchemaVersion) {
    if (seen.has(version)) {
      return { errors: [{ code: "migration_cycle", path: "$.schema_version", message: "Schema migration 發生循環。 " }], ok: false };
    }
    seen.add(version);
    const step = tripJsonMigrationSteps[version];
    if (!step) {
      return {
        errors: [{ code: "unsupported_schema_version", path: "$.schema_version", message: `不支援 schema_version ${version}。` }],
        ok: false,
      };
    }
    current = step.migrate(current);
    migrations.push(`${version}->${step.to}`);
    version = step.to;
  }
  return { document: current, migrations, ok: true };
}

export function parseTripJsonText(text) {
  if (typeof text !== "string") {
    return { errors: [{ code: "invalid_file", path: "$", message: "匯入內容必須是 JSON 文字。 " }], ok: false, warnings: [] };
  }
  if (text.length > tripJsonMaxFileCharacters) {
    return { errors: [{ code: "file_too_large", path: "$", message: "JSON 檔案超過 5 MB 安全上限。 " }], ok: false, warnings: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      errors: [{ code: "malformed_json", path: "$", message: `JSON 格式錯誤：${error.message}` }],
      ok: false,
      warnings: [],
    };
  }
  const migrationResult = migrateTripJsonDocument(parsed);
  if (!migrationResult.ok) return { ...migrationResult, warnings: [] };
  const document = normalizeTripJsonDocument(migrationResult.document);
  const validation = validateTripJsonDocument(document);
  return {
    document,
    errors: validation.errors,
    migrations: migrationResult.migrations,
    ok: validation.ok,
    warnings: validation.warnings,
  };
}

export function buildTripJsonPreview(document, { errors = [], fileName = "", migrations = [], warnings = [] } = {}) {
  const days = Array.isArray(document?.days) ? document.days : [];
  const counts = days.reduce(
    (summary, day) => {
      const visits = Array.isArray(day?.visits) ? day.visits : [];
      const transports = Array.isArray(day?.transports) ? day.transports : [];
      summary.visits += visits.length;
      summary.transports += transports.length;
      visits.forEach((visit) => {
        summary.alternatives += Array.isArray(visit?.alternatives) ? visit.alternatives.length : 0;
        if (visit?.time === null) summary.untimed += 1;
        else summary.timed += 1;
        if (visit?.fixed === true) summary.fixed += 1;
      });
      return summary;
    },
    { alternatives: 0, fixed: 0, timed: 0, transports: 0, untimed: 0, visits: 0 },
  );
  return {
    counts: { ...counts, days: days.length },
    errors,
    fileName,
    migrations,
    schemaVersion: document?.schema_version || null,
    trip: document?.trip || null,
    warnings,
  };
}

export function stringifyTripJsonDocument(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function tripJsonFileName(title) {
  const safeTitle = String(title || "trip")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 100);
  return `${safeTitle || "trip"}.json`;
}
