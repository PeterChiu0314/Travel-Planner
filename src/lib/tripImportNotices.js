const draftNoticeCodes = new Set(["untimed_visit", "duration_without_anchor", "suspended_transport"]);
const routineNoticeCodes = new Set(["untimed_alternative", "duration_auto_scheduled"]);

export function buildTripImportNotices(issues = []) {
  const reminders = new Set();
  const timeConflicts = new Set();
  const hasCoordinateSummary = issues.some((issue) => issue.code === "missing_coordinates");
  let hasDraftTimes = false;

  for (const issue of issues) {
    if (draftNoticeCodes.has(issue.code)) {
      hasDraftTimes = true;
    } else if (routineNoticeCodes.has(issue.code)) {
      continue;
    } else if (issue.code === "duration_schedule_conflict") {
      timeConflicts.add(issue.path || issue.message);
    } else if (issue.code === "missing_coordinates") {
      const count = issue.message?.match(/尚有\s*(\d+)\s*個/)?.[1];
      reminders.add(count
        ? `尚有 ${count} 個目的地缺少可用座標，可在匯入後補上位置。`
        : "部分目的地尚未設定位置，可在匯入後補上。");
    } else if (issue.code === "missing_location" || issue.code === "missing_alternative_location") {
      if (!hasCoordinateSummary) reminders.add("部分目的地尚未設定位置，可在匯入後補上。");
    } else if (issue.code === "empty_timeline") {
      reminders.add("這份檔案尚未安排任何行程，匯入後會建立空白旅程。");
    } else if (issue.code === "settled_trip") {
      reminders.add("這份旅程已結算，匯入後會保留結算狀態，內容將鎖定。");
    } else if (issue.message) {
      // Preserve new warning types rather than silently hiding them.
      reminders.add(issue.message.trim());
    }
  }

  if (timeConflicts.size) {
    reminders.add(`有 ${timeConflicts.size} 個行程的時間安排不下，已保留內容並暫不設定時間，可在匯入後調整。`);
  }

  return {
    draftNote: hasDraftTimes ? "部分行程尚未設定時間，匯入後可再安排；行程與交通都會保留。" : "",
    reminders: [...reminders],
  };
}
