import { useEffect, useState } from "react";
import { memberInitial, memberName, memberRoleLabel } from "../../lib/memberName.js";

export default function MembersInviteDialog({
  canManageMembers,
  currentRole,
  currentUserId,
  isTripDateLocked,
  members,
  onApprove,
  onClose,
  onCreateInvite,
  onReadInvite,
  trip,
  onReject,
  onRemoveMember,
  onUpdateRole,
}) {
  const [invite, setInvite] = useState(null);
  const [readAttempt, setReadAttempt] = useState(0);
  const [readFailed, setReadFailed] = useState(false);
  const tripId = trip?.id;
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(canManageMembers);
  const [openRoleMenuMemberId, setOpenRoleMenuMemberId] = useState(null);
  const approvedMembers = members.filter((member) => member.status === "approved");
  const pendingMembers = canManageMembers ? members.filter((member) => member.status === "pending") : [];
  const hasOnlyOneApprovedMember = approvedMembers.length === 1;

  useEffect(() => {
    if (!openRoleMenuMemberId) return undefined;

    function closeRoleMenuOnOutsideClick(event) {
      if (event.target instanceof Element && event.target.closest(".member-role-menu")) return;
      setOpenRoleMenuMemberId(null);
    }

    function closeRoleMenuOnEscape(event) {
      if (event.key === "Escape") {
        setOpenRoleMenuMemberId(null);
      }
    }

    document.addEventListener("pointerdown", closeRoleMenuOnOutsideClick);
    document.addEventListener("keydown", closeRoleMenuOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeRoleMenuOnOutsideClick);
      document.removeEventListener("keydown", closeRoleMenuOnEscape);
    };
  }, [openRoleMenuMemberId]);

  function chooseMemberRole(member, nextRole) {
    setOpenRoleMenuMemberId(null);
    if (member.role !== nextRole) {
      onUpdateRole(member.id, nextRole);
    }
  }

  function removeMemberFromMenu(member) {
    setOpenRoleMenuMemberId(null);
    onRemoveMember(member.id);
  }

  useEffect(() => {
    if (!canManageMembers) return;
    let active = true;
    setBusy(true);
    setReadFailed(false);
    setError("");
    onReadInvite(tripId).then((current) => {
      if (active) setInvite(current);
    }).catch(() => {
      if (active) {
        setReadFailed(true);
        setError("無法讀取邀請連結。");
      }
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [canManageMembers, tripId, onReadInvite, readAttempt]);

  useEffect(() => {
    if (!invite) return;
    const timeout = setTimeout(() => {
      setInvite(null);
      setCopied(false);
      setBusy(true);
      setReadAttempt((value) => value + 1);
    }, Date.parse(invite.expires_at) - Date.parse(invite.server_time));
    return () => clearTimeout(timeout);
  }, [invite]);

  async function createInvite() {
    if (!canManageMembers || busy) return;
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      setInvite(await onCreateInvite(invite?.token));
    } catch {
      setInvite(null);
      setReadFailed(true);
      setError("無法確認邀請連結，請重新讀取。");
    } finally {
      setBusy(false);
    }
  }

  const inviteUrl = invite ? `${window.location.origin}?invite=${invite.token}` : "";
  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setError("");
    } catch {
      setError("無法複製邀請連結，請手動複製網址。");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="dialog-card members-dialog" onClick={(event) => event.stopPropagation()}>
        <h2>成員與邀請</h2>
        {isTripDateLocked ? (
          <div className="notice">旅程已進入結算階段，無法邀請或管理成員。</div>
        ) : null}
        {error ? <div className="notice danger">{error}</div> : null}

        <section className="members-dialog-section">
          <div className="panel-heading tight">
            <div>
              <p className="eyebrow">Members</p>
              <h3>目前成員</h3>
            </div>
            <span className="pill">{approvedMembers.length} 位</span>
          </div>
          <div className="member-list">
            {approvedMembers.map((member) => {
              const canEditRole = canManageMembers && member.role !== "owner" && member.user_id !== currentUserId;
              return (
                <div className="member-row detailed" key={member.id || member.user_id || member.email}>
                  <span className="member-avatar">{memberInitial(member)}</span>
                  <div>
                    <strong>{memberName(member)}</strong>
                    <span className="member-email">{member.email || member.user_id}</span>
                  </div>
                  <div className="member-actions">
                    {canEditRole ? (
                      <div className="member-role-menu">
                        <button
                          className="member-role-pill member-role-menu-trigger"
                          type="button"
                          aria-haspopup="menu"
                          aria-expanded={openRoleMenuMemberId === member.id}
                          aria-label={`${memberName(member)} 角色操作`}
                          onClick={() =>
                            setOpenRoleMenuMemberId((currentMemberId) => (currentMemberId === member.id ? null : member.id))
                          }
                        >
                          {memberRoleLabel(member.role)}
                          <span className="member-role-menu-caret" aria-hidden="true">
                            ▾
                          </span>
                        </button>
                        {openRoleMenuMemberId === member.id ? (
                          <div className="member-role-menu-popover" role="menu">
                            {["editor", "viewer"].map((role) => (
                              <button
                                className={`member-role-menu-item${member.role === role ? " active" : ""}`}
                                type="button"
                                role="menuitemradio"
                                aria-checked={member.role === role}
                                key={role}
                                onClick={() => chooseMemberRole(member, role)}
                              >
                                <span className="member-role-menu-check" aria-hidden="true">
                                  {member.role === role ? "✓" : ""}
                                </span>
                                {memberRoleLabel(role)}
                              </button>
                            ))}
                            <div className="member-role-menu-separator" />
                            <button
                              className="member-role-menu-item danger"
                              type="button"
                              role="menuitem"
                              onClick={() => removeMemberFromMenu(member)}
                            >
                              <span className="member-role-menu-check" aria-hidden="true" />
                              移除成員
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <span className="member-role-pill">{memberRoleLabel(member.role)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {pendingMembers.length ? (
          <section className="members-dialog-section">
            <div className="panel-heading tight">
              <div>
                <p className="eyebrow">Pending</p>
                <h3>待審核</h3>
              </div>
              <span className="pill">{pendingMembers.length} 位</span>
            </div>
            <div className="member-list">
              {pendingMembers.map((member) => (
                <div className="member-row detailed" key={member.id || member.user_id || member.email}>
                  <span className="member-avatar">{memberInitial(member)}</span>
                  <div>
                    <strong>{memberName(member)}</strong>
                    <span className="member-email">{member.email || member.user_id}</span>
                  </div>
                  <div className="member-actions">
                    <button className="mini-button" type="button" onClick={() => onApprove(member.id)}>
                      核准
                    </button>
                    <button className="mini-button" type="button" onClick={() => onReject(member.id)}>
                      拒絕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="members-dialog-section">
          <div className="panel-heading tight">
            <div>
              <p className="eyebrow">Invite</p>
              <h3>邀請成員</h3>
            </div>
          </div>
          <p>{hasOnlyOneApprovedMember ? "邀請朋友一起規劃這趟旅程。" : "朋友使用連結登入後會送出加入申請，核准後即可共同編輯。"}</p>
          {inviteUrl ? (
            <>
              <input aria-label="有效邀請連結" readOnly value={inviteUrl} />
              <p>有效至 <time dateTime={invite.expires_at}>{new Date(invite.expires_at).toLocaleString("zh-TW")}</time></p>
              <button className="primary-button compact" type="button" disabled={busy} onClick={copyInvite}>複製連結</button>
            </>
          ) : null}
          {copied ? <div className="notice">邀請連結已複製。</div> : null}
          {readFailed ? (
            <button className="ghost-button" type="button" onClick={() => setReadAttempt((value) => value + 1)}>重新讀取</button>
          ) : (
            <button className={invite ? "ghost-button" : "primary-button compact"} type="button" disabled={!canManageMembers || busy} onClick={createInvite}>
              {busy ? "處理中…" : invite ? "重新產生邀請連結" : "建立邀請連結"}
            </button>
          )}
        </section>

        <section className="members-dialog-section">
          <div className="panel-heading tight">
            <div>
              <p className="eyebrow">Permission</p>
              <h3>權限說明</h3>
            </div>
          </div>
          <p>
            你目前是{memberRoleLabel(currentRole)}。
            {currentRole === "owner"
              ? "擁有者可管理成員、邀請與分享連結。"
              : currentRole === "editor"
                ? "編輯者可共同編輯旅程，並可複製既有啟用的分享連結。"
                : "檢視者可查看旅程與成員資訊，但不可編輯或管理分享。"}
          </p>
        </section>

        <div className="form-actions">
          <button className="ghost-button" type="button" onClick={onClose}>
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
