import { demoBudgetMembers } from "./budgetFixtures.js";
import { isTransportationCard } from "../lib/timelineTransportationRoles.js";
import { buildTransportPairSnapshot } from "../lib/timelineTransportPairs.js";
import { transportNameValue } from "../lib/timelineTransportCategories.js";
import kyotoDemoTrip from "../demo-kyoto-trip.json";
import { defaultTransportCategory } from "../components/timeline/timelineItemRules.js";

export function demoId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function demoSectionLabel(section) {
  return {
    timeline: "行程",
    budget: "預算",
    accommodation: "住宿資訊",
    todo: "待辦指南",
    luggage: "行李",
    settlement: "分帳結算",
  }[section] || section;
}

const demoTrip = {
  id: "demo-trip",
  title: "東京家庭旅行 Demo",
  destination: "東京,日本",
  destination_city: "東京",
  destination_country: "日本",
  start_date: "2026-06-12",
  end_date: "2026-06-14",
  status: "planning",
};

export const demoTrips = [
  {
    ...demoTrip,
    id: "demo-trip-kyoto",
    title: kyotoDemoTrip.title,
    destination: kyotoDemoTrip.destination,
    destination_city: kyotoDemoTrip.destination_city,
    destination_country: kyotoDemoTrip.destination_country,
    start_date: kyotoDemoTrip.start_date,
    end_date: kyotoDemoTrip.end_date,
    updated_at: kyotoDemoTrip.updated_at,
  },
  {
    ...demoTrip,
    id: "demo-trip-system",
    title: "系統測試專用",
    destination: "日本・京都",
    start_date: "2026-07-08",
    end_date: "2026-07-12",
    updated_at: "2026-06-14T10:00:00.000Z",
  },
  {
    ...demoTrip,
    id: "demo-trip-wild",
    title: "野人沒有日記",
    destination: "綠野山林",
    start_date: "2026-05-30",
    end_date: "2026-06-02",
    updated_at: "2026-06-13T10:00:00.000Z",
  },
  {
    ...demoTrip,
    id: "demo-trip-a-test",
    title: "A_TEST",
    destination: "Taiwan・Yilan",
    start_date: "2026-06-23",
    end_date: "2026-06-25",
    updated_at: "2026-06-12T10:00:00.000Z",
  },
];

export const demoMembers = demoBudgetMembers;

function normalizeDemoTime(value) {
  return value ? String(value).slice(0, 5) : "";
}

function normalizeDemoTimePair(startTime, endTime) {
  const normalizedStartTime = normalizeDemoTime(startTime);
  const normalizedEndTime = normalizeDemoTime(endTime);
  if (!normalizedStartTime || !normalizedEndTime) return { start_time: "", end_time: "" };
  return { start_time: normalizedStartTime, end_time: normalizedEndTime };
}

const demoFixedVisitIds = new Set([
  "1afc6297-cf0d-453f-ae3f-2b4e049508f4",
  "926fe5ee-1973-44bb-ab63-634892943aa6",
]);

function createDemoTransportFixture(items, {
  category = defaultTransportCategory,
  durationMinutes = 20,
  fromId,
  id,
  title,
  toId,
}) {
  const fromItem = items.find((item) => item.id === fromId);
  const toItem = toId ? items.find((item) => item.id === toId) : null;
  if (!fromItem || (toId && !toItem)) return null;
  return {
    id,
    trip_id: fromItem.trip_id,
    day_index: fromItem.day_index,
    sort_order: Number(fromItem.sort_order || 0) + 0.5,
    item_type: "transport",
    type: "transport",
    title,
    location: null,
    note: null,
    cost: 0,
    created_by: "demo-peter",
    created_at: "2026-06-30T00:00:00.000Z",
    updated_at: "2026-06-30T00:00:00.000Z",
    date: fromItem.date || null,
    location_name: null,
    address: null,
    map_url: null,
    latitude: null,
    longitude: null,
    description: null,
    transportation_note: null,
    locked_by: null,
    locked_at: null,
    transport_category: category,
    transport_name: title,
    transport_duration_minutes: durationMinutes,
    transport_note: null,
    from_item_id: fromId,
    to_item_id: toId,
    transport_role: "normal_pair",
    ...buildTransportPairSnapshot(fromItem, toItem),
    is_fixed: false,
    fixed_at: null,
    fixed_by: null,
  };
}

function createDemoTransportFixtures(items) {
  return [
    createDemoTransportFixture(items, {
      category: "car",
      durationMinutes: 20,
      fromId: "92b182ce-302c-469f-907b-14acda01aa1e",
      id: "demo-transport-day3-napoli-kasahara",
      title: "F・20分鐘",
      toId: "8e3cd404-f6fe-4116-829d-5f218613b96d",
    }),
    createDemoTransportFixture(items, {
      category: "walk",
      durationMinutes: 12,
      fromId: "f3973db2-8a80-444f-8108-7fe00c5c3f2a",
      id: "demo-transport-day4-lunch-school",
      title: "步行・12分鐘",
      toId: "4b9e4e09-b699-45af-9545-79f13f0d522d",
    }),
  ].filter(Boolean);
}

export function demoSortOrderForNewTimelineItem({ currentDayVisits = [], item }) {
  if (isTransportationCard(item)) {
    const fromItem = currentDayVisits.find((candidate) => candidate.id === item.from_item_id);
    const toItem = currentDayVisits.find((candidate) => candidate.id === item.to_item_id);
    const fromOrder = Number(fromItem?.sort_order);
    const toOrder = Number(toItem?.sort_order);
    if (Number.isFinite(fromOrder) && Number.isFinite(toOrder) && fromOrder !== toOrder) {
      return (fromOrder + toOrder) / 2;
    }
    if (Number.isFinite(fromOrder)) return fromOrder + 0.5;
  }
  return (currentDayVisits.length + 1) * 10;
}

export function createDemoTimelineItems() {
  const baseItems = [
    ...(kyotoDemoTrip.itinerary_items || []),
    {
      id: "demo-untimed-philosophers-path",
      trip_id: "demo-trip-kyoto",
      day_index: 5,
      sort_order: -1_998_500_000,
      item_type: "visit",
      type: "attraction",
      title: "未排時間・哲學之道散步",
      location_name: "哲學之道",
      start_time: null,
      end_time: null,
      description: "可拖曳安排到沒有交通卡連接的時段",
      is_fixed: false,
      updated_at: "2026-06-24T00:00:00.000Z",
    },
  ];
  const demoTransportFixtures = createDemoTransportFixtures(baseItems);
  const demoTransportFixtureIds = new Set(demoTransportFixtures.map((item) => item.id));
  return [
    ...baseItems.filter((item) => !demoTransportFixtureIds.has(item.id)),
    ...demoTransportFixtures,
  ]
    .map((item, index) => ({
      ...item,
      trip_id: "demo-trip-kyoto",
      sort_order: Number.isFinite(Number(item.sort_order)) ? Number(item.sort_order) : index,
      item_type: item.item_type || "visit",
      ...normalizeDemoTimePair(item.start_time, item.end_time),
      from_snapshot_start_time: normalizeDemoTime(item.from_snapshot_start_time),
      from_snapshot_end_time: normalizeDemoTime(item.from_snapshot_end_time),
      to_snapshot_start_time: normalizeDemoTime(item.to_snapshot_start_time),
      to_snapshot_end_time: normalizeDemoTime(item.to_snapshot_end_time),
      note: item.note || "",
      description: item.description || item.note || "",
      transportation_note: item.transportation_note || item.transport_note || "",
      cost: Number(item.cost || 0),
      transport_category: item.item_type === "transport" ? item.transport_category || defaultTransportCategory : item.transport_category || null,
      transport_name: item.item_type === "transport" ? transportNameValue(item) : item.transport_name || null,
      transport_duration_minutes:
        item.item_type === "transport" && Number.isFinite(Number(item.transport_duration_minutes))
          ? Number(item.transport_duration_minutes)
          : item.item_type === "transport"
            ? null
            : item.transport_duration_minutes || null,
      transport_note: item.item_type === "transport" ? item.transport_note || item.transportation_note || item.description || item.note || "" : item.transport_note || null,
      from_item_id: item.item_type === "transport" ? item.from_item_id || null : item.from_item_id || null,
      to_item_id: item.item_type === "transport" ? item.to_item_id || null : item.to_item_id || null,
      transport_role: item.item_type === "transport" ? "normal_pair" : null,
      fixed_at: demoFixedVisitIds.has(item.id) ? item.fixed_at || "2026-06-30T00:00:00.000Z" : item.fixed_at || null,
      fixed_by: demoFixedVisitIds.has(item.id) ? item.fixed_by || "demo-peter" : item.fixed_by || null,
      is_fixed: demoFixedVisitIds.has(item.id) || Boolean(item.is_fixed),
      locked_by: null,
      locked_at: null,
    }))
    .sort((a, b) => a.day_index - b.day_index || a.sort_order - b.sort_order || (a.start_time || "").localeCompare(b.start_time || ""));
}
