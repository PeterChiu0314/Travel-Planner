import { notify } from "../../lib/notifications.js";
import { supabase } from "../../lib/supabase.js";
import { buildTripImportPersistencePayload, serializeTripToJson } from "../../lib/tripJsonAdapters.js";
import { buildTripJsonPreview } from "../../lib/tripJsonContract.js";
import { parseUnifiedTripJsonText } from "../../lib/unifiedTripJsonImport.js";
import { aiItineraryBlankTemplateFileName, aiItineraryExchangeModes, buildBlankAiItineraryTemplate, serializeTripToAiItinerary } from "../../lib/aiItineraryAdapters.js";
import { timelineItemsInTripRange } from "../../components/trip/tripDateChange.js";

export function createExchangeCommands({
  setActiveDay,
  items,
  alternatives,
  setIsTripDialogOpen,
  tripImportState,
  setTripImportState,
  setAiExchangeState,
  activeTrip,
  loadTrips,
}) {
  async function previewTripImport(file) {
    if (!file) return;
    let text;
    try {
      text = await file.text();
    } catch {
      const preview = buildTripJsonPreview(null, {
        errors: [{
          code: "file_read_failed",
          message: "無法讀取這個 JSON 檔案，請確認檔案後再試一次。",
          path: "$",
        }],
        fileName: file.name,
      });
      setIsTripDialogOpen(false);
      setAiExchangeState(null);
      setTripImportState({ busy: false, document: null, error: "", preview });
      return;
    }
    const parsed = parseUnifiedTripJsonText(text);
    const preview = {
      ...buildTripJsonPreview(parsed.document, {
        errors: parsed.errors || [],
        fileName: file.name,
        migrations: parsed.migrations || [],
        warnings: parsed.warnings || [],
      }),
      sourceDocumentType: parsed.sourceDocumentType,
    };
    setIsTripDialogOpen(false);
    setAiExchangeState(null);
    setTripImportState({ busy: false, document: parsed.document || null, error: "", preview });
  }

  async function confirmTripImport() {
    if (!tripImportState?.document || tripImportState.preview?.errors?.length || tripImportState.busy) return;
    const persistence = buildTripImportPersistencePayload(tripImportState.document);
    if (!persistence.ok || !persistence.payload) {
      setTripImportState((current) => ({
        ...current,
        error: persistence.errors?.[0]?.message || "無法建立匯入資料，請重新檢查 JSON 檔案。",
      }));
      return;
    }
    setTripImportState((current) => ({ ...current, busy: true, error: "" }));
    const { data, error } = await supabase.rpc("import_trip_timeline_v1", { payload: persistence.payload });
    if (error || !data?.trip_id) {
      setTripImportState((current) => ({
        ...current,
        busy: false,
        error: error?.message || "匯入沒有回傳新旅程 ID，資料未建立。",
      }));
      return;
    }
    const importedTitle = tripImportState.document.trip.title;
    setTripImportState(null);
    setActiveDay(0);
    notify.success(`已匯入「${importedTitle}」。`);
    await loadTrips(data.trip_id);
  }

  function exportTrip() {
    if (!activeTrip) return;
    const exportedItems = timelineItemsInTripRange(items, activeTrip);
    const result = serializeTripToJson({ alternatives, items: exportedItems, trip: activeTrip });
    if (!result.ok) {
      notify.error(result.errors?.[0]?.message || "旅程資料不符合 JSON 匯出契約，未建立檔案。");
      return;
    }
    const blob = new Blob([result.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = result.fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  function openAiTripRevisionExchange() {
    if (!activeTrip) return;
    const exportedItems = timelineItemsInTripRange(items, activeTrip);
    const result = serializeTripToAiItinerary({ alternatives, items: exportedItems, trip: activeTrip });
    if (!result.ok) {
      notify.error(result.errors?.[0]?.message || "旅程資料不符合 AI 交換契約，無法建立交換資料。");
      return;
    }
    setAiExchangeState({ document: result.document, fileName: result.fileName, mode: aiItineraryExchangeModes.reviseCopy });
  }

  function openAiTripCreateExchange() {
    setIsTripDialogOpen(false);
    setAiExchangeState({
      document: buildBlankAiItineraryTemplate(),
      fileName: aiItineraryBlankTemplateFileName,
      mode: aiItineraryExchangeModes.create,
    });
  }

  function returnFromAiTripCreateExchange() {
    setAiExchangeState(null);
    setIsTripDialogOpen(true);
  }

  return {
    previewTripImport,
    confirmTripImport,
    exportTrip,
    openAiTripRevisionExchange,
    openAiTripCreateExchange,
    returnFromAiTripCreateExchange,
  };
}
