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

// Keep the instructional example executable by the same contract as a real file.
// It belongs in the AI prompt, never in the user's blank template or import data.
export function buildAiItineraryPromptExample() {
  const location = { name: null, map_url: null, latitude: null, longitude: null };
  return {
    schema_version: aiItineraryCurrentSchemaVersion,
    document_type: aiItineraryDocumentType,
    trip: {
      title: "格式示例（請替換為實際旅程）",
      destination: { display_name: "示例城市", country: null, city: null },
      start_date: "2030-01-01",
      end_date: "2030-01-01",
    },
    days: [{
      day_index: 0,
      date: "2030-01-01",
      visits: [
        {
          category: "attraction", title: "景點 A", location: { ...location },
          schedule: { kind: "start_duration", start: "09:00", duration_minutes: 90 },
          fixed: false, notes: null,
          alternatives: [{
            category: "attraction", title: "雨天備案", location: { ...location },
            schedule: { kind: "untimed" }, notes: null,
          }],
        },
        {
          category: "attraction", title: "景點 B", location: { ...location },
          schedule: { kind: "duration", duration_minutes: 60 },
          fixed: false, notes: null, alternatives: [],
        },
      ],
      transports: [{
        from_visit_number: 1, to_visit_number: 2, category: "walk", name: "步行",
        duration_minutes: 15, notes: "估計時間",
      }],
    }],
  };
}

function buildAiItineraryPrompt({ revise = false, version = aiItineraryCurrentSchemaVersion } = {}) {
  return [
    revise ? "請依我的需求調整附上的旅程 JSON，完成後交付可下載的 .json 檔案。" : "請依我們討論的需求填寫附上的旅程 JSON 模板，完成後交付可下載的 .json 檔案。",
    "",
    "【規劃內容】",
    "這可以是尚未完成的行程草案。主動提出具體、可執行的行程建議，依偏好、營業時間、地理順序與移動安排景點、餐飲、停留時間與交通。慢遊日可以少排，不設固定景點數；不要每天只放一個籠統景點、全部 Untimed 或刻意省略交通。",
    "班機、飯店、預約或票券尚未決定也可規劃，不需要追問這些細節。提議不得寫成已預訂或已確認；未知資訊用 null、untimed 或省略不必要的行程，不要虛構航班與訂位。",
    revise
      ? "除非使用者明確要求簡化或刪除，應保留原有行程密度與有用內容。保留未要求變更的既有明確時間與 Fixed 行程；不要為了格式而改動。"
      : "只有目的地、開始日期或結束日期不足以建立連續 Days 時才先提問；名稱可依需求命名。使用者刻意保留的空白日可以 visits: []、transports: []。",
    "",
    "【檔案與欄位】",
    `根物件只含 schema_version: ${JSON.stringify(version)}（字串）、document_type: ${JSON.stringify(aiItineraryDocumentType)}、trip、days。沿用英文欄位，不加說明欄位、ID、status 或額外 metadata。`,
    "trip 必須填 title、destination（display_name、country、city）、start_date、end_date；必要文字不可空白，country/city 不明可為 null。日期統一 YYYY-MM-DD，days 包含起訖日在內的每一天；day_index 從 0 連續遞增。",
    "visit 必須含 category、title、location、schedule、fixed、notes、alternatives。category 只用 attraction、food、hotel、transport、note。沒有備案用 []；備案只有 category、title、location、schedule、notes，不含 fixed 或巢狀備案。",
    "location 固定含 name、map_url、latitude、longitude。可辨識的公共地點提供可搜尋的 Google Maps URL 與可靠座標（數字）；不確定時 latitude/longitude 一起為 null，不猜造座標、CID，不輸出 address 或 Place ID。未選定飯店或泛稱區域不假裝是精確地點。",
    "",
    "【草案時間：先定錨點，再接續】",
    "新提議的草案優先每天第一筆用 start_duration，後續可連續的非固定行程用 duration。網站會依前一行程結束＋相鄰交通分鐘接續，開始向上取到 5 分鐘；不必為每一站重算 start。這仍會得到完整時間行程，不是全部 Untimed。",
    "用餐、開放時段、預約或固定行程需要時間窗口時，用 start_duration 或 timed 重新定錨，可保留空檔與休息；不要因為前站提早結束就把晚餐接到下午。依使用者習慣安排；未指定時午餐約 11:30–14:00、晚餐約 17:30–20:00，這是規劃參考而非必填行程或固定限制。",
    "使用者提供的時間必須保留。duration 前一筆若 untimed，就無法接續，請從下一個可合理安排的 start_duration 重新定錨。每日開始錨點不等於 Fixed；單純建議時間與營業時間不應設為 Fixed。除保留原檔的 fixed:true 或使用者明確指定固定行程外，所有 fixed 都必須 false；true 只可搭配 timed/start_duration。",
    'schedule 四選一，不混用欄位：{"kind":"start_duration","start":"09:00","duration_minutes":60}；{"kind":"duration","duration_minutes":60}；{"kind":"timed","start":"09:00","end":"10:00"}；{"kind":"untimed"}。備案不可用 duration。時間 HH:mm，end 可為 24:00，不可跨日；分鐘為 1 到 1440 的整數。',
    "交通屬於兩站之間，不放在停留時間裡。不同地點且移動可估計時建立 transport；同一設施/車廂活動不需假交通，不要建立 0 或 1 分鐘佔位交通。每筆包含 from_visit_number、to_visit_number、category、name、duration_minutes、notes。",
    "交通編號是同一天 visits 的位置，從 1 開始：第一站到第二站為 1→2（不是 day_index 的 0-based）。category 只用 jr、train、bus、walk、drive、taxi、ferry、flight、other；duration_minutes 為 1 到 1440 的整數。",
    "明確時間逐日驗算：earliest_next_start=previous_end+transport.duration_minutes；duration 接續再向上取 5 分鐘，下一個明確 start 不得早於它。例：09:00＋90 分鐘＝10:30，再走 15 分鐘，下一站最早 10:45，不是 10:30。",
    "衝突時調整新提議的非 Fixed 行程，遇到 Fixed 時不可移動 Fixed。保留停留長度並預留交通；無法安全接續就改為 untimed，不刪掉有用內容，不捏造時間。",
    "",
    "【完整形狀範例：只示範結構，不是要照抄的行程】",
    JSON.stringify(buildAiItineraryPromptExample()),
    "範例第二站會接續為 10:45–11:45。請換成實際需求的日期、地點、內容與密度，沒有備案就用 []。",
    "",
    "【交付前自檢】",
    "先展開 duration 的實際時間，核對用餐時段、營業時間及移動可行性，再檢查 JSON 可解析、欄位完整、連續日期、分類、座標成對、交通編號及所有明確時間不衝突。有程式執行工具時請實際解析並驗算；在交付前自行修正，不要請使用者再送回修檔。",
    "使用檔案產生工具提供 travel-studio-ai-itinerary.json；若使用程式碼產物，設定為 JSON 並提供內建下載 .json。原生「下載程式碼」可用，不要把「下載檔案」寫成一般文字假裝按鈕。不要建立 Google 文件或其他線上文件，不要只回覆 JSON 訊息。檔案內只有單一 JSON 物件，UTF-8，無 Markdown code fence、註解或尾逗號；不要假造下載連結。",
  ].join("\n");
}

export function buildAiItineraryUsageInstructions(document) {
  return buildAiItineraryPrompt({ revise: true, version: document?.schema_version || aiItineraryCurrentSchemaVersion });
}

export function buildAiItineraryCreatePrompt() {
  return buildAiItineraryPrompt();
}

export function buildAiItineraryClipboardText(document) {
  return `${buildAiItineraryUsageInstructions(document)}\n\n${stringifyAiItineraryDocument(document)}`;
}
