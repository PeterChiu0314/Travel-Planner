// One public TWD quote serves all currencies; no trip or member data is sent.
export const budgetCurrencies = ["JPY", "USD", "EUR", "KRW", "HKD"];
let cachedQuote;
let pendingQuote;

export function parseBudgetQuote(data) {
  if (data?.result !== "success" || data.base_code !== "TWD" || !Number.isFinite(data.time_last_update_unix)) throw new Error("匯率來源回傳無效資料。");
  for (const currency of budgetCurrencies) if (!data.rates?.[currency]) throw new Error(`無法取得 ${currency} 匯率。`);
  const rates = Object.fromEntries(Object.keys(data.rates || {}).map((currency) => {
    const value = data.rates?.[currency];
    const converted = Number((1 / value).toFixed(6));
    if (!/^[A-Z]{3}$/.test(currency) || typeof value !== "number" || !Number.isFinite(value) || value <= 0 || converted <= 0 || converted > 1000000) throw new Error(`無法取得 ${currency} 匯率。`);
    return [currency, converted];
  }));
  return { rates, source: "ExchangeRate-API", quoted_at: new Date(data.time_last_update_unix * 1000).toISOString() };
}

export async function fetchBudgetQuote({ force = false } = {}) {
  if (!force && cachedQuote && Date.now() - cachedQuote.fetchedAt < 3600000) return cachedQuote.value;
  if (!pendingQuote) pendingQuote = (async () => {
    const response = await fetch("https://open.er-api.com/v6/latest/TWD", { signal: AbortSignal.timeout(10000), credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error("暫時無法取得匯率，請稍後再試。");
    const value = parseBudgetQuote(await response.json());
    cachedQuote = { value, fetchedAt: Date.now() };
    return value;
  })().finally(() => { pendingQuote = null; });
  return pendingQuote;
}

export const demoBudgetQuote = { rates: { JPY: .22, USD: 32, EUR: 35, KRW: .024, HKD: 4.1 }, source: "Demo 固定示例", quoted_at: "2026-10-22T00:00:00.000Z" };
