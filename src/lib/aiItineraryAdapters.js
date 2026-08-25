import {
  aiItineraryCurrentSchemaVersion,
  aiItineraryDocumentType,
  aiItineraryFileName,
  aiTimeToMinutes,
  normalizeAiItineraryDocument,
  stringifyAiItineraryDocument,
  validateAiItineraryDocument,
} from "./aiItineraryContract.js";
import { buildTripJsonDocument } from "./tripJsonAdapters.js";
import {
  normalizeTripJsonDocument,
  tripJsonCurrentSchemaVersion,
  tripJsonDocumentType,
  validateTripJsonDocument,
} from "./tripJsonContract.js";

const knownTransportCategories = new Set(["jr", "train", "bus", "walk", "drive", "taxi", "ferry", "flight", "other"]);

export const aiItineraryExchangeModes = Object.freeze({
  create: "create",
  reviseCopy: "revise_copy",
});

export const aiItineraryBlankTemplateFileName = "travel-studio-ai-itinerary-template-v1.json";

export function buildBlankAiItineraryTemplate() {
  return {
    schema_version: aiItineraryCurrentSchemaVersion,
    document_type: aiItineraryDocumentType,
    trip: {
      title: "",
      destination: {
        display_name: "",
        country: null,
        city: null,
      },
      start_date: "",
      end_date: "",
    },
    days: [
      {
        day_index: 0,
        date: "",
        visits: [
          {
            category: "attraction",
            title: "",
            location: { name: null, map_url: null, latitude: null, longitude: null },
            schedule: { kind: "untimed" },
            fixed: false,
            notes: null,
            alternatives: [],
          },
        ],
        transports: [],
      },
    ],
  };
}

function issue(target, code, path, message) {
  target.push({ code, path, message });
}

function optionalText(value) {
  return typeof value === "string" ? value.trim() || null : null;
}

function exchangeLocation(location) {
  return {
    name: optionalText(location?.name),
    map_url: optionalText(location?.map_url),
    latitude: Number.isFinite(location?.latitude) ? location.latitude : null,
    longitude: Number.isFinite(location?.longitude) ? location.longitude : null,
  };
}

function aiScheduleFromFormal(time) {
  return time?.start && time?.end
    ? { end: time.end, kind: "timed", start: time.start }
    : { kind: "untimed" };
}

function aiAlternativeFromFormal(alternative) {
  return {
    category: alternative.category,
    title: alternative.title,
    location: exchangeLocation(alternative.location),
    schedule: aiScheduleFromFormal(alternative.time),
    notes: alternative.notes,
  };
}

function aiVisitFromFormal(visit) {
  return {
    category: visit.category,
    title: visit.title,
    location: exchangeLocation(visit.location),
    schedule: aiScheduleFromFormal(visit.time),
    fixed: visit.fixed,
    notes: visit.notes,
    alternatives: visit.alternatives.map((alternative) => aiAlternativeFromFormal(alternative)),
  };
}

export function buildAiItineraryDocument(input) {
  const formal = buildTripJsonDocument(input);
  if (!formal.ok) return { document: null, errors: formal.errors, ok: false, warnings: formal.warnings || [] };
  const warnings = [];
  const document = normalizeAiItineraryDocument({
    schema_version: aiItineraryCurrentSchemaVersion,
    document_type: aiItineraryDocumentType,
    trip: {
      title: formal.document.trip.title,
      destination: formal.document.trip.destination,
      start_date: formal.document.trip.start_date,
      end_date: formal.document.trip.end_date,
    },
    days: formal.document.days.map((day, dayArrayIndex) => {
      const visitNumberByRef = new Map(day.visits.map((visit, index) => [visit.ref, index + 1]));
      return {
        day_index: day.day_index,
        date: day.date,
        visits: day.visits.map((visit) => aiVisitFromFormal(visit)),
        transports: day.transports.map((transport, transportIndex) => {
          const category = knownTransportCategories.has(transport.category) ? transport.category : "other";
          if (category !== transport.category) {
            issue(
              warnings,
              "transport_category_normalized",
              `$.days[${dayArrayIndex}].transports[${transportIndex}].category`,
              `交通分類「${transport.category}」已在 AI 文件中轉為 other。`,
            );
          }
          return {
            from_visit_number: visitNumberByRef.get(transport.from_visit_ref) || 0,
            to_visit_number: visitNumberByRef.get(transport.to_visit_ref) || 0,
            category,
            name: transport.name,
            duration_minutes: transport.duration_minutes,
            notes: transport.notes,
          };
        }),
      };
    }),
  });
  const validation = validateAiItineraryDocument(document);
  return { document, errors: validation.errors, ok: validation.ok, warnings: [...warnings, ...validation.warnings] };
}

export function serializeTripToAiItinerary(input) {
  const result = buildAiItineraryDocument(input);
  if (!result.ok) return { ...result, fileName: null, json: null };
  return {
    ...result,
    fileName: aiItineraryFileName(result.document.trip.title),
    json: stringifyAiItineraryDocument(result.document),
  };
}

function formalLocation(location) {
  return exchangeLocation(location);
}

function minutesToTime(minutes) {
  if (minutes === 1440) return "24:00";
  const hours = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function roundMinutesUpToFive(minutes) {
  return Math.ceil(minutes / 5) * 5;
}

function explicitScheduleTime(schedule) {
  if (schedule?.kind === "timed") return { start: schedule.start, end: schedule.end, source: "explicit" };
  if (schedule?.kind === "start_duration") {
    const startMinutes = aiTimeToMinutes(schedule.start);
    return {
      start: schedule.start,
      end: minutesToTime(startMinutes + schedule.duration_minutes),
      source: "explicit",
    };
  }
  return null;
}

function transportDurationBetween(day, fromIndex, toIndex) {
  const transport = day.transports.find(
    (entry) => entry.from_visit_number === fromIndex + 1 && entry.to_visit_number === toIndex + 1,
  );
  return transport?.duration_minutes || 0;
}

function resolveDaySchedules(day, dayArrayIndex) {
  const errors = [];
  const warnings = [];
  const times = day.visits.map((visit) => explicitScheduleTime(visit.schedule));
  let lastTimedIndex = -1;

  for (let visitIndex = 0; visitIndex < day.visits.length; visitIndex += 1) {
    const visit = day.visits[visitIndex];
    const path = `$.days[${dayArrayIndex}].visits[${visitIndex}].schedule`;
    if (visit.schedule.kind === "duration") {
      const previousIndex = visitIndex - 1;
      const previousTime = previousIndex >= 0 ? times[previousIndex] : null;
      if (!previousTime) {
        times[visitIndex] = null;
        issue(warnings, "duration_without_anchor", path, `「${visit.title}」只有停留時間，但前一個行程沒有可接續時間，因此轉為 Untimed。`);
        continue;
      }
      const startMinutes = roundMinutesUpToFive(
        aiTimeToMinutes(previousTime.end, { allowDayBoundary: true }) + transportDurationBetween(day, previousIndex, visitIndex),
      );
      const endMinutes = startMinutes + visit.schedule.duration_minutes;
      const nextExplicitIndex = day.visits.findIndex(
        (candidate, candidateIndex) => candidateIndex > visitIndex && ["timed", "start_duration"].includes(candidate.schedule.kind),
      );
      const nextExplicit = nextExplicitIndex >= 0 ? explicitScheduleTime(day.visits[nextExplicitIndex].schedule) : null;
      const nextStart = nextExplicit ? aiTimeToMinutes(nextExplicit.start) : null;
      const directNextTransport = nextExplicitIndex === visitIndex + 1 ? transportDurationBetween(day, visitIndex, nextExplicitIndex) : 0;
      if (endMinutes > 1440 || (nextStart !== null && endMinutes + directNextTransport > nextStart)) {
        times[visitIndex] = null;
        issue(warnings, "duration_schedule_conflict", path, `「${visit.title}」的停留時間無法在 Day 邊界或下一個明確時間前安全接續，因此轉為 Untimed。`);
        continue;
      }
      times[visitIndex] = { start: minutesToTime(startMinutes), end: minutesToTime(endMinutes), source: "derived" };
      issue(warnings, "duration_auto_scheduled", path, `「${visit.title}」已依前一個行程自動接續為 ${times[visitIndex].start}–${times[visitIndex].end}。`);
    }

    const currentTime = times[visitIndex];
    if (!currentTime) continue;
    if (lastTimedIndex >= 0) {
      const previousTime = times[lastTimedIndex];
      const minimumStart = aiTimeToMinutes(previousTime.end, { allowDayBoundary: true }) + transportDurationBetween(day, lastTimedIndex, visitIndex);
      if (aiTimeToMinutes(currentTime.start) < minimumStart) {
        if (currentTime.source === "derived") {
          times[visitIndex] = null;
          issue(warnings, "duration_schedule_conflict", path, `「${visit.title}」無法在前一個 Timed 行程後安全接續，因此轉為 Untimed。`);
          continue;
        }
        issue(errors, "timeline_time_conflict", path, `「${visit.title}」的開始時間早於前一個 Timed 行程與交通所允許的時間，至少應為 ${minutesToTime(minimumStart)}。`);
      }
    }
    lastTimedIndex = visitIndex;
  }
  return { errors, times, warnings };
}

function formalAlternative(alternative) {
  const location = formalLocation(alternative.location);
  const time = explicitScheduleTime(alternative.schedule);
  return {
    category: alternative.category,
    title: alternative.title,
    location,
    notes: alternative.notes,
    estimated_cost: 0,
    time: time ? { start: time.start, end: time.end } : null,
  };
}

export function buildFormalTripJsonFromAiDraft(document) {
  const normalized = normalizeAiItineraryDocument(document);
  const aiValidation = validateAiItineraryDocument(normalized);
  if (!aiValidation.ok) return { document: null, errors: aiValidation.errors, ok: false, warnings: [] };
  const errors = [];
  const warnings = [...aiValidation.warnings];
  const days = normalized.days.map((day, dayArrayIndex) => {
    const scheduleResult = resolveDaySchedules(day, dayArrayIndex);
    errors.push(...scheduleResult.errors);
    warnings.push(...scheduleResult.warnings);
    const refs = day.visits.map((_, visitIndex) => `day-${day.day_index + 1}-visit-${visitIndex + 1}`);
    return {
      day_index: day.day_index,
      date: day.date,
      visits: day.visits.map((visit, visitIndex) => {
        const time = scheduleResult.times[visitIndex];
        return {
          ref: refs[visitIndex],
          category: visit.category,
          title: visit.title,
          location: formalLocation(visit.location),
          notes: visit.notes,
          estimated_cost: 0,
          time: time ? { start: time.start, end: time.end } : null,
          fixed: visit.fixed,
          alternatives: visit.alternatives.map((alternative) => formalAlternative(alternative)),
        };
      }),
      transports: day.transports.map((transport, transportIndex) => ({
        ref: `day-${day.day_index + 1}-transport-${transportIndex + 1}`,
        from_visit_ref: refs[transport.from_visit_number - 1],
        to_visit_ref: refs[transport.to_visit_number - 1],
        category: transport.category,
        name: transport.name,
        duration_minutes: transport.duration_minutes,
        notes: transport.notes,
      })),
    };
  });
  const formal = normalizeTripJsonDocument({
    schema_version: tripJsonCurrentSchemaVersion,
    document_type: tripJsonDocumentType,
    trip: {
      title: normalized.trip.title,
      destination: normalized.trip.destination,
      start_date: normalized.trip.start_date,
      end_date: normalized.trip.end_date,
      status: "planning",
    },
    days,
  });
  const formalValidation = validateTripJsonDocument(formal);
  errors.push(...formalValidation.errors);
  warnings.push(...formalValidation.warnings);
  return { document: errors.length ? null : formal, errors, ok: errors.length === 0, warnings };
}

export function buildAiItineraryUsageInstructions(document) {
  const version = document?.schema_version || aiItineraryCurrentSchemaVersion;
  return [
    "請協助調整以下旅程，並嚴格遵守這份交換格式。",
    "",
    `- 輸出必須是 document_type=${aiItineraryDocumentType}、schema_version=${version} 的單一 JSON 物件。`,
    "- 只輸出 JSON，不要加入說明、Markdown code fence 或 Contract 外欄位。",
    "- 可以調整旅程名稱、Day、行程順序、分類、時間、Fixed、備註、備案與交通。",
    "- location 固定包含 name、map_url、latitude、longitude；請提供正確地點座標與地圖 URL，無法確認的欄位使用 null，不要輸出 address 或 Place ID。",
    "- schedule.kind 只可為 timed、start_duration、duration、untimed。Fixed 不可使用 duration 或 untimed。",
    "- transports 使用同一 Day 內 1-based from_visit_number / to_visit_number，不要使用資料庫 ID。",
    "- 不要省略必要欄位；沒有資料時使用 null 或空陣列。",
  ].join("\n");
}

export function buildAiItineraryCreatePrompt() {
  return [
    "請使用附上的 JSON 模板規劃新旅程。",
    "",
    "- 如果目的地、日期或旅遊偏好不足，先向使用者提問，不要先輸出 JSON。",
    `- 資訊完整後，建立 document_type=${aiItineraryDocumentType}、schema_version=${aiItineraryCurrentSchemaVersion} 的單一 JSON 物件。`,
    "- 最終結果請直接提供可下載的 .json 檔案，檔名 travel-studio-ai-itinerary.json；不要建立 Google 文件或其他線上文件，也不要只把 JSON 顯示成訊息文字。",
    "- 必須保留模板的英文欄位名稱，不可重新命名、翻譯、增加或刪除欄位。",
    "- 必須填完旅程名稱、目的地、開始日期、結束日期，以及日期連續的完整 Days；不可保留空白必要欄位。",
    "- day_index 從 0 開始並依序遞增。",
    "- 每個 visit 必須包含 category、title、location、schedule、fixed、notes、alternatives；category 只可為 attraction、food、hotel、transport、note，不可使用 dining 或 accommodation。",
    "- location 固定包含 name、map_url、latitude、longitude；每個地點都應提供正確地圖 URL、緯度與經度，無法確認的欄位使用 null，不要輸出 address 或 Place ID。",
    "- schedule.kind 只可為 timed、start_duration、duration、untimed。時間欄位只能叫 start、end、duration_minutes，不可使用 start_time 或 end_time。Fixed 不可使用 duration 或 untimed。",
    "- 每筆 transport 必須完整包含 from_visit_number、to_visit_number、category、name、duration_minutes、notes；visit 編號從 1 開始，例如第一個行程到第二個行程必須是 1→2，絕對不可使用 0；category 只可為 jr、train、bus、walk、drive、taxi、ferry、flight、other，不可使用 mode 欄位。",
    "- 安排明確開始時間時，必須預留前一個行程的結束時間加上兩者之間的 transport.duration_minutes，不可重疊。",
    "- 沒有地點時 location 的四個欄位都使用 null，沒有備案或交通時使用空陣列；不要加入說明、Markdown code fence、範例欄位或 Contract 外欄位。",
  ].join("\n");
}

export function buildAiItineraryClipboardText(document) {
  return `${buildAiItineraryUsageInstructions(document)}\n\n${stringifyAiItineraryDocument(document)}`;
}
