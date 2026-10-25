// Demo-only packing fixtures: 40 private + 16 assigned canonical shared items. No backend writes.
const privateGroups = [
  ["證件", ["護照", "健保卡・身分證", "現金錢包", "信用卡", "國際駕照", "登機證"]],
  ["電子用品", ["充電器", "行動電源", "手機充電線", "相機", "記憶卡", "耳機", "手錶充電線"]],
  ["衣物", ["薄外套", "換洗衣物", "短袖上衣", "長褲", "內衣褲", "襪子", "睡衣", "帽子", "運動鞋", "拖鞋"]],
  ["盥洗用品", ["牙刷・盥洗包", "牙膏", "洗面乳", "洗髮精", "沐浴乳", "毛巾", "刮鬍刀"]],
  ["健康用品", ["個人常備藥", "防曬乳", "防蚊液", "口罩", "隱形眼鏡藥水"]],
  ["日常用品", ["折疊傘", "水壺", "衛生紙", "濕紙巾", "旅行收納袋"]],
];
const privateNotes = {
  "護照": "確認效期，影本另放", "健保卡・身分證": "放隨身證件夾", "現金錢包": "日圓現金分兩處收好", "信用卡": "已開通海外交易",
  "國際駕照": "確認租車所需文件與有效期限", "登機證": "出發前完成線上報到",
  "充電器": "USB-C 雙孔，放隨身包", "行動電源": "10,000mAh，放隨身包", "手機充電線": "帶兩條，一長一短", "相機": "出發前充滿電", "記憶卡": "先備份並確認剩餘容量",
  "薄外套": "早晚溫差大，放在方便拿的位置", "換洗衣物": "依天數分裝，另備髒衣袋", "運動鞋": "選已穿習慣、適合步行的鞋", "拖鞋": "住宿室內使用",
  "牙刷・盥洗包": "放防水收納袋", "洗面乳": "分裝旅行瓶，確認瓶蓋鎖緊", "毛巾": "選快乾小尺寸",
  "個人常備藥": "保留原包裝與個人用藥說明", "防曬乳": "放日用小包，方便取用", "隱形眼鏡藥水": "確認容量與瓶身密封",
  "折疊傘": "輕量款，出門前看天氣", "水壺": "通過安檢前先倒空", "濕紙巾": "一包放隨身包", "旅行收納袋": "乾淨衣物與待洗衣物分開",
};
const sharedNotes = {
  "隨身 Wi-Fi": "出發前測試連線，回程記得歸還", "常備藥包": "腸胃藥、止痛藥與 OK 繃", "延長線・萬用轉接頭": "先確認可用插座與電壓",
  "票券資料夾": "電子檔備份，重要憑證另存離線", "租車預約確認單": "取車前確認預約號碼與時間", "住宿預約確認單": "核對入住日期、房型及人數",
  "相機腳架": "收納後綁緊固定帶", "多孔 USB 充電座": "晚上集中充電，離開前清點", "體溫計": "確認電池電量", "公用雨傘": "雨天放入口附近，使用後晾乾",
  "車用垃圾袋": "每日下車前清理", "野餐墊": "擦乾後再收納", "共用洗衣精": "少量分裝，瓶身標示清楚",
};
const existingIds = { "護照": 1, "充電器": 2, "薄外套": 3, "健保卡・身分證": 4, "行動電源": 5, "換洗衣物": 6, "牙刷・盥洗包": 7, "個人常備藥": 8 };
export function createDemoLuggageItems(tripId) {
  let nextId = 9;
  return privateGroups.flatMap(([category, titles]) => titles.map(title => ({ id: `demo-luggage-${existingIds[title] || nextId++}`, title, category })))
    .map((item, index) => ({ ...item, notes: privateNotes[item.title] || "", packed: index % 4 === 0, trip_id: tripId, owner_id: "demo-peter", updated_at: "2026-10-23T00:00:00.000Z" }));
}
const teamItems = [
  [1, "隨身 Wi-Fi", "電子用品", "demo-a", true, false],
  [2, "常備藥包", "健康用品", "demo-peter", false, false],
  [3, "延長線・萬用轉接頭", "電子用品", "demo-peter", false, false],
  [5, "票券資料夾", "證件", "demo-a", false, false],
  [6, "租車預約確認單", "證件", "demo-b", true, true],
  [7, "住宿預約確認單", "證件", "demo-c", true, false],
  [9, "相機腳架", "電子用品", "demo-c", true, true],
  [10, "多孔 USB 充電座", "電子用品", "demo-d", false, false],
  [11, "備用充電線組", "電子用品", "demo-a", true, false],
  [12, "體溫計", "健康用品", "demo-b", false, false],
  [13, "OK 繃與紗布", "健康用品", "demo-d", true, true],
  [15, "公用雨傘", "日常用品", "demo-peter", false, false],
  [16, "車用垃圾袋", "日常用品", "demo-peter", true, false],
  [17, "野餐墊", "日常用品", "demo-b", false, false],
  [18, "夾鏈袋組", "日常用品", "demo-c", true, true],
  [19, "共用洗衣精", "盥洗用品", "demo-d", false, false],
];
export function createDemoSharedLuggageItems(tripId) {
  return teamItems.map(([fixtureId, title, category, assigned_to, packed_by_assignee, confirmed_by_owner]) => ({ id: `demo-shared-luggage-${fixtureId}`, title, category, assigned_to, packed_by_assignee, confirmed_by_owner, notes: sharedNotes[title] || "", trip_id: tripId, updated_at: "2026-10-23T00:00:00.000Z" }));
}
