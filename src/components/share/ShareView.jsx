import { useMemo } from "react";
import { formatDate, formatTimeDisplay } from "../../lib/displayFormat.js";
import { isTimedVisit, sortScheduleItems } from "../../lib/timelineUntimedOrdering.js";

export default function ShareView({ error, loading, snapshot }) {
  const trip = snapshot?.trip;
  const itineraryItems = snapshot?.itinerary_items || [];
  const accommodations = snapshot?.accommodations || [];
  const guideItems = snapshot?.guide_items || [];
  const sortedItineraryItems = useMemo(() => sortScheduleItems(itineraryItems), [itineraryItems]);

  const groupedItems = sortedItineraryItems.reduce((groups, item) => {
    const key = item.date || `Day ${Number(item.day_index || 0) + 1}`;
    groups[key] = [...(groups[key] || []), item];
    return groups;
  }, {});

  if (loading || (!snapshot && !error)) {
    return <div className="center-state share-center">載入分享行程中...</div>;
  }

  if (error) {
    return (
      <section className="share-view">
        <div className="share-hero">
          <p className="eyebrow">Shared Travel Plan</p>
          <h1>無法開啟分享頁</h1>
          <p>{error}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="share-view">
      <div className="share-hero">
        <p className="eyebrow">Shared Travel Plan</p>
        <h1>{trip?.title || trip?.name || "旅程分享"}</h1>
        <p>
          {[trip?.destination, trip?.start_date && trip?.end_date ? `${trip.start_date} - ${trip.end_date}` : ""]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <div className="share-content">
        <section className="share-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Itinerary</p>
              <h2>行程</h2>
            </div>
          </div>
          {Object.entries(groupedItems).length ? (
            Object.entries(groupedItems).map(([date, dayItemsForShare]) => (
              <div className="share-day" key={date}>
                <h3>{date.includes("-") ? formatDate(new Date(`${date}T00:00:00`)) : date}</h3>
                {dayItemsForShare.map((item) => (
                  <article className="share-card" key={item.id}>
                    <div className="share-time">
                      <strong>{isTimedVisit(item) ? formatTimeDisplay(item.start_time) : "--:--"}</strong>
                      {isTimedVisit(item) ? <span>{formatTimeDisplay(item.end_time)}</span> : null}
                    </div>
                    <div>
                      <h4>{item.title}</h4>
                      {item.location_name ? <p>{item.location_name}</p> : null}
                      {item.transportation_note ? <p>{item.transportation_note}</p> : null}
                      {item.description ? <p>{item.description}</p> : null}
                      {item.map_url ? (
                        <a href={item.map_url} rel="noreferrer" target="_blank">
                          開啟地圖
                        </a>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ))
          ) : (
            <div className="empty-inline">尚未建立公開行程。</div>
          )}
        </section>

        <section className="share-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Accommodation</p>
              <h2>住宿</h2>
            </div>
          </div>
          <div className="share-card-grid">
            {accommodations.length ? (
              accommodations.map((stay) => (
                <article className="share-card vertical" key={stay.id}>
                  <h4>{stay.name}</h4>
                  <p>
                    {stay.check_in_date} - {stay.check_out_date}
                  </p>
                  {stay.address ? <p>{stay.address}</p> : null}
                  {stay.custom_notes ? <p>{stay.custom_notes}</p> : null}
                  {stay.map_url ? (
                    <a href={stay.map_url} rel="noreferrer" target="_blank">
                      開啟地圖
                    </a>
                  ) : null}
                </article>
              ))
            ) : (
              <div className="empty-inline">尚未建立公開住宿。</div>
            )}
          </div>
        </section>

        <section className="share-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Guide</p>
              <h2>指南</h2>
            </div>
          </div>
          <div className="share-card-grid">
            {guideItems.length ? (
              guideItems.map((guide) => (
                <article className="share-card vertical" key={guide.id}>
                  <h4>{guide.title}</h4>
                  {guide.description ? <p>{guide.description}</p> : null}
                  {guide.url ? (
                    <a href={guide.url} rel="noreferrer" target="_blank">
                      開啟連結
                    </a>
                  ) : null}
                </article>
              ))
            ) : (
              <div className="empty-inline">尚未建立公開指南。</div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
