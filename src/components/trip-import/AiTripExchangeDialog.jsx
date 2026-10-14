import { useState } from "react";
import { Bot, Clipboard, Download } from "lucide-react";
import {
  aiItineraryExchangeModes,
  buildAiItineraryCreatePrompt,
  buildAiItineraryUsageInstructions,
} from "../../lib/aiItineraryAdapters.js";
import { stringifyAiItineraryDocument } from "../../lib/aiItineraryContract.js";

async function copyText(value) {
  if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
  await navigator.clipboard.writeText(value);
}

export default function AiTripExchangeDialog({ document, fileName, mode = aiItineraryExchangeModes.reviseCopy, onBack, onClose, onImportFile }) {
  const [status, setStatus] = useState("");
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const isCreateMode = mode === aiItineraryExchangeModes.create;
  const instructions = isCreateMode ? buildAiItineraryCreatePrompt() : buildAiItineraryUsageInstructions(document);
  const json = stringifyAiItineraryDocument(document);
  const title = isCreateMode ? "AI 規劃" : "給 AI 調整";
  const description = isCreateMode
    ? "使用你慣用的 AI 規劃，再將行程帶回旅程工房。"
    : "把目前旅程交給 AI 調整；匯入後建立新旅程，原旅程不變。";

  async function handleCopy(value, successMessage) {
    try {
      await copyText(value);
      setStatus(successMessage);
    } catch {
      setInstructionsOpen(true);
      setStatus("瀏覽器無法存取剪貼簿，請手動選取內容複製。");
    }
  }

  function downloadJson() {
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = fileName;
    window.document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(isCreateMode ? "模板 JSON 已準備下載。" : "旅程 JSON 已準備下載。");
  }

  const preparation = (
    <>
      <div className="ai-exchange-primary-actions">
        <button className="primary-button compact" type="button" onClick={downloadJson}>
          <Download size={16} aria-hidden="true" />
          {isCreateMode ? "下載模板 JSON" : "下載旅程 JSON"}
        </button>
        <button className="ghost-button compact" type="button" onClick={() => void handleCopy(instructions, "給 AI 的提示詞已複製。") }>
          <Clipboard size={16} aria-hidden="true" />
          複製給 AI 的提示詞
        </button>
      </div>

      <details className="ai-exchange-prompt-details" open={instructionsOpen} onToggle={(event) => setInstructionsOpen(event.currentTarget.open)}>
        <summary>查看給 AI 的提示詞</summary>
        <label className="ai-exchange-field">
          <textarea aria-label="給 AI 的提示詞" readOnly rows={8} value={instructions} onFocus={(event) => event.currentTarget.select()} />
        </label>
      </details>

      {status ? <div className="ai-exchange-status" role="status">{status}</div> : null}
    </>
  );

  return (
    <div className="modal-backdrop">
      <section aria-describedby="ai-exchange-description" aria-labelledby="ai-exchange-title" aria-modal="true" className={`dialog-card ai-exchange-dialog${isCreateMode ? " ai-planning-dialog" : ""}`} role="dialog">
        <div className="ai-exchange-heading">
          <span className="ai-exchange-icon" aria-hidden="true"><Bot size={20} /></span>
          <div>
            <h2 id="ai-exchange-title">{title}</h2>
            <p id="ai-exchange-description">{description}</p>
          </div>
        </div>

        {isCreateMode ? (
          <ol className="ai-planning-steps" aria-label="AI 規劃步驟">
            <li className="ai-planning-step">
              <span className="ai-planning-step-number" aria-hidden="true">1</span>
              <div className="ai-planning-step-content">
                <h3>準備給 AI 的資料</h3>
                <p>下載模板並複製提示詞，兩項都要交給 AI。</p>
                {preparation}
              </div>
            </li>
            <li className="ai-planning-step">
              <span className="ai-planning-step-number" aria-hidden="true">2</span>
              <div className="ai-planning-step-content">
                <h3>交給 AI 規劃</h3>
                <p>在 ChatGPT、Gemini 等 AI 對話中，上傳模板檔案、貼上提示詞，並說明旅遊需求。</p>
                <p>已經討論好的行程，也可以請 AI 依模板整理。</p>
                <p className="ai-planning-example">例如：北海道七天，兩位成人，不自駕，步調輕鬆。</p>
              </div>
            </li>
            <li className="ai-planning-step">
              <span className="ai-planning-step-number" aria-hidden="true">3</span>
              <div className="ai-planning-step-content">
                <h3>把行程帶回來</h3>
                <p>下載 AI 完成的行程 JSON 檔。</p>
                <p>按「返回」後，在「新增旅程」選擇「匯入」，預覽後確認匯入。</p>
              </div>
            </li>
          </ol>
        ) : (
          <>
            <div className="ai-exchange-flow" aria-label="AI 行程交換流程">
              <span>下載旅程</span><i aria-hidden="true">→</i><span>檔案＋提示詞交給 AI</span><i aria-hidden="true">→</i><span>匯入 JSON</span>
            </div>
            {preparation}
          </>
        )}

        <div className="form-actions">
          <button className="ghost-button" type="button" onClick={onClose}>關閉</button>
          {isCreateMode ? (
            <button className="primary-button compact" type="button" onClick={onBack || onClose}>返回</button>
          ) : (
            <label className="primary-button compact trip-json-file-button">
              匯入 JSON
              <input
                accept="application/json,.json"
                aria-label="選擇行程 JSON 檔案"
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  void onImportFile(file);
                }}
              />
            </label>
          )}
        </div>
      </section>
    </div>
  );
}
