import { budgetReceiptsDisabled, budgetReceiptUnavailableMessage, isBudgetReceiptTarget } from "../../lib/budgetReceiptConfig.js";
import { notify } from "../../lib/notifications.js";
import { supabase } from "../../lib/supabase.js";
import { attachmentBucket, safeFileName } from "./attachmentFiles.js";

export function createAttachmentCommands({
    session,
    activeTrip,
    refreshBudget,
    canEdit,
    canEditActiveTripContent,
    loadTripData,
  }) {
  async function uploadAttachment(targetType, targetId, file, meta = {}) {
    if (budgetReceiptsDisabled && isBudgetReceiptTarget(targetType)) return { ok: false, error: new Error(budgetReceiptUnavailableMessage) };
    if (!activeTrip || !(targetType === "actual_expense" ? canEdit : canEditActiveTripContent) || !file) return;
    if (file.size > 10 * 1024 * 1024) {
      const error = new Error("附件大小需小於 10MB");
      if (!meta.leaseProtocol) notify.error(error);
      return { ok: false, error };
    }
    const fileName = safeFileName(file.name) || `attachment-${Date.now()}`;
    const path = `trips/${activeTrip.id}/attachments/${targetType}/${targetId}/${Date.now()}-${fileName}`;
    const uploadResult = await supabase.storage.from(attachmentBucket).upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (uploadResult.error) {
      if (!meta.leaseProtocol) notify.error(uploadResult.error);
      return { ok: false, error: uploadResult.error };
    }
    const receipt = {
      trip_id: activeTrip.id,
      target_type: targetType,
      target_id: targetId,
      file_name: file.name,
      file_url: path,
      file_type: file.type || null,
      file_size: file.size,
      uploaded_by: session.user.id,
    };
    const { error } = meta.leaseProtocol ? await supabase.rpc("mutate_budget_receipt", {
      p_trip_id: activeTrip.id, p_actual_id: targetId, p_action: "insert", p_receipt: receipt,
      p_edit_session_id: meta.editLease?.sessionId, p_edit_token: meta.editLease?.token,
    }) : await supabase.from("attachments").insert(receipt);
    if (error) {
      if (meta.leaseProtocol) await supabase.storage.from(attachmentBucket).remove([path]);
      if (!meta.leaseProtocol) notify.error(error);
      return { ok: false, error };
    }
    if (meta.leaseProtocol) await refreshBudget(activeTrip.id); else await loadTripData(activeTrip.id);
    return { ok: true };
  }

  async function openAttachment(attachment) {
    if (budgetReceiptsDisabled && isBudgetReceiptTarget(attachment.target_type)) { notify.warning(budgetReceiptUnavailableMessage); return; }
    const { data, error } = await supabase.storage.from(attachmentBucket).createSignedUrl(attachment.file_url, 600);
    if (error) {
      notify.error(error.message);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function deleteAttachment(attachment, meta = {}) {
    if (budgetReceiptsDisabled && isBudgetReceiptTarget(attachment.target_type)) return { ok: false, error: new Error(budgetReceiptUnavailableMessage) };
    if (!activeTrip || !(attachment.target_type === "actual_expense" ? canEdit : canEditActiveTripContent)) return;
    const storageResult = await supabase.storage.from(attachmentBucket).remove([attachment.file_url]);
    if (storageResult.error) {
      notify.error(storageResult.error.message);
      return;
    }
    const { error } = await supabase.from("attachments").delete().eq("id", attachment.id);
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  return { uploadAttachment, openAttachment, deleteAttachment };
}

export function readAttachments(client, tripId) {
  return client.from("attachments").select("*").eq("trip_id", tripId).order("created_at");
}
