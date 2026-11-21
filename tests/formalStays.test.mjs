import assert from "node:assert/strict";
import test from "node:test";
import { saveTripStay } from "../src/features/stays/formalStays.js";

const trip = { id: "trip-a", start_date: "2030-02-01" };
const payload = {
  name: " Hotel ", address: " ", map_url: "", booking_code: " A1 ", custom_notes: "",
};

test("new stays use trip dates and preserve the optional expense link", () => {
  const client = {
    from(table) {
      assert.equal(table, "accommodations");
      return { insert: row => row };
    },
  };
  assert.deepEqual(saveTripStay({ client, trip, payload: { ...payload, expense_id: "expense-a" } }), {
    trip_id: trip.id, name: "Hotel", check_in_date: trip.start_date, check_out_date: trip.start_date,
    check_in_time: null, check_out_time: null, address: null, map_url: null, booking_code: "A1",
    payment_status: "unpaid", expense_id: "expense-a", custom_notes: null,
  });
});

test("editing clamps checkout and forwards the original conflict baseline and result", () => {
  const meta = { tripId: trip.id, baseUpdatedAt: "original" };
  const conflict = { conflict: true };
  const result = saveTripStay({
    trip, payload: { ...payload, check_in_date: "2030-02-07", check_out_date: "2030-02-05" },
    editingId: "stay-a", meta,
    updateWithConflictCheck(table, row, id, baseline) {
      assert.equal(table, "accommodations");
      assert.equal(id, "stay-a");
      assert.equal(baseline, meta);
      assert.equal(row.check_out_date, "2030-02-07");
      assert.equal(row.expense_id, null);
      return conflict;
    },
  });
  assert.equal(result, conflict);
});
