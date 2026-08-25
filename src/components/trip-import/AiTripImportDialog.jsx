import { useMemo, useState } from "react";
import { FileJson2 } from "lucide-react";
import { aiItineraryExchangeModes, buildFormalTripJsonFromAiDraft } from "../../lib/aiItineraryAdapters.js";
import { parseAiItineraryText } from "../../lib/aiItineraryContract.js";
import { buildTripJsonPreview } from "../../lib/tripJsonContract.js";

function uniqueIssues(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.path}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function importErrorMessage(error) {
  if (typeof error === "string" && error.trim()) return error;
  if (typeof error?.message === "string" && error.message.trim()) return error.message;
  return "AI 行程匯入失敗，資料未建立。";
}

function hasUsableCoordinates(location) {
  const latitude = location?.latitude;
  const longitude = location?.longitude;
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180
    && !(latitude === 0 && longitude === 0);
}

function countMissingCoordinates(document) {
  return (document?.days || []).reduce(
    (total, day) => total + (day?.visits || []).filter((visit) => !hasUsableCoordinates(visit.location)).length,
    0,
  );
}

export default function AiTripImportDialog({ mode = aiItineraryExchangeModes.create, onClose, onImport }) {
  const [rawText, setRawText] = useState("");
  const [stage, setStage] = useState("input");
  const [parseResult, setParseResult] = useState(null);
  const [busyKey, setBusyKey] = useState("");
  const [importError, setImportError] = useState("");
  const [lateErrors, setLateErrors] = useState([]);
  const isRevisionCopy = mode === aiItineraryExchangeModes.reviseCopy;

  const adapterResult = useMemo(
    () => parseResult?.document ? buildFormalTripJsonFromAiDraft(parseResult.document) : null,
    [parseResult],
  );
  const blockingIssues = uniqueIssues([
    ...(parseResult?.errors || []),
    ...(adapterResult?.errors || []),
    ...lateErrors,
    ...(importError ? [{ code: "import_failed", path: "$", message: importError }] : []),
  ]);
  const warnings = uniqueIssues([...(parseResult?.warnings || []), ...(adapterResult?.warnings || [])]);
  const hasBlockingError = blockingIssues.length > 0;
  const preview = adapterResult?.document
    ? buildTripJsonPreview(adapterResult.document, { errors: blockingIssues, warnings })
    : buildTripJsonPreview(null, { errors: blockingIssues, warnings });
  const missingCoordinateCount = countMissingCoordinates(adapterResult?.document);
  const canConfirm = Boolean(stage === "preview" && parseResult?.document && adapterResult?.document && !hasBlockingError && !busyKey);

  function parseAndPreview(text = rawText) {
    setImportError("");
    setLateErrors([]);
    setBusyKey("");
    setParseResult(parseAiItineraryText(text));
    setStage("preview");
  }

  async function readImportFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      setRawText(text);
      parseAndPreview(text);
    } catch {
      setBusyKey("");
      setImportError("");
      setLateErrors([]);
      setParseResult({ errors: [{ code: "file_read_failed", path: "$", message: "無法讀取這個 JSON 檔案。" }], ok: false, warnings: [] });
      setStage("preview");
    }
  }

  async function confirmImport() {
    if (!canConfirm) return;
    const finalResult = buildFormalTripJsonFromAiDraft(parseResult.document);
    if (!finalResult.ok || !finalResult.document) {
      setLateErrors(finalResult.errors || []);
      return;
    }
    setBusyKey("import");
    setImportError("");
    try {
      const result = await onImport(finalResult.document);
      if (result?.ok) {
        onClose();
        return;
      }
      setImportError(importErrorMessage(result?.error));
    } catch (error) {
      setImportError(importErrorMessage(error));
    } finally {
      setBusyKey("");
    }
  }

  if (stage === "input") {
    return (
      <div className="modal-backdrop">
        <section aria-labelledby="ai-import-title" className="dialog-card ai-import-dialog ai-import-input-step">
          <div className="ai-import-heading">
            <span aria-hidden="true"><FileJson2 size={20} /></span>
            <div>
              <h2 id="ai-import-title">貼上 AI 行程</h2>
              <p>{isRevisionCopy ? "貼上 AI 調整後的 JSON；匯入後建立新旅程，原旅程不變。" : "貼上 AI 完成的 JSON，解析後預覽。"}</p>
            </div>
          </div>
          <label className="ai-import-text-field">
            <span>AI 回覆</span>
            <textarea
              autoFocus
              placeholder={'貼上 document_type 為 "travel_studio_ai_itinerary" 的 JSON'}
              rows={16}
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
            />
          </label>
          <div className="ai-import-input-note">旅程工房只讀取交換格式，不會將內容傳送給任何 AI 服務。</div>
          <div className="form-actions">
            <label className="ghost-button trip-json-file-button">
              選擇 JSON 檔案
              <input
                accept="application/json,.json"
                aria-label="選擇 AI 行程 JSON 檔案"
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  void readImportFile(file);
                }}
              />
            </label>
            <button className="ghost-button" type="button" onClick={onClose}>取消</button>
            <button className="primary-button compact" disabled={!rawText.trim()} type="button" onClick={() => parseAndPreview()}>解析並預覽</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="modal-backdrop">
      <section
        aria-labelledby="ai-import-preview-title"
        className={`dialog-card ai-import-dialog ai-import-preview-step${hasBlockingError ? " has-blocking-error" : ""}`}
      >
        <div className="ai-import-preview-heading">
          <div>
            <h2 id="ai-import-preview-title">AI 行程匯入預覽</h2>
            {!hasBlockingError ? <p>{isRevisionCopy ? "確認調整內容；匯入後建立新旅程，原旅程不變。" : "確認行程內容後匯入。"}</p> : null}
          </div>
        </div>

        {hasBlockingError ? (
          <div className="trip-import-blocking-error" role="alert">
            <strong>無法匯入這份 AI 行程</strong>
            <details>
              <summary>查看細節（{blockingIssues.length}）</summary>
              <ul>
                {blockingIssues.slice(0, 20).map((issue, index) => (
                  <li key={`${issue.path}-${issue.code}-${index}`}><span>{issue.message}</span><code>{issue.path}</code></li>
                ))}
              </ul>
            </details>
          </div>
        ) : null}

        {!hasBlockingError && (missingCoordinateCount || warnings.length) ? (
          <div className="trip-import-issues warning" role="status">
            <strong>匯入提醒</strong>
            <ul>
              {missingCoordinateCount ? <li>尚有 {missingCoordinateCount} 個目的地缺少可用座標</li> : null}
              {warnings.slice(0, 20).map((issue, index) => <li key={`${issue.path}-${issue.code}-${index}`}>{issue.message}</li>)}
            </ul>
          </div>
        ) : null}

        <div className="ai-import-preview-footer">
          {!hasBlockingError ? (
            <div className="trip-import-counts" aria-label={`${preview.counts.days || 0} 天，行程 ${preview.counts.visits || 0}，交通 ${preview.counts.transports || 0}，備案 ${preview.counts.alternatives || 0}`}>
              <span><strong>{preview.counts.days || 0}</strong> 天</span>
              <span>行程 <strong>{preview.counts.visits || 0}</strong></span>
              <span>交通 <strong>{preview.counts.transports || 0}</strong></span>
              <span>備案 <strong>{preview.counts.alternatives || 0}</strong></span>
            </div>
          ) : null}
          <div className="form-actions">
            <button className="ghost-button" disabled={busyKey === "import"} type="button" onClick={() => {
              setStage("input");
              setImportError("");
              setLateErrors([]);
            }}>返回編輯</button>
            <button className="ghost-button" disabled={busyKey === "import"} type="button" onClick={onClose}>取消</button>
            {!hasBlockingError ? (
              <button className="primary-button compact" disabled={!canConfirm} type="button" onClick={() => void confirmImport()}>
                {busyKey === "import" ? "匯入中…" : "確認匯入"}
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
