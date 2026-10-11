import { buildTripImportNotices } from "../../lib/tripImportNotices.js";

export default function TripImportNotices({ warnings }) {
  const { draftNote, reminders } = buildTripImportNotices(warnings);

  return (
    <>
      {draftNote ? <p className="trip-import-draft-note">{draftNote}</p> : null}
      {reminders.length ? (
        <div aria-label="匯入提醒" className="trip-import-issues warning">
          <strong>匯入提醒</strong>
          <ul>{reminders.slice(0, 20).map((message) => <li key={message}>{message}</li>)}</ul>
          {reminders.length > 20 ? <p>另有 {reminders.length - 20} 項提醒。</p> : null}
        </div>
      ) : null}
    </>
  );
}
