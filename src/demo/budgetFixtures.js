import {newExpense,priceExpense,confirmExpensePayment} from "../lib/expenseItems.js";

export const demoBudgetMembers = [
  { user_id: "demo-peter", display_name: "Peter", email: "peter@example.com", role: "owner", status: "approved" },
  { user_id: "demo-a", display_name: "Dennis", email: "dennis@example.com", role: "editor", status: "approved" },
  { user_id: "demo-b", display_name: "小羊", email: "sheep@example.com", role: "viewer", status: "approved" },
  { user_id: "demo-c", display_name: "Chloe", email: "chloe@example.com", role: "editor", status: "approved" },
  { user_id: "demo-d", display_name: "Dora", email: "dora@example.com", role: "viewer", status: "approved" },
];
const all = demoBudgetMembers.map((member) => member.user_id);
const three = all.slice(0, 3);
const pair = all.slice(0, 2);
const one = all.slice(0, 1);
const P = all[0], D = all[1], S = all[2], C = all[3], R = all[4];
export const kyotoDemoTripId = "demo-trip-kyoto";

// Illustrative amounts for UI testing, not live quotes or copied production
// financial records. Every link resolves to the existing Kyoto Timeline.
const definitions = [
  { key: "flight-out", category: "機票", title: "去程機票・桃園 → 關西", amount: 35745, currency: "TWD", payer: P, fixed: true, links: ["台灣虎航"] },
  { key: "flight-back", category: "機票", title: "回程機票・名古屋 → 桃園", amount: 22085, currency: "TWD", payer: D, fixed: true, links: ["搭飛機回家QQ"] },
  { key: "bus", category: "交通", subcategory: "機場交通", title: "關西機場 → 京都巴士", unit: 2800, payer: P, links: ["機場巴士+JR交通時間"] },
  { key: "rental", category: "交通", subcategory: "租車", title: "Orix 租車 3 天（含保險）", amount: 49060, payer: P, links: ["大津市Orix租車", "Orix Rent-a-car米原還車"], note: "共用車輛，總額均分。" },
  { key: "fuel", category: "交通", title: "租車加油", amount: 8000, payer: D, links: ["Orix Rent-a-car米原還車"] },
  { key: "parking", category: "交通", title: "停車費", amount: 3000, payer: S, links: ["彥根城", "海津大崎賞櫻"] },
  { key: "shinkansen", category: "交通", title: "米原 → 名古屋新幹線", unit: 3600, payer: D, fixed: true, links: ["JR米原站"] },
  { key: "airport-train", category: "交通", title: "名鐵・名古屋 → 中部機場", unit: 980, payer: C, links: ["搭乘名鐵到中部機場"] },
  { key: "ic", category: "交通", title: "交通 IC 卡儲值", unit: 2000, payer: R, note: "每人各自使用，分攤仍依參與成員計算。" },
  { key: "hotel", category: "住宿", subcategory: "京都山科山樂酒店", title: "京都山科山樂酒店・2 晚", amount: 90000, payer: P, fixed: true, links: ["京都山科山樂酒店", "飯店休息"] },
  { key: "villa", category: "住宿", subcategory: "近江八幡夢園", title: "近江八幡夢園 Villa・2 晚", amount: 72000, payer: D, fixed: true, links: ["近江八幡夢園check in", "睡覺覺"] },
  { key: "shikitei", category: "住宿", subcategory: "海津大崎四季亭", title: "海津大崎四季亭 Villa・1 晚", amount: 85000, payer: S, fixed: true, links: ["Check in+賞櫻"] },
  { key: "byodoin", category: "門票", title: "平等院門票", unit: 700, participants: three, payer: P, links: ["宇治市漫遊"], note: "只有 Peter、Dennis、小羊參加，其他兩人自由活動。" },
  { key: "boat", category: "門票", title: "伏見十石舟遊船", unit: 1900, participants: pair, payer: D, links: ["伏見十石舟"] },
  { key: "castle", category: "門票", title: "彥根城門票", unit: 1000, payer: S, links: ["彥根城"] },
  { key: "day1-lunch", category: "餐飲", subcategory: "午餐", title: "Day 1・關西機場午餐", unit: 1500, payer: P, links: ["關西機場午餐"] },
  { key: "day1-dinner", category: "餐飲", subcategory: "晚餐", title: "Day 1・京都晚餐", unit: 2200, payer: D, links: ["八坂神社(祇園)"] },
  { key: "uji-lunch", category: "餐飲", subcategory: "午餐", title: "Day 2・宇治午餐", unit: 1800, payer: S, links: ["宇治吃午餐"] },
  { key: "uji-tea", category: "餐飲", subcategory: "下午茶", title: "宇治抹茶與甜點", unit: 1200, participants: [P, S, C], payer: C, links: ["宇治市漫遊"] },
  { key: "day2-dinner", category: "餐飲", title: "Day 2・山科晚餐", unit: 2500, payer: R, links: ["山科-晚餐與購物"] },
  { key: "lake-lunch", category: "餐飲", title: "Day 3・琵琶湖午餐", unit: 2000, payer: P, links: ["琵琶湖-午餐"] },
  { key: "hotpot", category: "餐飲", title: "Villa 火鍋食材", shares: { [P]: 2000, [D]: 1500, [S]: 1000, [C]: 1800, [R]: 1700 }, payer: D, links: ["Villa晚餐-自煮火鍋"], note: "依個別食材需求分攤，不使用平均金額。" },
  { key: "italian", category: "餐飲", title: "Day 4・義式料理午餐", unit: 2400, payer: C, links: ["豐鄉-午餐義式料理"] },
  { key: "bbq", category: "餐飲", title: "Day 4・近江牛燒肉", shares: { [P]: 6000, [D]: 5000, [S]: 4000, [C]: 5500, [R]: 4500 }, payer: P, links: ["晚餐吃燒肉!"], note: "各人餐點不同，自訂分攤。" },
  { key: "burgers", category: "餐飲", title: "Day 5・漢堡午餐", unit: 1700, payer: S, links: ["午餐-美式漢堡"] },
  { key: "villa-dinner", category: "餐飲", title: "四季亭 Villa 晚餐", amount: 12000, payer: D, links: ["四季亭Villa晚餐"] },
  { key: "farm-lunch", category: "餐飲", title: "Day 6・在地小農午餐", unit: 1600, payer: R, links: ["在地小農午餐"] },
  { key: "airport-dinner", category: "餐飲", title: "中部機場晚餐", unit: 1800, payer: P, links: ["在名古屋中部機場吃晚餐"] },
  { key: "souvenir", category: "購物", title: "La Collina 伴手禮", unit: 3000, participants: pair, payer: D, links: ["La Collina 近江八幡"] },
  { key: "personal", category: "購物", title: "Peter 的個人採買", amount: 4500, participants: one, payer: P, links: ["山科-晚餐與購物"] },
  { key: "insurance", category: "其他", title: "旅遊保險", unit: 650, currency: "TWD", payer: P, fixed: true },
  { key: "esim", category: "其他", title: "eSIM・5 人上網", amount: 1250, currency: "TWD", payer: R, fixed: true },
];

// Synthetic Demo seed, built directly with the same single-expense operations.
export function createDemoExpenseModels(trip,itinerary) {
  if(trip.id!==kyotoDemoTripId)return [];
  return definitions.map(definition=>{
    const participantIds=definition.participants||(definition.shares?Object.keys(definition.shares):all);
    let item={...newExpense({id:`demo-expense-${definition.key}`,tripId:trip.id,members:demoBudgetMembers}),
      title:definition.title,category:definition.category,note:definition.note||"",payer_id:definition.payer||null};
    item=priceExpense(item,'budget',{participantIds,currency:definition.currency||"JPY",exchange_rate:definition.currency==='TWD'?1:0.22,
      pricing_mode:definition.shares?'custom':definition.unit!=null?'per_person':'split_total',unit_amount:definition.unit,amount:definition.amount,shares:definition.shares},0);
    item.links=(definition.links||[]).map(title=>{const linked=itinerary.find(i=>i.title===title);if(!linked)throw new Error(`Demo itinerary link missing: ${title}`);return linked.id;});
    if(definition.fixed)item=confirmExpensePayment(item,{paidAt:'2027-04-01T08:00:00.000Z',payerId:item.payer_id,basePayment:0,baseBudget:item.revisions.budget,basePaid:0});
    return item;
  });
}
