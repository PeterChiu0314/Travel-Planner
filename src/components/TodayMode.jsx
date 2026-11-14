import { dateToInputValue, formatDate, formatMoney, formatTimeDisplay, todayInput } from "../lib/displayFormat.js";
import { isTimedVisit } from "../lib/timelineUntimedOrdering.js";

function currentTimeInput() {
  const date = new Date();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export default function TodayMode({ canEdit, dayIndex, days, items, packItems, trip, onGoBudget, onGoTimeline }) {
  const day = days[dayIndex];
  const currentTime = currentTimeInput();
  const isCalendarToday = day ? dateToInputValue(day) === todayInput() : false;
  const nextStop =
    items.find((item) => !isCalendarToday || !isTimedVisit(item) || item.start_time >= currentTime) || items[0] || null;
  const hotelItem = [...items].reverse().find((item) => item.type === "hotel");
  const todayBudget = items.reduce((sum, item) => sum + Number(item.cost || 0), 0);
  const pendingPackItems = packItems.filter((item) => !item.done);
  const packedCount = packItems.length - pendingPackItems.length;

  return (
    <section className="today-mode" aria-label="今日模式">
      <div className="today-hero panel">
        <div>
          <p className="eyebrow">Today</p>
          <h3>{day ? `Day ${dayIndex + 1} · ${formatDate(day)}` : trip.title}</h3>
          <p>{trip.destination || "目的地未設定"}</p>
        </div>
        <button className="primary-button compact" type="button" onClick={onGoTimeline}>
          看行程
        </button>
      </div>

      <div className="today-grid">
        <article className="today-card today-card-wide">
          <div className="today-card-heading">
            <span>今日行程</span>
            <strong>{items.length}</strong>
          </div>
          {items.length ? (
            <ol className="today-schedule">
              {items.slice(0, 4).map((item) => (
                <li key={item.id}>
                  <time>{isTimedVisit(item) ? formatTimeDisplay(item.start_time) : "--:--"}</time>
                  <div>
                    <strong>{item.title}</strong>
                    {item.location ? <span>{item.location}</span> : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="today-empty">今天還沒有行程</p>
          )}
        </article>

        <article className="today-card">
          <span>下一站</span>
          <strong>{nextStop?.title || "尚未安排"}</strong>
          <p>{nextStop?.location || (isTimedVisit(nextStop) ? formatTimeDisplay(nextStop.start_time) : "") || "新增行程後會顯示"}</p>
        </article>

        <article className="today-card">
          <span>今日預算</span>
          <strong>{formatMoney(todayBudget)}</strong>
          <button className="ghost-button compact" disabled={!canEdit} type="button" onClick={onGoBudget}>
            快速記帳
          </button>
        </article>

        <article className="today-card">
          <span>待辦提醒</span>
          <strong>{pendingPackItems.length}</strong>
          <p>{pendingPackItems[0]?.title || "目前沒有提醒"}</p>
        </article>

        <article className="today-card">
          <span>今日住宿</span>
          <strong>{hotelItem?.title || "尚未設定"}</strong>
          <p>{hotelItem?.location || "可在行程加入住宿"}</p>
        </article>

        <article className="today-card">
          <span>行李提醒</span>
          <strong>
            {packedCount}/{packItems.length}
          </strong>
          <p>{pendingPackItems[0] ? `未完成：${pendingPackItems[0].title}` : "行李已完成"}</p>
        </article>
      </div>
    </section>
  );
}
