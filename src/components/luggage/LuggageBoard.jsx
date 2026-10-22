import { useEffect, useRef, useState } from "react";
import { Check, CheckCheck, CircleCheck, ClipboardCheck, LockKeyhole, Luggage, Package, Pencil, Plus, Search, ShieldCheck, Trash2, Users, X } from "lucide-react";
import MenuSelect from "../MenuSelect.jsx";
import { isLockedByAnotherUser } from "../../lib/editLocks.js";
import "./luggage-board.css";

const emptyItems = [];
const categoryDefaults = ["證件與金錢", "衣物", "盥洗保養", "電子用品", "藥品", "其他"];
const personalFilters = [{ value: "all", label: "全部物品" }, { value: "unpacked", label: "未打包" }, { value: "packed", label: "已打包" }];
const sharedFilters = [{ value: "all", label: "全部公物" }, { value: "unassigned", label: "尚未指派" }, { value: "unpacked", label: "未打包" }, { value: "pending", label: "待總召確認" }, { value: "confirmed", label: "總召已確認" }];

function memberLabel(member) {
  return member?.display_name || member?.nickname || member?.profile?.display_name || member?.profiles?.display_name || member?.email?.split("@")[0] || "旅程成員";
}

function groups(items) {
  const grouped = new Map();
  for (const item of items) {
    const category = item.category?.trim() || "未分類";
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(item);
  }
  return Array.from(grouped);
}

function Progress({ label, value, total, confirmed = false }) {
  return <div className={`lb-progress${confirmed ? " is-confirmed" : ""}`}>
    <div><span>{label}</span><strong>{value}<span> / {total}</span></strong></div>
    <div className="lb-progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={Math.max(total, 1)} aria-valuenow={value} aria-valuetext={`${value} / ${total}`}><span style={{ width: total ? `${Math.round(value / total * 100)}%` : "0%" }} /></div>
  </div>;
}

function ItemActions({ item, disabled, onEdit, onDelete }) {
  return <div className="lb-item-actions">
    <button type="button" className="lb-icon-button" aria-label={`編輯：${item.title}`} title={disabled ? "其他成員正在編輯" : "編輯物品"} disabled={disabled} onClick={() => onEdit(item)}><Pencil size={15} aria-hidden="true" /></button>
    <button type="button" className="lb-icon-button lb-delete" aria-label={`刪除：${item.title}`} title="刪除物品" disabled={disabled} onClick={() => onDelete(item.id, item)}><Trash2 size={15} aria-hidden="true" /></button>
  </div>;
}

function PackCheck({ title, checked, disabled, onChange, assigned = false }) {
  return <label className="lb-pack-check" title={disabled ? "由負責成員確認打包" : checked ? "取消打包" : "標記已打包"}>
    <input type="checkbox" aria-label={`${assigned ? "打包指派公物" : "打包"}：${title}`} checked={Boolean(checked)} disabled={disabled} onChange={onChange} />
    <span className="lb-check-box" aria-hidden="true"><Check size={14} /></span>
  </label>;
}

function Empty({ filtered, shared = false, assigned = false }) {
  const Icon = assigned ? ClipboardCheck : shared ? Users : Luggage;
  return <div className="lb-empty">
    <Icon size={26} strokeWidth={1.4} aria-hidden="true" />
    <strong>{filtered ? "沒有符合的物品" : assigned ? "目前沒有指派給你的公物" : shared ? "一起列出旅途中共用的物品" : "從第一件必帶物品開始"}</strong>
    <p>{filtered ? "試著調整搜尋或篩選條件。" : assigned ? "公物指派給你後，會自動出現在這裡。" : shared ? "新增公物並選擇負責人，讓分工一目了然。" : "用上方欄位新增，勾選即可記錄打包進度。"}</p>
  </div>;
}

function LuggageSelect(props) {
  return <MenuSelect {...props} popupClassName="lb-menu-popup" />;
}

/** Shared rendering for Formal and local Demo. All writes remain in the controller. */
export default function LuggageBoard({
  activeTrip, currentUserId, isOwner, canEdit, luggageItems = emptyItems, sharedLuggageItems = emptyItems, members = emptyItems,
  activeTab = "personal", onTabChange, personalForm, setPersonalForm, sharedForm, setSharedForm,
  editingPersonalId, editingSharedId, submitPersonal, submitShared, editPersonal, editShared, cancelPersonalEdit, cancelSharedEdit,
  onTogglePersonal, onUpdateShared, onDeletePersonal, onDeleteShared, busy = false, error = "",
}) {
  const [query, setQuery] = useState("");
  const [personalFilter, setPersonalFilter] = useState("all");
  const [sharedFilter, setSharedFilter] = useState("all");
  const personalInput = useRef(null), sharedInput = useRef(null);
  const approvedMembers = members.filter((member) => member.status === "approved");
  const memberById = new Map(approvedMembers.map((member) => [member.user_id, member]));
  const assignedItems = sharedLuggageItems.filter((item) => item.assigned_to === currentUserId);
  const allMine = [...luggageItems, ...assignedItems];
  const myPacked = luggageItems.filter((item) => item.packed).length + assignedItems.filter((item) => item.packed_by_assignee).length;
  const teamPacked = sharedLuggageItems.filter((item) => item.packed_by_assignee).length;
  const teamConfirmed = sharedLuggageItems.filter((item) => item.packed_by_assignee && item.confirmed_by_owner).length;
  const categories = [...new Set([...categoryDefaults, ...luggageItems.map((item) => item.category), ...sharedLuggageItems.map((item) => item.category)].filter(Boolean))].map((value) => ({ value, label: value }));
  const search = query.trim().toLocaleLowerCase();
  const matchesSearch = (item) => !search || [item.title, item.category, memberLabel(memberById.get(item.assigned_to))].filter(Boolean).join(" ").toLocaleLowerCase().includes(search);
  const matchesPersonal = (item, shared = false) => matchesSearch(item) && (personalFilter === "all" || (personalFilter === "packed") === Boolean(shared ? item.packed_by_assignee : item.packed));
  const shownPersonal = luggageItems.filter((item) => matchesPersonal(item));
  const shownAssigned = assignedItems.filter((item) => matchesPersonal(item, true));
  const shownShared = sharedLuggageItems.filter((item) => matchesSearch(item) && (sharedFilter === "all" || sharedFilter === "unassigned" && !item.assigned_to || sharedFilter === "unpacked" && !item.packed_by_assignee || sharedFilter === "pending" && item.packed_by_assignee && !item.confirmed_by_owner || sharedFilter === "confirmed" && item.packed_by_assignee && item.confirmed_by_owner));
  const assigneeOptions = [{ value: "", label: "未指派" }, ...approvedMembers.map((member) => ({ value: member.user_id, label: `${memberLabel(member)}${member.user_id === currentUserId ? "（我）" : ""}` }))];
  function navigateTabs(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "personal" : event.key === "End" ? "shared" : activeTab === "personal" ? "shared" : "personal";
    onTabChange?.(next);
    event.currentTarget.querySelector(`#lb-${next}-tab`)?.focus();
  }

  useEffect(() => { setQuery(""); setPersonalFilter("all"); setSharedFilter("all"); }, [activeTrip?.id]);
  useEffect(() => { if (editingPersonalId) { personalInput.current?.focus(); personalInput.current?.scrollIntoView({ block: "nearest" }); } }, [editingPersonalId]);
  useEffect(() => { if (editingSharedId) { sharedInput.current?.focus(); sharedInput.current?.scrollIntoView({ block: "nearest" }); } }, [editingSharedId]);

  return <section className="panel luggage-panel travel-workspace lb-board" aria-label="行李清單">
    <header className="lb-heading">
      <div><div className="lb-title"><Luggage size={22} strokeWidth={1.6} aria-hidden="true" /><h2>行李清單</h2></div><p>私人物品各自準備，團隊公物一起確認。</p></div>
      <label className="lb-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="搜尋行李" placeholder="搜尋物品、分類或負責人" value={query} onChange={(event) => setQuery(event.target.value)} />{query ? <button type="button" aria-label="清除行李搜尋" onClick={() => setQuery("")}><X size={16} /></button> : null}</label>
    </header>
    {error ? <div className="lb-error" role="alert">{typeof error === "string" ? error : "操作未完成，請稍後再試。"}</div> : null}
    <div className="mobile-tabs lb-mobile-tabs" role="tablist" aria-label="行李清單類型" onKeyDown={navigateTabs}>
      <button type="button" role="tab" aria-selected={activeTab === "personal"} aria-controls="lb-personal" tabIndex={activeTab === "personal" ? 0 : -1} id="lb-personal-tab" className={activeTab === "personal" ? "active" : ""} onClick={() => onTabChange?.("personal")}><Luggage size={17} aria-hidden="true" />個人行李<span>{allMine.length}</span></button>
      <button type="button" role="tab" aria-selected={activeTab === "shared"} aria-controls="lb-shared" tabIndex={activeTab === "shared" ? 0 : -1} id="lb-shared-tab" className={activeTab === "shared" ? "active" : ""} onClick={() => onTabChange?.("shared")}><Users size={17} aria-hidden="true" />團隊公物<span>{sharedLuggageItems.length}</span></button>
    </div>
    <div className="luggage-layout lb-layout">
      <section id="lb-personal" className={`luggage-column lb-personal${activeTab === "personal" ? " active" : ""}`} aria-label="個人行李">
        <header className="lb-column-heading"><div><h3>個人行李</h3><span className="lb-privacy"><LockKeyhole size={12} aria-hidden="true" />僅自己可見</span></div><LuggageSelect label="個人行李篩選" value={personalFilter} options={personalFilters} onValueChange={setPersonalFilter} /></header>
        <Progress label="我的打包進度" value={myPacked} total={allMine.length} />
        <form autoComplete="off" className={`lb-add-form${editingPersonalId ? " is-editing" : ""}`} onSubmit={submitPersonal}>
          {editingPersonalId ? <div className="lb-editing-label"><Pencil size={12} aria-hidden="true" />編輯個人行李<button type="button" onClick={cancelPersonalEdit} aria-label="取消編輯個人行李"><X size={16} /></button></div> : null}
          <div className="lb-add-main"><input ref={personalInput} aria-label="個人行李名稱" placeholder="新增個人行李" value={personalForm.title} maxLength={160} disabled={!canEdit || busy} onChange={(event) => setPersonalForm({ ...personalForm, title: event.target.value })} /><button className="lb-add-button" type="submit" disabled={!canEdit || busy || !personalForm.title.trim()} aria-label={editingPersonalId ? "儲存個人行李" : "新增個人行李"}>{editingPersonalId ? <Check size={19} /> : <Plus size={19} />}<span>{editingPersonalId ? "儲存" : "新增"}</span></button></div>
          <label className="lb-form-field"><span>分類</span><LuggageSelect label="個人行李分類" editable value={personalForm.category} options={categories} disabled={!canEdit || busy} onValueChange={(category) => setPersonalForm({ ...personalForm, category })} /></label>
        </form>
        <div className="lb-list-body">
          {shownPersonal.length ? <div className="luggage-list lb-private-list">{groups(shownPersonal).map(([category, items]) => <section className="lb-category" key={category}><h4><span>{category}</span><span>{items.length}</span></h4>{items.map((item) => {
            const locked = isLockedByAnotherUser(item, currentUserId);
            return <article className={`luggage-row lb-private-row${item.packed ? " packed" : ""}${editingPersonalId === item.id ? " is-editing" : ""}`} key={item.id}>
              <PackCheck title={item.title} checked={item.packed} disabled={!canEdit || busy || locked} onChange={() => onTogglePersonal(item)} />
              <div className="lb-item-name"><strong>{item.title}</strong>{locked ? <small><LockKeyhole size={11} />其他成員編輯中</small> : null}</div>
              <ItemActions item={item} disabled={!canEdit || busy || locked} onEdit={editPersonal} onDelete={onDeletePersonal} />
            </article>;
          })}</section>)}</div> : <Empty filtered={Boolean(search || personalFilter !== "all")} />}
          <section className="assigned-shared-list lb-assigned"><header><div><Package size={16} aria-hidden="true" /><h4>我負責的公物</h4><span>{assignedItems.length}</span></div><span className="lb-sync-label">與團隊同步</span></header>
            {shownAssigned.length ? shownAssigned.map((item) => <article className={`luggage-row shared-assigned${item.packed_by_assignee ? " packed" : ""}`} key={item.id}>
              <PackCheck title={item.title} assigned checked={item.packed_by_assignee} disabled={!canEdit || busy || isLockedByAnotherUser(item, currentUserId)} onChange={() => onUpdateShared(item.id, { packed_by_assignee: !item.packed_by_assignee }, item)} />
              <div className="lb-item-name"><strong>{item.title}</strong><small>{item.category || "未分類"}</small></div>
              <span className={`lb-state ${item.confirmed_by_owner && item.packed_by_assignee ? "is-confirmed" : item.packed_by_assignee ? "is-pending" : ""}`}>{item.confirmed_by_owner && item.packed_by_assignee ? <><ShieldCheck size={12} />總召已確認</> : item.packed_by_assignee ? "待總召確認" : "尚未打包"}</span>
            </article>) : <Empty filtered={Boolean(search || personalFilter !== "all")} assigned />}
          </section>
        </div>
      </section>

      <section id="lb-shared" className={`luggage-column lb-shared${activeTab === "shared" ? " active" : ""}`} aria-label="團隊公物">
        <header className="lb-column-heading"><div><h3>團隊公物</h3><span className="lb-privacy"><Users size={12} aria-hidden="true" />全體旅伴共同管理</span></div><LuggageSelect label="團隊公物篩選" value={sharedFilter} options={sharedFilters} onValueChange={setSharedFilter} /></header>
        <div className="lb-team-progress"><Progress label="成員已打包" value={teamPacked} total={sharedLuggageItems.length} /><Progress label="總召已確認" value={teamConfirmed} total={sharedLuggageItems.length} confirmed /></div>
        <form autoComplete="off" className={`lb-add-form${editingSharedId ? " is-editing" : ""}`} onSubmit={submitShared}>
          {editingSharedId ? <div className="lb-editing-label"><Pencil size={12} aria-hidden="true" />編輯團隊公物<button type="button" onClick={cancelSharedEdit} aria-label="取消編輯團隊公物"><X size={16} /></button></div> : null}
          <div className="lb-add-main"><input ref={sharedInput} aria-label="團隊公物名稱" placeholder="新增大家共用的物品" value={sharedForm.title} maxLength={160} disabled={!canEdit || busy} onChange={(event) => setSharedForm({ ...sharedForm, title: event.target.value })} /><button className="lb-add-button" type="submit" disabled={!canEdit || busy || !sharedForm.title.trim()} aria-label={editingSharedId ? "儲存團隊公物" : "新增團隊公物"}>{editingSharedId ? <Check size={19} /> : <Plus size={19} />}<span>{editingSharedId ? "儲存" : "新增"}</span></button></div>
          <div className="lb-add-fields"><label className="lb-form-field"><span>分類</span><LuggageSelect label="團隊公物分類" editable value={sharedForm.category} options={categories} disabled={!canEdit || busy} onValueChange={(category) => setSharedForm({ ...sharedForm, category })} /></label><label className="lb-form-field"><span>負責攜帶</span><LuggageSelect label="指派公物負責人" value={sharedForm.assigned_to} options={assigneeOptions} disabled={!canEdit || busy} onValueChange={(assigned_to) => setSharedForm({ ...sharedForm, assigned_to })} /></label></div>
          {editingSharedId ? <p className="lb-edit-note">修改物品名稱、分類或負責人後，需重新打包與確認。</p> : null}
        </form>
        <div className="lb-confirm-explainer"><CircleCheck size={14} aria-hidden="true" /><span>負責人打包<span aria-hidden="true"> → </span>總召再次確認，才算準備完成。</span></div>
        <div className="lb-list-body">
          {shownShared.length ? <div className="luggage-list">{groups(shownShared).map(([category, items]) => <section className="lb-category" key={category}><h4><span>{category}</span><span>{items.length}</span></h4>{items.map((item) => {
            const locked = isLockedByAnotherUser(item, currentUserId);
            const assignee = memberById.get(item.assigned_to);
            const canPack = canEdit && !busy && !locked && item.assigned_to === currentUserId;
            const canConfirm = isOwner && canEdit && !busy && !locked && Boolean(assignee && item.packed_by_assignee);
            const confirmed = item.packed_by_assignee && item.confirmed_by_owner;
            return <article className={`shared-luggage-row${confirmed ? " is-confirmed" : ""}${editingSharedId === item.id ? " is-editing" : ""}`} key={item.id}>
              <div className="lb-shared-main"><Package size={17} strokeWidth={1.5} aria-hidden="true" /><div className="lb-item-name"><strong>{item.title}</strong>{locked ? <small><LockKeyhole size={11} />其他成員編輯中</small> : null}</div><ItemActions item={item} disabled={!canEdit || busy || locked} onEdit={editShared} onDelete={onDeleteShared} /></div>
              <div className="lb-shared-bottom"><div className={`lb-assignee${!assignee ? " is-unassigned" : ""}`}><span className="lb-avatar" aria-hidden="true">{assignee ? memberLabel(assignee).slice(0, 1) : "?"}</span><span>{assignee ? `${memberLabel(assignee)}${item.assigned_to === currentUserId ? "（我）" : ""}` : item.assigned_to ? "成員已離開 · 需重新指派" : "尚未指派"}</span></div><div className="lb-confirm-stages">
                <label className={`lb-stage${item.packed_by_assignee ? " is-done" : ""}`} title={canPack ? "負責成員確認物品已打包" : item.assigned_to ? "由負責成員確認打包" : "請先指派負責人"}><input type="checkbox" aria-label={`成員已打包：${item.title}`} checked={Boolean(item.packed_by_assignee)} disabled={!canPack} onChange={() => onUpdateShared(item.id, { packed_by_assignee: !item.packed_by_assignee }, item)} /><span className="lb-stage-indicator" aria-hidden="true">{item.packed_by_assignee ? <Check size={12} /> : "1"}</span><span>{item.packed_by_assignee ? "成員已打包" : "成員打包"}</span></label>
                <span className="lb-stage-arrow" aria-hidden="true">›</span>
                <label className={`lb-stage lb-owner-stage${confirmed ? " is-done" : ""}`} title={!isOwner ? "僅旅程總召可再次確認" : !assignee ? "請先重新指派旅程成員" : !item.packed_by_assignee ? "待負責成員打包後確認" : "總召再次確認物品已備妥"}><input type="checkbox" aria-label={`總召確認：${item.title}`} checked={Boolean(confirmed)} disabled={!canConfirm} onChange={() => onUpdateShared(item.id, { confirmed_by_owner: !item.confirmed_by_owner }, item)} /><span className="lb-stage-indicator" aria-hidden="true">{confirmed ? <CheckCheck size={12} /> : "2"}</span><span>{confirmed ? "總召已確認" : "總召確認"}</span></label>
              </div></div>
            </article>;
          })}</section>)}</div> : <Empty shared filtered={Boolean(search || sharedFilter !== "all")} />}
        </div>
      </section>
    </div>
  </section>;
}
