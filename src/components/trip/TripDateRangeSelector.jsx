import { useMemo } from "react";
import { todayInput } from "../../lib/displayFormat.js";
import { formatDateKey, isDateBefore, startOfMonth } from "../../lib/tripDateUi.js";

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function calendarMonthCells(monthDate) {
  const monthStart = startOfMonth(monthDate);
  const leadingDays = monthStart.getDay();
  const totalDays = daysInMonth(monthStart);
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const monthDay = index - leadingDays + 1;
    if (monthDay < 1 || monthDay > totalDays) {
      cells.push({ blank: true, key: `blank-${formatDateKey(monthStart)}-${index}` });
      continue;
    }
    const date = new Date(monthStart);
    date.setDate(monthDay);
    cells.push({ date, key: formatDateKey(date), day: date.getDate() });
  }
  return cells;
}

function isSameDate(first, second) {
  return Boolean(first && second && first === second);
}

function isDateInRange(value, start, end) {
  return Boolean(value && start && end && value >= start && value <= end);
}

export default function TripDateRangeSelector({
  activeStep,
  disabled = false,
  endDate,
  endInput,
  errorId,
  minDateKey = "",
  onCommitInput,
  onEndInputChange,
  onHoverDate,
  onInputKeyDown,
  onSelectDate,
  onStartInputChange,
  onVisibleMonthChange,
  previewEndDate = "",
  startDate,
  startInput,
  startInputRef,
  visibleMonth,
}) {
  const monthFormat = useMemo(() => new Intl.DateTimeFormat("zh-TW", { month: "long", year: "numeric" }), []);
  const fullDateFormat = useMemo(
    () => new Intl.DateTimeFormat("zh-TW", { day: "numeric", month: "long", year: "numeric" }),
    [],
  );

  function renderMonth(monthDate, controls = {}) {
    const cells = calendarMonthCells(monthDate);
    const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
    return (
      <section className="trip-date-range-month" key={formatDateKey(monthDate)}>
        <div className="trip-date-range-month-header">
          {controls.previous ? (
            <button
              type="button"
              className="mini-button"
              disabled={disabled}
              aria-label="上一個月份"
              onClick={() => onVisibleMonthChange(addMonths(visibleMonth, -1))}
            >
              &lt;
            </button>
          ) : (
            <span />
          )}
          <strong>{monthFormat.format(monthDate)}</strong>
          {controls.next ? (
            <button
              type="button"
              className="mini-button"
              disabled={disabled}
              aria-label="下一個月份"
              onClick={() => onVisibleMonthChange(addMonths(visibleMonth, 1))}
            >
              &gt;
            </button>
          ) : (
            <span />
          )}
        </div>
        <div className="trip-date-range-weekdays" aria-hidden="true">
          {weekdays.map((weekday) => (
            <span key={weekday}>{weekday}</span>
          ))}
        </div>
        <div className="trip-date-range-grid">
          {cells.map((cell) => {
            if (cell.blank) {
              return <span className="trip-date-range-day-blank" key={cell.key} aria-hidden="true" />;
            }
            const isDisabledDate = Boolean(minDateKey && isDateBefore(cell.key, minDateKey));
            const isRangeStart = isSameDate(cell.key, startDate);
            const isRangeEnd = isSameDate(cell.key, endDate);
            const isSingleDay = Boolean(startDate && endDate && isSameDate(startDate, endDate) && isRangeStart);
            const isInRange = isDateInRange(cell.key, startDate, endDate) && !isRangeStart && !isRangeEnd;
            const isPreviewRange =
              !isDisabledDate && Boolean(previewEndDate) && isDateInRange(cell.key, startDate, previewEndDate) && !isRangeStart;
            const classNames = [
              "trip-date-range-day",
              isDisabledDate ? "is-disabled" : "",
              isSameDate(cell.key, todayInput()) ? "is-today" : "",
              isRangeStart ? "is-range-start" : "",
              isInRange ? "is-in-range" : "",
              isRangeEnd ? "is-range-end" : "",
              isSingleDay ? "is-single-day" : "",
              isPreviewRange ? "is-preview-range" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const selectionLabel = isRangeStart
              ? "，開始日期"
              : isRangeEnd
                ? "，結束日期"
                : isInRange || isPreviewRange
                  ? "，行程範圍內"
                  : "";
            return (
              <button
                className={classNames}
                key={cell.key}
                type="button"
                disabled={disabled || isDisabledDate}
                aria-label={`${fullDateFormat.format(cell.date)}${selectionLabel}`}
                aria-disabled={isDisabledDate ? "true" : undefined}
                aria-selected={isRangeStart || isRangeEnd || isInRange}
                onClick={() => onSelectDate(cell.key)}
                onMouseEnter={() => {
                  if (!disabled && !isDisabledDate && activeStep === "end" && startDate && !endDate) onHoverDate(cell.key);
                }}
                onFocus={() => {
                  if (!disabled && !isDisabledDate && activeStep === "end" && startDate && !endDate) onHoverDate(cell.key);
                }}
              >
                <span>{cell.day}</span>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="trip-date-range-summary" aria-live="polite">
        <label className={`trip-date-range-summary-item${activeStep === "start" ? " is-active" : ""}`}>
          <span>開始日期</span>
          <input
            ref={startInputRef}
            type="text"
            inputMode="numeric"
            placeholder="YYYYMMDD"
            value={startInput}
            disabled={disabled}
            aria-describedby={errorId}
            onBlur={() => onCommitInput("start")}
            onChange={(event) => onStartInputChange(event.target.value)}
            onKeyDown={(event) => onInputKeyDown(event, "start")}
          />
        </label>
        <label className={`trip-date-range-summary-item${activeStep === "end" ? " is-active" : ""}`}>
          <span>結束日期</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="YYYYMMDD"
            value={endInput}
            disabled={disabled}
            aria-describedby={errorId}
            onBlur={() => onCommitInput("end")}
            onChange={(event) => onEndInputChange(event.target.value)}
            onKeyDown={(event) => onInputKeyDown(event, "end")}
          />
        </label>
      </div>
      <div className="trip-date-range-picker">
        <div className="trip-date-range-months" onMouseLeave={() => onHoverDate("")}>
          {renderMonth(visibleMonth, { previous: true })}
          {renderMonth(addMonths(visibleMonth, 1), { next: true })}
        </div>
      </div>
    </>
  );
}
