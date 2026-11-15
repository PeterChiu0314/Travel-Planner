import { expect, test } from "@playwright/test";
import { backend, boot } from "./helpers/formalBudgetMock.js";

test("Formal Header saves edits and requires separate confirmation and save for shortening", async ({ page }) => {
  const db = backend();
  const [trip] = db.trips;
  db.rows.trips = db.trips;
  db.rows.itinerary_items = [{
    id: "tail-visit", trip_id: trip.id, day_index: 5, date: "2090-04-10",
    item_type: "visit", title: "Tail visit", start_time: "09:00", end_time: "10:00",
  }];
  const dateCalls = [];
  const request = db.request.bind(db);
  db.request = async (call) => {
    if (call.name !== "apply_trip_date_change") return request(call);
    dateCalls.push(call.args);
    trip.end_date = call.args.new_end_date;
    db.rows.itinerary_items = [];
    return { data: { ok: true }, error: null };
  };
  await boot(page, db, "A", { waitForBudget: false });

  const header = page.locator(".trip-header");
  const title = header.getByTitle("點擊修改旅程名稱", { exact: true });
  const titleInput = header.getByRole("textbox", { name: "旅程名稱" });
  const brand = page.getByRole("heading", { name: "旅程工房", exact: true });
  await title.click();
  await expect(titleInput).toBeFocused();
  await titleInput.fill("Header QA");
  await titleInput.press("Enter");
  await expect(title).toHaveText("Header QA");
  await title.click();
  await titleInput.fill("Header renamed");
  await brand.click();
  await expect(title).toHaveText("Header renamed");
  await title.click();
  await titleInput.fill("Discarded");
  await titleInput.press("Escape");
  await expect(title).toHaveText("Header renamed");

  const destination = header.getByTitle("編輯目的地", { exact: true });
  await destination.click();
  const destinationDialog = header.getByRole("dialog", { name: "編輯旅程目的地" });
  const country = destinationDialog.getByRole("textbox", { name: "國家" });
  const city = destinationDialog.getByRole("textbox", { name: "城市" });
  await expect(country).toBeFocused();
  await country.fill("日本");
  await country.press("Enter");
  await expect(city).toBeFocused();
  await city.fill("大阪");
  await city.press("Enter");
  await expect(destination).toHaveText("日本 · 大阪");

  const more = header.getByRole("button", { name: "更多操作" });
  await more.click();
  await expect(header.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(header.getByRole("menu")).toHaveCount(0);
  await more.click();
  await brand.click();
  await expect(header.getByRole("menu")).toHaveCount(0);

  const dateTrigger = header.getByTitle("編輯旅程日期", { exact: true });
  const dateDialog = header.getByRole("dialog", { name: "編輯旅程日期" });
  const confirm = dateDialog.getByRole("button", { name: "確認縮短旅程" });
  const save = dateDialog.getByRole("button", { name: "儲存", exact: true });
  const draftShorterTrip = async () => {
    await dateTrigger.click();
    const end = dateDialog.getByRole("textbox", { name: "結束日期" });
    await end.fill("20900409");
    await end.press("Tab");
    await expect(dateDialog.getByText(/Day 6.*2090\/04\/10/)).toBeVisible();
    await expect(confirm).toBeVisible();
  };

  await draftShorterTrip();
  await save.click();
  await expect(dateDialog.getByRole("alert")).toHaveText("請先確認縮短旅程會刪除尾端 Timeline 資料。");
  expect(dateCalls).toEqual([]);
  await confirm.click();
  await expect(confirm).toHaveCount(0);
  expect(dateCalls).toEqual([]);
  await page.getByRole("navigation", { name: "功能導覽" }).getByRole("button", { name: "行程路線" }).click();
  await expect(dateDialog).toHaveCount(0);
  expect(dateCalls).toEqual([]);

  await draftShorterTrip();
  await confirm.click();
  expect(dateCalls).toEqual([]);
  await save.click();
  await expect(dateDialog).toHaveCount(0);
  await expect(dateTrigger).toContainText("2090/04/09");
  expect(dateCalls).toEqual([{
    trip_id: trip.id, new_start_date: "2090-04-05", new_end_date: "2090-04-09", confirm_timeline_removal: true,
  }]);
  expect(page.qaErrors).toEqual([]);
});
