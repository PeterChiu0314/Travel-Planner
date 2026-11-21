import { expect, test } from "@playwright/test";
import {
  buildTimelineItemSubmission,
  normalizeTimelineItemPayload,
} from "../src/components/timeline/timelineEditorForm.js";

const submissionForm = {
  item_type: "visit",
  title: "Unused title",
  location: "Old location",
  location_name: "  Museum  ",
  address: "  1 Main St  ",
  map_url: "  https://maps.google.com/?q=0,12.5  ",
  latitude: 0,
  longitude: undefined,
  description: "  New note  ",
  note: "Old note",
  transportation_note: "  Transfer note  ",
  transport_category: "",
  transport_name: "  Shuttle  ",
  transport_duration_minutes: "12.5",
  transport_note: "  Board here  ",
  to_item_id: null,
  cost: "",
  retained: undefined,
};

const visitSubmission = {
  item_type: "visit",
  title: "Museum",
  location: "Museum",
  location_name: "Museum",
  address: "1 Main St",
  map_url: "https://maps.google.com/?q=0,12.5",
  latitude: 0,
  longitude: null,
  description: "New note",
  note: "New note",
  transportation_note: "Transfer note",
  transport_category: "bus",
  transport_name: "Shuttle",
  transport_duration_minutes: 12.5,
  transport_note: "Board here",
  from_item_id: undefined,
  to_item_id: null,
  cost: 0,
  retained: undefined,
};

test("Timeline submission preserves aliases, trimming, and own keys", () => {
  expect(buildTimelineItemSubmission({
    itemSubmittedForm: submissionForm,
    currentPairSnapshot: {},
    defaultTransportCategory: "bus",
  })).toStrictEqual(visitSubmission);
});

test("Timeline transport submission gives the current pair snapshot precedence", () => {
  expect(buildTimelineItemSubmission({
    itemSubmittedForm: {
      ...submissionForm,
      item_type: "transport",
      location_name: "",
      from_snapshot_destination: "Stale origin",
      to_snapshot_start_time: "11:00",
      transport_category: "train",
      cost: "12.75",
    },
    currentPairSnapshot: { from_snapshot_destination: "Current origin", to_snapshot_start_time: null },
    defaultTransportCategory: "bus",
  })).toStrictEqual({
    ...visitSubmission,
    item_type: "transport",
    title: "Shuttle",
    location: "Old location",
    location_name: "Old location",
    transport_category: "train",
    from_snapshot_destination: "Current origin",
    to_snapshot_start_time: null,
    cost: 12.75,
  });
});

const clearedVisitTransportFields = {
  transport_category: null,
  transport_name: null,
  transport_duration_minutes: null,
  transport_note: null,
  from_item_id: null,
  to_item_id: null,
  transport_role: null,
  from_snapshot_start_time: null,
  from_snapshot_end_time: null,
  from_snapshot_destination: null,
  to_snapshot_start_time: null,
  to_snapshot_end_time: null,
  to_snapshot_destination: null,
};

const emptyVisitFields = {
  ...clearedVisitTransportFields,
  item_type: "visit",
  start_time: null,
  end_time: null,
  is_fixed: false,
  fixed_at: null,
  fixed_by: null,
  address: null,
  latitude: null,
  longitude: null,
  transportation_note: null,
};

// These expected objects describe the pre-extraction App.jsx contracts.
for (const { name, payload, expected } of [
  {
    name: "timed fixed visit derives coordinates from its URL",
    payload: {
      ...visitSubmission,
      start_time: "09:00",
      end_time: "10:00",
      is_fixed: true,
      fixed_at: "2026-01-01T00:00:00Z",
      fixed_by: "owner",
      latitude: 45,
      longitude: 90,
    },
    expected: {
      ...visitSubmission,
      ...clearedVisitTransportFields,
      start_time: "09:00",
      end_time: "10:00",
      is_fixed: true,
      fixed_at: "2026-01-01T00:00:00Z",
      fixed_by: "owner",
      latitude: 0,
      longitude: 12.5,
    },
  },
  {
    name: "untimed existing item merged with an alternative retains its identity",
    payload: {
      id: "existing-item",
      day_index: 2,
      type: "restaurant",
      title: "Old title",
      location: "Alternative",
      location_name: "Alternative",
      start_time: "",
      end_time: "",
      description: "",
      note: "",
      map_url: "",
      latitude: 45,
      longitude: 90,
      cost: 0,
    },
    expected: {
      ...emptyVisitFields,
      id: "existing-item",
      day_index: 2,
      type: "restaurant",
      title: "Alternative",
      location: "Alternative",
      location_name: "Alternative",
      description: "",
      note: "",
      map_url: null,
      cost: 0,
    },
  },
  {
    name: "half-set time clears fixed metadata and invalid URL clears the coordinate pair",
    payload: {
      title: "Legacy name",
      start_time: "09:00",
      is_fixed: true,
      fixed_at: "old revision",
      fixed_by: "owner",
      map_url: "invalid",
      latitude: 45,
      cost: undefined,
    },
    expected: {
      ...emptyVisitFields,
      title: "Legacy name",
      location: undefined,
      location_name: undefined,
      note: undefined,
      description: undefined,
      map_url: "invalid",
      cost: undefined,
    },
  },
]) {
  test(`Timeline normalization: ${name}`, () => {
    expect(normalizeTimelineItemPayload(payload, "bus")).toStrictEqual(expected);
  });
}

test("Timeline transport normalization preserves legacy aliases and persistence defaults", () => {
  expect(normalizeTimelineItemPayload({
    item_type: "transport",
    title: "  Legacy shuttle  ",
    transport_name: "",
    transport_category: "",
    transport_note: "",
    transportation_note: "  Transfer note  ",
    transport_duration_minutes: "12.5",
    from_item_id: "origin",
    to_item_id: "",
    from_snapshot_start_time: "09:00",
    from_snapshot_destination: "Museum",
    to_snapshot_end_time: undefined,
    start_time: "10:00",
    end_time: "10:13",
    is_fixed: true,
    fixed_at: "old revision",
    map_url: "https://maps.google.com/?q=0,12.5",
    cost: 0,
  }, "bus")).toStrictEqual({
    ...emptyVisitFields,
    item_type: "transport",
    type: "transport",
    title: "Legacy shuttle",
    location: null,
    location_name: null,
    note: "Transfer note",
    description: "Transfer note",
    transportation_note: "Transfer note",
    transport_category: "bus",
    transport_name: "Legacy shuttle",
    transport_duration_minutes: 13,
    transport_note: "Transfer note",
    from_item_id: "origin",
    transport_role: "normal_pair",
    from_snapshot_start_time: "09:00",
    from_snapshot_destination: "Museum",
    start_time: "10:00",
    map_url: null,
    cost: 0,
  });
});
