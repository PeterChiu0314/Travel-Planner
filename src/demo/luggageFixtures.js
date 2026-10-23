// Demo-only packing fixtures: 40 private + 20 canonical shared items. No backend writes.
const privateGroups = [
  ["證件", ["護照", "健保卡・身分證", "現金錢包", "信用卡", "國際駕照", "登機證"]],
  ["電子用品", ["充電器", "行動電源", "手機充電線", "相機", "記憶卡", "耳機", "手錶充電線"]],
  ["衣物", ["薄外套", "換洗衣物", "短袖上衣", "長褲", "內衣褲", "襪子", "睡衣", "帽子", "運動鞋", "拖鞋"]],
  ["盥洗用品", ["牙刷・盥洗包", "牙膏", "洗面乳", "洗髮精", "沐浴乳", "毛巾", "刮鬍刀"]],
  ["健康用品", ["個人常備藥", "防曬乳", "防蚊液", "口罩", "隱形眼鏡藥水"]],
  ["日常用品", ["折疊傘", "水壺", "衛生紙", "濕紙巾", "旅行收納袋"]],
];
const existingIds = { "護照": 1, "充電器": 2, "薄外套": 3, "健保卡・身分證": 4, "行動電源": 5, "換洗衣物": 6, "牙刷・盥洗包": 7, "個人常備藥": 8 };
export function createDemoLuggageItems(tripId) {
  let nextId = 9;
  return privateGroups.flatMap(([category, titles]) => titles.map(title => ({ id: `demo-luggage-${existingIds[title] || nextId++}`, title, category })))
    .map((item, index) => ({ ...item, packed: index % 4 === 0, trip_id: tripId, owner_id: "demo-peter", updated_at: "2026-10-23T00:00:00.000Z" }));
}
const teamItems = [
  ["隨身 Wi-Fi", "電子用品", "demo-a", true, false],
  ["常備藥包", "健康用品", "demo-peter", false, false],
  ["延長線・萬用轉接頭", "電子用品", "demo-peter", false, false],
  ["折疊購物袋", "日常用品", null, false, false],
  ["票券資料夾", "證件", "demo-a", false, false],
  ["租車預約確認單", "證件", "demo-b", true, true],
  ["住宿預約確認單", "證件", "demo-c", true, false],
  ["景點預約憑證", "證件", null, false, false],
  ["相機腳架", "電子用品", "demo-c", true, true],
  ["多孔 USB 充電座", "電子用品", "demo-d", false, false],
  ["備用充電線組", "電子用品", "demo-a", true, false],
  ["體溫計", "健康用品", "demo-b", false, false],
  ["OK 繃與紗布", "健康用品", "demo-d", true, true],
  ["酒精消毒棉片", "健康用品", null, false, false],
  ["公用雨傘", "日常用品", "demo-peter", false, false],
  ["車用垃圾袋", "日常用品", "demo-peter", true, false],
  ["野餐墊", "日常用品", "demo-b", false, false],
  ["夾鏈袋組", "日常用品", "demo-c", true, true],
  ["共用洗衣精", "盥洗用品", "demo-d", false, false],
  ["摺疊曬衣架", "盥洗用品", null, false, false],
];
export function createDemoSharedLuggageItems(tripId) {
  return teamItems.map(([title, category, assigned_to, packed_by_assignee, confirmed_by_owner], index) => ({ id: `demo-shared-luggage-${index + 1}`, title, category, assigned_to, packed_by_assignee, confirmed_by_owner, trip_id: tripId, updated_at: "2026-10-23T00:00:00.000Z" }));
}
