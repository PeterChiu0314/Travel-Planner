import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  formatDurationMinutes,
  formatTransportDurationMinutes,
  minutesToTimeValue,
  normalizeTimelineTimeInput,
  parseDurationMinutes,
  timeToMinutes,
} from "../../lib/timelineTime.js";
import { transportCategories } from "../../lib/timelineTransportCategories.js";
import { timelineTypeLabels as typeLabels } from "../../lib/timelineTypeStyles.js";

function wrapTimelineMinutes(totalMinutes) {
  return ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
}

function buildTimeOptions(stepMinutes = 5) {
  const options = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += stepMinutes) {
    const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mins = String(minutes % 60).padStart(2, "0");
    options.push(`${hours}:${mins}`);
  }
  return options;
}

const timelineTimeOptions = buildTimeOptions(5);

function buildDurationOptions(maxMinutes = 24 * 60 - 5, stepMinutes = 5) {
  const safeMaximum = Math.floor(Number(maxMinutes) / stepMinutes) * stepMinutes;
  const options = [];
  for (let minutes = stepMinutes; minutes <= safeMaximum; minutes += stepMinutes) options.push(minutes);
  return options;
}

export function OutlinedField({ children, className = "", fieldRef = null, invalid = false, label, ...fieldsetProps }) {
  return (
    <fieldset
      {...fieldsetProps}
      className={`outlined-field${className ? ` ${className}` : ""}${invalid ? " invalid" : ""}`}
      ref={fieldRef}
    >
      <legend>{label}</legend>
      <div className="outlined-field-control">{children}</div>
    </fieldset>
  );
}

function OutlinedMenuField({ className = "", label, listboxLabel, name, onValueChange, options, required = false, value }) {
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    if (!isMenuOpen) return undefined;
    window.requestAnimationFrame(() => menuRef.current?.querySelector(".selected")?.scrollIntoView({ block: "nearest" }));
    const closeMenu = (event) => {
      if (!rootRef.current?.contains(event.target)) setIsMenuOpen(false);
    };
    const closeMenuWithKeyboard = (event) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeMenu, true);
    document.addEventListener("keydown", closeMenuWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeMenu, true);
      document.removeEventListener("keydown", closeMenuWithKeyboard);
    };
  }, [isMenuOpen]);

  return (
    <OutlinedField
      className={`outlined-menu-field${className ? ` ${className}` : ""}${isMenuOpen ? " menu-open" : ""}`}
      fieldRef={rootRef}
      label={label}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsMenuOpen(false);
      }}
    >
      <input name={name} required={required} type="hidden" value={value} />
      <button
        aria-expanded={isMenuOpen}
        aria-haspopup="listbox"
        aria-label={label}
        aria-required={required || undefined}
        className="timeline-type-select-trigger"
        role="combobox"
        type="button"
        onClick={() => setIsMenuOpen((current) => !current)}
      >
        <span className="timeline-type-select-value">
          {options.find((option) => option.value === value)?.label || options[0]?.label}
        </span>
        <span className="timeline-time-menu-toggle" aria-hidden="true">
          <ChevronDown />
        </span>
      </button>
      {isMenuOpen ? (
        <div className="timeline-time-menu timeline-type-menu" ref={menuRef} role="listbox" aria-label={listboxLabel}>
          {options.map((option) => (
            <button
              aria-selected={option.value === value}
              className={option.value === value ? "selected" : ""}
              key={option.value}
              role="option"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onValueChange(option.value);
                setIsMenuOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </OutlinedField>
  );
}

export function TimelineTypeField({ onValueChange, value }) {
  return (
    <OutlinedMenuField
      className="visit-type-field"
      label="類型"
      listboxLabel="類型選項"
      name="type"
      onValueChange={onValueChange}
      options={Object.entries(typeLabels).map(([optionValue, label]) => ({ label, value: optionValue }))}
      value={value}
    />
  );
}

export function TransportCategoryField({ onValueChange, value }) {
  return (
    <OutlinedMenuField
      className="transport-category-field"
      label="交通類別"
      listboxLabel="交通類別選項"
      name="transport_category"
      onValueChange={onValueChange}
      options={transportCategories}
      required
      value={value}
    />
  );
}

export function TimelineSegmentedTimeField({ disabled = false, label, name, onValueChange, value }) {
  const initialSegments = String(value || "").split(":");
  const rootRef = useRef(null);
  const hourRef = useRef(null);
  const minuteRef = useRef(null);
  const menuRef = useRef(null);
  const draftRef = useRef({ hour: initialSegments[0] || "", minute: initialSegments[1] || "" });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [draftHour, setDraftHour] = useState(initialSegments[0] || "");
  const [draftMinute, setDraftMinute] = useState(initialSegments[1] || "");

  useLayoutEffect(() => {
    const [hour = "", minute = ""] = String(value || "").split(":");
    draftRef.current = { hour, minute };
    setDraftHour(hour);
    setDraftMinute(minute);
  }, [value]);

  useEffect(() => {
    if (!isMenuOpen) return undefined;
    window.requestAnimationFrame(() => menuRef.current?.querySelector(".selected")?.scrollIntoView({ block: "center" }));
    const closeMenu = (event) => {
      if (!rootRef.current?.contains(event.target)) setIsMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, [isMenuOpen]);

  function commitDraft(hour = draftRef.current.hour, minute = draftRef.current.minute) {
    if (!hour && !minute) {
      onValueChange("");
      return;
    }
    const normalized = normalizeTimelineTimeInput(`${hour || "0"}:${minute || "0"}`);
    if (normalized.ok) onValueChange(normalized.value);
    else {
      const [currentHour = "", currentMinute = ""] = String(value || "").split(":");
      setDraftHour(currentHour);
      setDraftMinute(currentMinute);
    }
  }

  function adjustSegment(segment, direction) {
    const current = timeToMinutes(value || `${draftHour || "0"}:${draftMinute || "0"}`);
    const nextValue = minutesToTimeValue(wrapTimelineMinutes((current ?? 0) + direction * (segment === "hour" ? 60 : 5)));
    onValueChange(nextValue);
  }

  function handleSegmentKeyDown(event, segment) {
    if (event.key === "ArrowDown" && event.altKey) {
      event.preventDefault();
      setIsMenuOpen(true);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      adjustSegment(segment, event.key === "ArrowUp" ? 1 : -1);
    } else if (event.key === "ArrowRight" && segment === "hour") {
      event.preventDefault();
      minuteRef.current?.focus();
      minuteRef.current?.select();
    } else if (event.key === "ArrowLeft" && segment === "minute") {
      event.preventDefault();
      hourRef.current?.focus();
      hourRef.current?.select();
    }
  }

  function handleWholeTimePaste(event) {
    const normalized = normalizeTimelineTimeInput(event.clipboardData.getData("text"));
    if (!normalized.ok || !normalized.value) return;
    event.preventDefault();
    onValueChange(normalized.value);
  }

  useEffect(() => {
    const bindings = [
      [hourRef.current, (event) => { event.preventDefault(); adjustSegment("hour", event.deltaY < 0 ? 1 : -1); }],
      [minuteRef.current, (event) => { event.preventDefault(); adjustSegment("minute", event.deltaY < 0 ? 1 : -1); }],
    ].filter(([element]) => Boolean(element));
    bindings.forEach(([element, handler]) => element.addEventListener("wheel", handler, { passive: false }));
    return () => bindings.forEach(([element, handler]) => element.removeEventListener("wheel", handler));
  });

  return (
    <OutlinedField
      className={`visit-time-field timeline-segmented-time-field${isMenuOpen ? " menu-open" : ""}`}
      data-name={name}
      fieldRef={rootRef}
      label={label}
    >
        <input name={name} type="hidden" value={value || ""} />
        <div className="timeline-time-segments" role="group" aria-label={`${label}時間`}>
          <input
            aria-label={`${label}小時`}
            className="timeline-time-segment hour"
            disabled={disabled}
            inputMode="numeric"
            maxLength="2"
            placeholder="時"
            ref={hourRef}
            value={draftHour}
            onBlur={(event) => { if (!rootRef.current?.contains(event.relatedTarget)) commitDraft(); }}
            onChange={(event) => {
              const next = event.target.value.replace(/\D/g, "").slice(0, 2);
              draftRef.current.hour = next;
              setDraftHour(next);
            }}
            onClick={(event) => event.currentTarget.select()}
            onKeyDown={(event) => handleSegmentKeyDown(event, "hour")}
            onPaste={handleWholeTimePaste}
          />
          <span className="timeline-time-separator" aria-hidden="true">:</span>
          <input
            aria-label={`${label}分鐘`}
            className="timeline-time-segment minute"
            disabled={disabled}
            inputMode="numeric"
            maxLength="2"
            placeholder="分"
            ref={minuteRef}
            value={draftMinute}
            onBlur={() => commitDraft()}
            onChange={(event) => {
              const next = event.target.value.replace(/\D/g, "").slice(0, 2);
              draftRef.current.minute = next;
              setDraftMinute(next);
            }}
            onClick={(event) => event.currentTarget.select()}
            onKeyDown={(event) => handleSegmentKeyDown(event, "minute")}
            onPaste={handleWholeTimePaste}
          />
        </div>
        <button
          aria-label={`開啟${label}時間選單`}
          aria-expanded={isMenuOpen}
          className="timeline-time-menu-toggle"
          disabled={disabled}
          type="button"
          onClick={() => setIsMenuOpen((current) => !current)}
        >
          <ChevronDown aria-hidden="true" />
        </button>
        {isMenuOpen ? (
          <div className="timeline-time-menu" ref={menuRef} role="listbox" aria-label={`${label}時間選項`}>
            {timelineTimeOptions.map((time) => (
              <button
                aria-selected={time === value}
                className={time === value ? "selected" : ""}
                key={time}
                role="option"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => { onValueChange(time); setIsMenuOpen(false); }}
              >
                {time}
              </button>
            ))}
          </div>
        ) : null}
    </OutlinedField>
  );
}

export function TimelineDurationField({ disabled = false, inputRef, maxMinutes, onCommit, onInputChange, value }) {
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const options = useMemo(() => buildDurationOptions(maxMinutes), [maxMinutes]);
  const selectedMinutes = parseDurationMinutes(value);

  useEffect(() => {
    if (!isMenuOpen) return undefined;
    window.requestAnimationFrame(() => menuRef.current?.querySelector(".selected")?.scrollIntoView({ block: "center" }));
    const closeMenu = (event) => {
      if (!rootRef.current?.contains(event.target)) setIsMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, [isMenuOpen]);

  return (
    <OutlinedField
      className={`visit-time-field duration${isMenuOpen ? " menu-open" : ""}`}
      fieldRef={rootRef}
      label="停留時間"
    >
      <input
        aria-label="停留時間"
        autoComplete="off"
        disabled={disabled}
        inputMode="numeric"
        name="duration_minutes"
        placeholder="分鐘"
        ref={inputRef}
        value={value}
        onBlur={(event) => onCommit(event.target.value)}
        onChange={(event) => onInputChange(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
      />
      <button
        aria-label="開啟停留時間選單"
        aria-expanded={isMenuOpen}
        className="timeline-time-menu-toggle"
        disabled={disabled}
        type="button"
        onClick={() => setIsMenuOpen((current) => !current)}
      >
        <ChevronDown aria-hidden="true" />
      </button>
      {isMenuOpen ? (
        <div className="timeline-time-menu duration-menu" ref={menuRef} role="listbox" aria-label="停留時間選項">
          {options.map((minutes) => {
            const label = formatDurationMinutes(minutes);
            return (
              <button
                aria-selected={minutes === selectedMinutes || label === value}
                className={minutes === selectedMinutes || label === value ? "selected" : ""}
                key={minutes}
                role="option"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => { onCommit(label); setIsMenuOpen(false); }}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
    </OutlinedField>
  );
}

export function TransportDurationField({ onValueChange, value }) {
  const inputRef = useRef(null);
  const [isEditing, setIsEditing] = useState(false);
  const rawValue = String(value ?? "");
  const displayValue = isEditing ? rawValue : formatTransportDurationMinutes(rawValue);

  function adjustDuration(step, showNaturalFormat = false) {
    const current = Number(rawValue);
    const baseMinutes = Number.isInteger(current) && current > 0 ? current : 0;
    setIsEditing(!showNaturalFormat);
    onValueChange(String(Math.max(1, baseMinutes + step)));
  }

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return undefined;
    const handleWheel = (event) => {
      event.preventDefault();
      adjustDuration(event.deltaY < 0 ? 5 : -5, true);
    };
    input.addEventListener("wheel", handleWheel, { passive: false });
    return () => input.removeEventListener("wheel", handleWheel);
  }, [rawValue, onValueChange]);

  return (
    <OutlinedField className="transport-duration-field" label="交通時間">
      <input
        aria-label="交通時間"
        autoComplete="off"
        inputMode="numeric"
        name="transport_duration_minutes"
        placeholder="分鐘"
        ref={inputRef}
        required
        value={displayValue}
        onBlur={() => setIsEditing(false)}
        onChange={(event) => {
          setIsEditing(true);
          onValueChange(event.target.value.replace(/\D/g, ""));
        }}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          adjustDuration(event.key === "ArrowUp" ? 5 : -5);
        }}
      />
    </OutlinedField>
  );
}
