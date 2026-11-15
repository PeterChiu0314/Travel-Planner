import { timelineCardSelectionColor } from "../../lib/collaboratorColors.js";
import { memberInitial, memberName } from "../../lib/memberName.js";
import { formatHeaderDate } from "../../lib/tripDateUi.js";
import { tripPresencePageLabel } from "../../lib/tripPresenceDisplay.js";

export function TripHeaderIcon({ name }) {
  if (name === "invite") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M15 20a6 6 0 0 0-12 0" />
        <circle cx="9" cy="8" r="4" />
        <path d="M19 8v6" />
        <path d="M22 11h-6" />
      </svg>
    );
  }
  if (name === "share") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="m8.6 10.6 6.8-4.2" />
        <path d="m8.6 13.4 6.8 4.2" />
      </svg>
    );
  }
  if (name === "more") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="12" cy="5" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="12" cy="19" r="1.5" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m4 20 4.4-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" />
      <path d="m14 6 4 4" />
    </svg>
  );
}

export function TripDateChangePreview({ isRemovalConfirmed = false, onConfirmRemoval, preview }) {
  if (!preview || preview.type === "unchanged" || preview.type === "invalid") return null;
  const addedDayCount = Math.max(0, preview.newDayCount - preview.oldDayCount);
  const isBlocked = preview.type === "shortened-with-timeline";
  const isShortened = preview.type === "shortened-empty-tail" || preview.type === "shortened-with-timeline";
  const reviewCount = preview.accommodationCount + preview.todoCount;

  return (
    <div className={`trip-date-change-preview${isBlocked ? " is-blocked" : ""}`} aria-live="polite">
      {preview.type === "same-or-extended" ? (
        <p>
          Day 1 會對齊新的開始日期
          {addedDayCount ? `，並新增 ${addedDayCount} 個空白 Day。` : "，既有 Day 順序維持不變。"}
        </p>
      ) : null}
      {preview.type === "shortened-empty-tail" ? (
        <p>將移除 {preview.removedDayPositions.length} 個尾端空白 Day，未發現 Timeline 資料。</p>
      ) : null}
      {isBlocked ? <p>此變更會移除含有 Timeline 資料的 Day，本階段先阻擋儲存。</p> : null}
      {isShortened && preview.affectedDays.length ? (
        <ul className="trip-date-change-days">
          {preview.affectedDays.map((day) => (
            <li key={day.dayKey}>
              <strong>
                {day.label}
                {day.originalDate ? ` · ${formatHeaderDate(day.originalDate)}` : ""}
              </strong>
              {day.counts.timeline ? (
                <span>
                  {day.counts.visits} 個行程、{day.counts.transports} 個交通
                  {day.counts.fixed ? `、${day.counts.fixed} 個固定項目` : ""}
                  {day.counts.alternatives ? `、${day.counts.alternatives} 個備案` : ""}
                  {day.counts.budgetLinks ? `、${day.counts.budgetLinks} 個預算連結` : ""}
                </span>
              ) : (
                <span>空白 Day</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {reviewCount ? (
        <p className="trip-date-change-note">
          住宿 {preview.accommodationCount} 筆、待辦 {preview.todoCount} 筆不會自動調整，儲存後請人工確認。
        </p>
      ) : null}
      {isBlocked ? (
        <div className="trip-date-change-confirm">
          <span>
            {isRemovalConfirmed
              ? "已確認縮短旅程，儲存後會刪除上述 Timeline 資料。"
              : "請先確認縮短旅程，確認不會立即儲存。"}
          </span>
          {!isRemovalConfirmed ? (
            <button type="button" className="ghost-button compact" onClick={onConfirmRemoval}>
              確認縮短旅程
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function HeaderMemberPresencePreview({
  currentUserId,
  disabled,
  members = [],
  onOpen,
  onPresenceNavigate,
  pendingCount = 0,
  remotePresenceByUser = new Map(),
}) {
  const approvedMembers = members.filter((member) => member.status === "approved");
  const visibleMembers = approvedMembers.slice(0, 4);
  const overflowCount = Math.max(approvedMembers.length - visibleMembers.length, 0);
  return (
    <div className={`trip-header-member-preview${disabled ? " disabled" : ""}`} title="成員與邀請" aria-label="成員與邀請">
      <span className="trip-header-member-avatars">
        {visibleMembers.map((member) => {
          const presence = remotePresenceByUser.get(member.user_id) || null;
          const isRemoteOnline = Boolean(presence && member.user_id !== currentUserId);
          const pageLabel = presence ? tripPresencePageLabel(presence) : "";
          const avatarTitle = presence ? `${presence.userName || memberName(member)} · ${pageLabel}` : memberName(member);
          return (
            <button
              className={`member-avatar compact trip-header-member-avatar${isRemoteOnline ? " remote-online" : ""}`}
              disabled={disabled}
              key={member.id || member.user_id}
              style={isRemoteOnline ? { "--trip-presence-color": timelineCardSelectionColor(presence.colorKey) } : undefined}
              title={avatarTitle}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (isRemoteOnline && typeof onPresenceNavigate === "function") {
                  onPresenceNavigate(presence);
                } else if (!disabled && typeof onOpen === "function") {
                  onOpen();
                }
              }}
            >
              {memberInitial(member)}
            </button>
          );
        })}
        {overflowCount > 0 ? <span className="member-avatar compact more">+{overflowCount}</span> : null}
      </span>
      {pendingCount > 0 ? <span className="trip-header-member-pending">待審 {pendingCount}</span> : null}
      <button
        className="trip-header-member-open-button"
        disabled={disabled}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (!disabled && typeof onOpen === "function") onOpen();
        }}
      >
        <TripHeaderIcon name="invite" />
      </button>
    </div>
  );
}
