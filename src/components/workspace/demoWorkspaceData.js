// Local preview fixtures only. The Formal container continues to own persisted data.
export function createDemoStays(trip) {
  return [
    { id: "demo-stay-1", name: "京都車站旅館", check_in_date: trip.start_date, check_out_date: trip.end_date, check_in_time: "15:00", check_out_time: "11:00", booking_code: "DEMO-KYOTO", payment_status: "paid", address: "京都車站周邊（預覽範例）", map_url: "https://www.google.com/maps/search/?api=1&query=Kyoto+Station", custom_notes: "入住時出示護照與訂房確認信。\n可先寄放行李，再開始第一天行程。", budget_item_id: "" },
    { id: "demo-stay-2", name: "旅程備選住宿", check_in_date: trip.start_date, check_out_date: trip.end_date, check_in_time: "16:00", check_out_time: "10:00", booking_code: "", payment_status: "unpaid", address: "尚待確認", custom_notes: "供旅伴比較的備選方案；尚未確認預訂。", budget_item_id: "" },
  ];
}

export function createDemoTodos(trip) {
  return [
    { id: "demo-todo-1", title: "申請旅遊保險", description: "比較方案並確認保障期間涵蓋整趟旅程。", due_date: trip.start_date, assignee_id: "demo-peter", guide_id: "", completed: false },
    { id: "demo-todo-2", title: "確認車站轉乘方式", description: "查好出口與集合地點，抵達後可以直接出發。", due_date: trip.start_date, assignee_id: "demo-a", guide_id: "demo-guide-1", completed: false },
    { id: "demo-todo-3", title: "整理入住資料", description: "備妥訂房確認信與入住時間。", due_date: "", assignee_id: "demo-peter", guide_id: "", completed: true },
  ];
}

export function createDemoGuides() {
  return [
    { id: "demo-guide-1", title: "京都車站資訊", description: "先確認站內動線、交通轉乘與集合位置。", url: "https://www.kyoto-station-building.co.jp/" },
    { id: "demo-guide-2", title: "出發前確認事項", description: "將入境文件、保險資訊及重要聯絡方式放在一起，並預先保存離線副本。", url: "" },
  ];
}
