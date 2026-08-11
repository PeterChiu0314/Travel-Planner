import { expect, test } from "@playwright/test";
import { normalizeTransportSnapshotTime } from "../src/lib/timelineTransportationRoles.js";

test("transport snapshots compare PostgreSQL time strings at minute precision", () => {
  expect(normalizeTransportSnapshotTime("09:00:00")).toBe("09:00");
  expect(normalizeTransportSnapshotTime("10:15:00.000000")).toBe("10:15");
  expect(normalizeTransportSnapshotTime("11:30")).toBe("11:30");
  expect(normalizeTransportSnapshotTime(null)).toBeNull();
});

test("transport snapshot normalization preserves unexpected values for safe mismatch", () => {
  expect(normalizeTransportSnapshotTime("invalid-time")).toBe("invalid-time");
});
