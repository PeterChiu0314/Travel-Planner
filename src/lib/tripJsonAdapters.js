import { isTransportationCard } from "./timelineTransportationRoles.js";
import { buildTimelineVisitDisplayOrder, planUntimedSortOrdersForVisualOrder } from "./timelineUntimedOrdering.js";
import {
  normalizeTripJsonDocument,
  normalizeTripJsonTime,
  stringifyTripJsonDocument,
  tripJsonCurrentSchemaVersion,
  tripJsonDateForDay,
  tripJsonDayCount,
  tripJsonDocumentType,
  tripJsonFileName,
  validateTripJsonDocument,
} from "./tripJsonContract.js";

function optionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function rowTime(row) {
  if (!row?.start_time && !row?.end_time) return null;
  return {
    start: normalizeTripJsonTime(row?.start_time),
    end: normalizeTripJsonTime(row?.end_time),
  };
}

function rowLocation(row) {
  return {
    name: optionalText(row?.location_name || row?.location),
    address: optionalText(row?.address),
    map_url: optionalText(row?.map_url),
    latitude: finiteNumberOrNull(row?.latitude),
    longitude: finiteNumberOrNull(row?.longitude),
  };
}

function serializeAlternative(alternative, fallbackCategory) {
  return {
    category: alternative?.type || fallbackCategory || "attraction",
    title: String(alternative?.title || "").trim(),
    location: rowLocation(alternative),
    notes: optionalText(alternative?.description || alternative?.transportation_note),
    estimated_cost: nonNegativeNumber(alternative?.cost),
    time: rowTime(alternative),
  };
}

function serializeVisit(visit, ref, alternatives) {
  return {
    ref,
    category: visit?.type || "attraction",
    title: String(visit?.title || "").trim(),
    location: rowLocation(visit),
    notes: optionalText(visit?.description || visit?.note || visit?.transportation_note),
    estimated_cost: nonNegativeNumber(visit?.cost),
    time: rowTime(visit),
    fixed: Boolean(visit?.is_fixed && visit?.start_time && visit?.end_time),
    alternatives: alternatives.map((alternative) => serializeAlternative(alternative, visit?.type)),
  };
}

function transportSortKey(transport, visitIndexById) {
  const fromIndex = visitIndexById.get(transport?.from_item_id);
  const toIndex = visitIndexById.get(transport?.to_item_id);
  return [fromIndex ?? Number.MAX_SAFE_INTEGER, toIndex ?? Number.MAX_SAFE_INTEGER, Number(transport?.sort_order || 0), String(transport?.id || "")];
}

function compareTransportRows(left, right, visitIndexById) {
  const leftKey = transportSortKey(left, visitIndexById);
  const rightKey = transportSortKey(right, visitIndexById);
  for (let index = 0; index < leftKey.length; index += 1) {
    if (leftKey[index] < rightKey[index]) return -1;
    if (leftKey[index] > rightKey[index]) return 1;
  }
  return 0;
}

function tripDestination(trip) {
  const country = optionalText(trip?.destination_country);
  const city = optionalText(trip?.destination_city);
  const fallback = [country, city].filter(Boolean).join(" · ");
  return {
    display_name: String(trip?.destination || fallback || "").trim(),
    country,
    city,
  };
}

export function buildTripJsonDocument({ alternatives = [], items = [], trip }) {
  const dayCount = tripJsonDayCount(trip?.start_date, trip?.end_date);
  const alternativesByItem = new Map();
  alternatives.forEach((alternative) => {
    const itemId = alternative?.itinerary_item_id;
    if (!itemId) return;
    const entries = alternativesByItem.get(itemId) || [];
    entries.push(alternative);
    alternativesByItem.set(itemId, entries);
  });
  alternativesByItem.forEach((entries) => {
    entries.sort(
      (left, right) =>
        String(left?.created_at || "").localeCompare(String(right?.created_at || "")) ||
        String(left?.id || "").localeCompare(String(right?.id || "")),
    );
  });

  const days = Array.from({ length: dayCount }, (_, dayIndex) => {
    const dayItems = items.filter((item) => Number(item?.day_index) === dayIndex);
    const visits = buildTimelineVisitDisplayOrder(dayItems);
    const visitRefById = new Map(
      visits.map((visit, visitIndex) => [visit.id, `day-${dayIndex + 1}-visit-${visitIndex + 1}`]),
    );
    const visitIndexById = new Map(visits.map((visit, visitIndex) => [visit.id, visitIndex]));
    const transports = dayItems
      .filter(isTransportationCard)
      .sort((left, right) => compareTransportRows(left, right, visitIndexById));
    return {
      day_index: dayIndex,
      date: tripJsonDateForDay(trip.start_date, dayIndex),
      visits: visits.map((visit) =>
        serializeVisit(visit, visitRefById.get(visit.id), alternativesByItem.get(visit.id) || []),
      ),
      transports: transports.map((transport, transportIndex) => ({
        ref: `day-${dayIndex + 1}-transport-${transportIndex + 1}`,
        from_visit_ref: visitRefById.get(transport.from_item_id) || null,
        to_visit_ref: visitRefById.get(transport.to_item_id) || null,
        category: String(transport.transport_category || "").trim(),
        name: String(transport.transport_name || transport.title || "").trim(),
        duration_minutes: Number(transport.transport_duration_minutes),
        notes: optionalText(transport.transport_note || transport.description || transport.note),
      })),
    };
  });
  const document = normalizeTripJsonDocument({
    schema_version: tripJsonCurrentSchemaVersion,
    document_type: tripJsonDocumentType,
    trip: {
      title: String(trip?.title || trip?.name || "").trim(),
      destination: tripDestination(trip),
      start_date: String(trip?.start_date || "").trim(),
      end_date: String(trip?.end_date || "").trim(),
      status: trip?.status || "planning",
    },
    days,
  });
  const validation = validateTripJsonDocument(document);
  return { document, ...validation };
}

export function serializeTripToJson(input) {
  const result = buildTripJsonDocument(input);
  if (!result.ok) return result;
  return {
    ...result,
    fileName: tripJsonFileName(result.document.trip.title),
    json: stringifyTripJsonDocument(result.document),
  };
}

function persistenceLocation(location) {
  return {
    location_name: location?.name || null,
    address: location?.address || null,
    map_url: location?.map_url || null,
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
  };
}

function persistenceTime(time) {
  return {
    start_time: time?.start || null,
    end_time: time?.end || null,
  };
}

function persistenceAlternative(alternative) {
  return {
    type: alternative.category,
    title: alternative.title,
    ...persistenceLocation(alternative.location),
    description: alternative.notes,
    transportation_note: null,
    cost: alternative.estimated_cost,
    ...persistenceTime(alternative.time),
  };
}

export function buildTripImportPersistencePayload(document) {
  const normalized = normalizeTripJsonDocument(document);
  const validation = validateTripJsonDocument(normalized);
  if (!validation.ok) return { ...validation, payload: null };

  const days = normalized.days.map((day) => {
    const orderingItems = day.visits.map((visit, index) => ({
      id: visit.ref,
      item_type: "visit",
      start_time: visit.time?.start || null,
      end_time: visit.time?.end || null,
      sort_order: (index + 1) * 10,
      created_at: `import-${String(index + 1).padStart(6, "0")}`,
    }));
    const ordering = planUntimedSortOrdersForVisualOrder({
      items: orderingItems,
      nextVisitIds: day.visits.map((visit) => visit.ref),
    });
    if (!ordering.ok) {
      return { error: { code: ordering.errorCode || "invalid_order", path: `$.days[${day.day_index}].visits`, message: "無法重建未設定時間行程順序。 " } };
    }
    return {
      day_index: day.day_index,
      date: day.date,
      visits: day.visits.map((visit, index) => ({
        ref: visit.ref,
        sort_order: visit.time === null ? ordering.sortOrders[visit.ref] : (index + 1) * 10,
        type: visit.category,
        title: visit.title,
        ...persistenceLocation(visit.location),
        description: visit.notes,
        transportation_note: null,
        cost: visit.estimated_cost,
        ...persistenceTime(visit.time),
        is_fixed: visit.fixed,
        alternatives: visit.alternatives.map(persistenceAlternative),
      })),
      transports: day.transports.map((transport, index) => ({
        ref: transport.ref,
        sort_order: (index + 1) * 10,
        from_visit_ref: transport.from_visit_ref,
        to_visit_ref: transport.to_visit_ref,
        transport_category: transport.category,
        transport_name: transport.name,
        transport_duration_minutes: transport.duration_minutes,
        transport_note: transport.notes,
      })),
    };
  });
  const orderingError = days.find((day) => day.error)?.error;
  if (orderingError) return { errors: [orderingError], ok: false, payload: null, warnings: validation.warnings };

  return {
    errors: [],
    ok: true,
    payload: {
      schema_version: tripJsonCurrentSchemaVersion,
      document_type: tripJsonDocumentType,
      trip: {
        title: normalized.trip.title,
        destination: normalized.trip.destination.display_name,
        destination_country: normalized.trip.destination.country,
        destination_city: normalized.trip.destination.city,
        start_date: normalized.trip.start_date,
        end_date: normalized.trip.end_date,
        status: normalized.trip.status,
      },
      days,
    },
    warnings: validation.warnings,
  };
}

export function tripJsonSemanticSignature(document) {
  return stringifyTripJsonDocument(normalizeTripJsonDocument(document));
}
