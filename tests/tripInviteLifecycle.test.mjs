import test from "node:test";
import { readFile } from "node:fs/promises";
import { expenseBackend } from "./helpers/expenseBackend.js";

test("invite reads, retries, rotation, membership and expiry use authenticated database rules", async () => {
  const fixture = await expenseBackend({ timeline: true });
  try {
    const sql = await readFile(new URL("./sql/trip-invite-lifecycle.sql", import.meta.url), "utf8");
    await fixture.sql.exec(sql);
  } finally {
    await fixture.sql.close();
  }
});
