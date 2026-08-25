import { useState } from "react";
import { Bot, Clipboard, Download, FileJson2 } from "lucide-react";
import {
  aiItineraryExchangeModes,
  buildAiItineraryClipboardText,
  buildAiItineraryCreatePrompt,
  buildAiItineraryUsageInstructions,
} from "../../lib/aiItineraryAdapters.js";
import { stringifyAiItineraryDocument } from "../../lib/aiItineraryContract.js";

async function copyText(value) {
  if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
  await navigator.clipboard.writeText(value);
}

export default function AiTripExchangeDialog({ document, fileName, mode = aiItineraryExchangeModes.reviseCopy, onClose, onOpenImport }) {
  const [status, setStatus] = useState("");
  const isCreateMode = mode === aiItineraryExchangeModes.create;
  const instructions = isCreateMode ? buildAiItineraryCreatePrompt() : buildAiItineraryUsageInstructions(document);
  const json = stringifyAiItineraryDocument(document);
  const title = isCreateMode ? "AI 規劃" : "給 AI 調整";
  const description = isCreateMode
    ? "下載模板，交給 AI 規劃後貼回。"
    : "把目前旅程交給 AI 調整；貼回後建立新旅程，原旅程不變。";

  async function handleCopy(value, successMessage) {
    try {
      await copyText(value);
      setStatus(successMessage);
    } catch {
      setStatus("瀏覽器無法存取剪貼簿，請手動選取內容複製。");
    }
  }

  function downloadJson() {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(isCreateMode ? "模板 JSON 已下載。" : "AI JSON 已下載。");
  }

  return (
    <div className="modal-backdrop">
      <section aria-describedby="ai-exchange-description" aria-labelledby="ai-exchange-title" className="dialog-card ai-exchange-dialog">
        <div className="ai-exchange-heading">
          <span className="ai-exchange-icon" aria-hidden="true"><Bot size={20} /></span>
          <div>
            <h2 id="ai-exchange-title">{title}</h2>
            <p id="ai-exchange-description">{description}</p>
          </div>
        </div>

        <div className="ai-exchange-flow" aria-label="AI 行程交換流程">
          <span>{isCreateMode ? "下載模板" : "複製資料"}</span><i aria-hidden="true">→</i><span>交給外部 AI</span><i aria-hidden="true">→</i><span>貼回匯入</span>
        </div>

        <label className="ai-exchange-field">
          <span>給 AI 的提示詞</span>
          <textarea readOnly rows={8} value={instructions} onFocus={(event) => event.currentTarget.select()} />
        </label>
        {!isCreateMode ? (
          <details className="ai-exchange-json-details">
            <summary>查看 AI JSON</summary>
            <textarea aria-label="AI 行程 JSON" readOnly rows={10} value={json} onFocus={(event) => event.currentTarget.select()} />
          </details>
        ) : null}

        {status ? <div className="ai-exchange-status" role="status">{status}</div> : null}

        <div className="ai-exchange-primary-actions">
          {isCreateMode ? (
            <>
              <button className="primary-button compact" type="button" onClick={downloadJson}>
                <Download size={16} aria-hidden="true" />
                下載模板 JSON
              </button>
              <button className="ghost-button compact" type="button" onClick={() => void handleCopy(instructions, "給 AI 的提示詞已複製。") }>
                <Clipboard size={16} aria-hidden="true" />
                複製給 AI 的提示詞
              </button>
            </>
          ) : (
            <>
              <button className="primary-button compact" type="button" onClick={() => void handleCopy(buildAiItineraryClipboardText(document), "給 AI 的提示詞與目前旅程 JSON 已複製。") }>
                <Clipboard size={16} aria-hidden="true" />
                複製給 AI
              </button>
              <button className="ghost-button compact" type="button" onClick={() => void handleCopy(json, "AI JSON 已複製。") }>
                <FileJson2 size={16} aria-hidden="true" />
                只複製 JSON
              </button>
              <button className="ghost-button compact" type="button" onClick={downloadJson}>
                <Download size={16} aria-hidden="true" />
                下載 JSON
              </button>
            </>
          )}
        </div>

        <div className="form-actions">
          <button className="ghost-button" type="button" onClick={onClose}>關閉</button>
          <button className="primary-button compact" type="button" onClick={onOpenImport}>貼上 AI 回覆</button>
        </div>
      </section>
    </div>
  );
}
