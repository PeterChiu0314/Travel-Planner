import { memberInitial, memberName, memberRoleLabel } from "../../lib/memberName.js";

function MembersPanel({ className = "", isOwner, members, onApprove, onReject }) {
  if (!members.length) return null;
  const approvedCount = members.filter((member) => member.status === "approved").length;
  return (
    <section className={`panel members-panel${className ? ` ${className}` : ""}`}>
      <div className="panel-heading tight">
        <div>
          <p className="eyebrow">Members</p>
          <h3>成員</h3>
        </div>
        <span className="pill member-count">{approvedCount}/{members.length}</span>
      </div>
      <div className="member-summary" aria-label={`${members.length} 位成員`}>
        {members.slice(0, 4).map((member) => (
          <span className="member-avatar" key={member.id || member.user_id} title={memberName(member)}>
            {memberInitial(member)}
          </span>
        ))}
        {members.length > 4 ? <span className="member-avatar more">+{members.length - 4}</span> : null}
      </div>
      <div className="member-list">
        {members.map((member) => (
          <div className="member-row" key={member.id}>
            <div>
              <strong>{member.display_name || member.email || member.user_id}</strong>
              <span>
                {memberRoleLabel(member.role)} ·{" "}
                {member.status === "approved" ? "已核准" : "等待核准"}
              </span>
            </div>
            {isOwner && member.status === "pending" ? (
              <div className="member-actions">
                <button className="mini-button" type="button" onClick={() => onApprove(member.id)}>
                  OK
                </button>
                <button className="mini-button" type="button" onClick={() => onReject(member.id)}>
                  X
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
