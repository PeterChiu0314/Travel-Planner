import { requestWorkspaceConfirmation } from "../../app/activeEditorGuard.jsx";
import { memberName } from "../../lib/memberName.js";
import { notify } from "../../lib/notifications.js";
import { luggageErrorMessage } from "../../lib/luggageService.js";
import { supabase } from "../../lib/supabase.js";

export function createMemberCommands({
  session,
  members,
  activeTrip,
  isTripDateLocked,
  canInviteMembers,
  requestGuard,
  tripDataContext,
  loadTripData,
}) {
  async function approveMember(memberId) {
    if (!activeTrip || !canInviteMembers) return;
    const { error } = await supabase
      .from("trip_members")
      .update({ status: "approved" })
      .eq("id", memberId)
      .eq("trip_id", activeTrip.id);
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function rejectMember(memberId) {
    if (!activeTrip || !canInviteMembers) return;
    const { error } = await supabase.from("trip_members").delete().eq("id", memberId).eq("trip_id", activeTrip.id);
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function createMemberInviteToken() {
    if (!activeTrip || !canInviteMembers) {
      const message = isTripDateLocked
        ? "旅程已進入結算階段，無法邀請或管理成員。"
        : "You do not have permission to invite members.";
      notify.error(message);
      return { ok: false, message };
    }
    const token = crypto.randomUUID();
    const { error } = await supabase.from("trip_invites").insert({
      trip_id: activeTrip.id,
      token,
    });
    if (error) {
      notify.error(error.message);
      return { ok: false, error, message: error.message };
    }
    return { ok: true, token };
  }

  async function updateMemberRole(memberId, nextRole) {
    if (!activeTrip || !canInviteMembers) return { ok: false };
    if (!["editor", "viewer"].includes(nextRole)) return { ok: false };
    const targetMember = members.find((member) => member.id === memberId);
    if (
      !targetMember ||
      targetMember.trip_id !== activeTrip.id ||
      targetMember.status !== "approved" ||
      targetMember.role === "owner"
    ) {
      return { ok: false };
    }
    if (targetMember.user_id === session?.user?.id) return { ok: false };
    const { error } = await supabase
      .from("trip_members")
      .update({ role: nextRole })
      .eq("id", memberId)
      .eq("trip_id", activeTrip.id);
    if (error) {
      notify.error(error.message);
      return { ok: false, error };
    }
    await loadTripData(activeTrip.id);
    return { ok: true };
  }

  async function removeMember(memberId) {
    if (!activeTrip || !canInviteMembers) return { ok: false };
    const targetMember = members.find((member) => member.id === memberId);
    if (
      !targetMember ||
      targetMember.trip_id !== activeTrip.id ||
      targetMember.role === "owner" ||
      targetMember.user_id === session?.user?.id
    ) {
      return { ok: false };
    }
    const confirmed = await requestWorkspaceConfirmation({
      title: `移除「${memberName(targetMember)}」？`,
      confirmLabel: "確認移除",
    });
    if (!confirmed || !requestGuard.sameContext(tripDataContext)) return { ok: false, cancelled: true };
    const { error } = await supabase.from("trip_members").delete().eq("id", memberId).eq("trip_id", activeTrip.id);
    if (error) {
      notify.error(error.code === '55P03' ? '目前有支出或旅程資料正在更新，請稍後再移除成員。' : luggageErrorMessage(error));
      return { ok: false, error };
    }
    await loadTripData(activeTrip.id);
    return { ok: true };
  }

  return {
    approveMember,
    rejectMember,
    createMemberInviteToken,
    updateMemberRole,
    removeMember,
  };
}

export function readMembers(client, tripId) {
  return client.from("trip_members").select("id,trip_id,user_id,role,status,created_at,display_name,email").eq("trip_id", tripId).order("created_at");
}
