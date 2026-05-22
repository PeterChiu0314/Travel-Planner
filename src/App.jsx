import { useCallback, useEffect, useMemo, useState } from "react";
import { hasSupabaseConfig, supabase } from "./lib/supabase.js";

const typeLabels = {
  attraction: "景點",
  food: "餐飲",
  hotel: "住宿",
  transport: "交通",
  note: "備註",
};

const typeColors = {
  attraction: "#2f8f72",
  food: "#d85f49",
  hotel: "#7865a8",
  transport: "#5f8fb8",
  note: "#f3b64b",
};

const defaultPackItems = ["護照", "行動電源", "充電線", "轉接頭", "雨具", "常備藥", "票券"];

const emptyItemForm = {
  type: "attraction",
  start_time: "",
  end_time: "",
  title: "",
  location: "",
  note: "",
  cost: 0,
};

function todayInput(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function formatMoney(value) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function tripDays(trip) {
  if (!trip?.start_date || !trip?.end_date) return [];
  const start = new Date(`${trip.start_date}T00:00:00`);
  const end = new Date(`${trip.end_date}T00:00:00`);
  const diff = Math.max(0, Math.round((end - start) / 86400000));
  return Array.from({ length: diff + 1 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function inviteTokenFromUrl() {
  return new URLSearchParams(window.location.search).get("invite");
}

function clearInviteTokenFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("invite");
  window.history.replaceState({}, "", url.toString());
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [trips, setTrips] = useState([]);
  const [activeTripId, setActiveTripId] = useState(null);
  const [activeDay, setActiveDay] = useState(0);
  const [items, setItems] = useState([]);
  const [packItems, setPackItems] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [isTripDialogOpen, setIsTripDialogOpen] = useState(false);
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [tripForm, setTripForm] = useState({
    title: "京都五日散策",
    destination: "京都, 日本",
    start_date: todayInput(),
    end_date: todayInput(2),
  });

  const activeTrip = useMemo(
    () => trips.find((trip) => trip.id === activeTripId) || null,
    [activeTripId, trips],
  );
  const activeMembership = activeTrip?.membership;
  const isOwner = activeMembership?.role === "owner" && activeMembership?.status === "approved";
  const canEdit = activeMembership?.status === "approved";
  const isPending = activeMembership?.status === "pending";
  const days = useMemo(() => tripDays(activeTrip), [activeTrip]);

  const dayItems = useMemo(
    () =>
      items
        .filter((item) => item.day_index === activeDay)
        .sort((a, b) => {
          const orderSort = Number(a.sort_order || 0) - Number(b.sort_order || 0);
          const timeSort = (a.start_time || "99:99").localeCompare(b.start_time || "99:99");
          return orderSort || timeSort;
        }),
    [activeDay, items],
  );

  const loadTrips = useCallback(
    async (preferredTripId = activeTripId) => {
      if (!session?.user) return;
      setLoading(true);
      const { data, error } = await supabase
        .from("trip_members")
        .select(
          "role,status,trip_id,trips(id,title,destination,start_date,end_date,owner_id,updated_at)",
        )
        .eq("user_id", session.user.id);

      if (error) {
        setNotice(error.message);
        setLoading(false);
        return;
      }

      const nextTrips = (data || [])
        .filter((row) => row.trips)
        .map((row) => ({
          ...row.trips,
          membership: {
            role: row.role,
            status: row.status,
          },
        }))
        .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));

      setTrips(nextTrips);
      const nextActive =
        nextTrips.find((trip) => trip.id === preferredTripId)?.id || nextTrips[0]?.id || null;
      setActiveTripId(nextActive);
      setLoading(false);
    },
    [activeTripId, session?.user],
  );

  const loadTripData = useCallback(async (tripId) => {
    if (!tripId) {
      setItems([]);
      setPackItems([]);
      setMembers([]);
      return;
    }

    const [itemsResult, packResult, membersResult] = await Promise.all([
      supabase.from("itinerary_items").select("*").eq("trip_id", tripId),
      supabase.from("pack_items").select("*").eq("trip_id", tripId).order("created_at"),
      supabase
        .from("trip_members")
        .select("id,trip_id,user_id,role,status,created_at,display_name,email")
        .eq("trip_id", tripId)
        .order("created_at"),
    ]);

    const error = itemsResult.error || packResult.error || membersResult.error;
    if (error) {
      setNotice(error.message);
      return;
    }

    setItems(itemsResult.data || []);
    setPackItems(packResult.data || []);
    setMembers(membersResult.data || []);
  }, []);

  useEffect(() => {
    if (!hasSupabaseConfig) {
      setAuthReady(true);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setTrips([]);
      setActiveTripId(null);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.user) loadTrips();
  }, [loadTrips, session?.user]);

  useEffect(() => {
    if (!session?.user) return;
    const token = inviteTokenFromUrl();
    if (!token) return;

    async function joinInvite() {
      const user = session.user;
      const { data: tripId, error } = await supabase.rpc("request_trip_membership", {
        invite_token: token,
        member_display_name: user.user_metadata?.full_name || user.email,
        member_email: user.email,
      });

      if (error || !tripId) {
        setNotice(error?.message || "邀請連結無效或已失效。");
        clearInviteTokenFromUrl();
        return;
      }

      setNotice("已送出加入申請，等待旅程擁有者核准。");
      await loadTrips(tripId);
      clearInviteTokenFromUrl();
    }

    joinInvite();
  }, [loadTrips, session]);

  useEffect(() => {
    setActiveDay(0);
    loadTripData(activeTripId);
  }, [activeTripId, loadTripData]);

  useEffect(() => {
    if (!activeTripId || !session?.user) return undefined;
    const channel = supabase
      .channel(`trip-${activeTripId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trips", filter: `id=eq.${activeTripId}` },
        () => loadTrips(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "itinerary_items", filter: `trip_id=eq.${activeTripId}` },
        () => loadTripData(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pack_items", filter: `trip_id=eq.${activeTripId}` },
        () => loadTripData(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trip_members", filter: `trip_id=eq.${activeTripId}` },
        () => {
          loadTrips(activeTripId);
          loadTripData(activeTripId);
        },
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [activeTripId, loadTripData, loadTrips, session?.user]);

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      // Using `origin` avoids accumulating query params (e.g. invite tokens) and
      // prevents redirect loops when using custom domains + OAuth allowlists.
      options: { redirectTo: window.location.origin },
    });
    if (error) setNotice(error.message);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function createTrip(event) {
    event.preventDefault();
    const user = session.user;
    const safeEndDate =
      tripForm.end_date < tripForm.start_date ? tripForm.start_date : tripForm.end_date;
    const tripId = crypto.randomUUID();
    const { error: tripError } = await supabase.from("trips").insert({
      id: tripId,
      title: tripForm.title.trim(),
      destination: tripForm.destination.trim(),
      start_date: tripForm.start_date,
      end_date: safeEndDate,
      owner_id: user.id,
    });

    if (tripError) {
      setNotice(tripError.message);
      return;
    }

    const { error: memberError } = await supabase.from("trip_members").insert({
      trip_id: tripId,
      user_id: user.id,
      role: "owner",
      status: "approved",
      display_name: user.user_metadata?.full_name || user.email,
      email: user.email,
    });

    if (memberError) {
      setNotice(memberError.message);
      return;
    }

    const packRows = defaultPackItems.map((title) => ({ trip_id: tripId, title }));
    await supabase.from("pack_items").insert(packRows);

    setIsTripDialogOpen(false);
    setTripForm({
      title: "京都五日散策",
      destination: "京都, 日本",
      start_date: todayInput(),
      end_date: todayInput(2),
    });
    await loadTrips(tripId);
  }

  async function updateTrip(patch) {
    if (!activeTrip || !isOwner) return;
    const nextPatch = { ...patch };
    if (nextPatch.start_date && activeTrip.end_date < nextPatch.start_date) {
      nextPatch.end_date = nextPatch.start_date;
    }
    if (nextPatch.end_date && nextPatch.end_date < activeTrip.start_date) {
      nextPatch.start_date = nextPatch.end_date;
    }
    const { error } = await supabase.from("trips").update(nextPatch).eq("id", activeTrip.id);
    if (error) setNotice(error.message);
    else await loadTrips(activeTrip.id);
  }

  async function deleteTrip() {
    if (!activeTrip || !isOwner) return;
    const ok = window.confirm(`刪除「${activeTrip.title}」？`);
    if (!ok) return;
    const { error } = await supabase.from("trips").delete().eq("id", activeTrip.id);
    if (error) setNotice(error.message);
    else await loadTrips();
  }

  async function saveItem(payload, editingId) {
    if (!activeTrip || !canEdit) return;
    if (editingId) {
      const { error } = await supabase
        .from("itinerary_items")
        .update(normalizeItemPayload(payload))
        .eq("id", editingId);
      if (error) setNotice(error.message);
      else await loadTripData(activeTrip.id);
      return;
    }

    const { error } = await supabase.from("itinerary_items").insert({
      ...normalizeItemPayload(payload),
      trip_id: activeTrip.id,
      day_index: activeDay,
      sort_order: dayItems.length,
    });
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function deleteItem(itemId) {
    if (!canEdit) return;
    const { error } = await supabase.from("itinerary_items").delete().eq("id", itemId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function reorderItem(draggedId, targetId) {
    if (!canEdit || draggedId === targetId) return;
    const nextItems = [...dayItems];
    const from = nextItems.findIndex((item) => item.id === draggedId);
    const to = nextItems.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const [dragged] = nextItems.splice(from, 1);
    nextItems.splice(to, 0, dragged);
    const updates = nextItems.map((item, index) =>
      supabase.from("itinerary_items").update({ sort_order: index }).eq("id", item.id),
    );
    const results = await Promise.all(updates);
    const error = results.find((result) => result.error)?.error;
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function addPackItem(title) {
    if (!activeTrip || !canEdit || !title.trim()) return;
    const { error } = await supabase
      .from("pack_items")
      .insert({ trip_id: activeTrip.id, title: title.trim() });
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function togglePackItem(item) {
    if (!canEdit) return;
    const { error } = await supabase
      .from("pack_items")
      .update({ done: !item.done })
      .eq("id", item.id);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function deletePackItem(itemId) {
    if (!canEdit) return;
    const { error } = await supabase.from("pack_items").delete().eq("id", itemId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function approveMember(memberId) {
    if (!isOwner) return;
    const { error } = await supabase
      .from("trip_members")
      .update({ status: "approved" })
      .eq("id", memberId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function rejectMember(memberId) {
    if (!isOwner) return;
    const { error } = await supabase.from("trip_members").delete().eq("id", memberId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

function exportTrip() {
    if (!activeTrip) return;
    const payload = {
      ...activeTrip,
      itinerary_items: items,
      pack_items: packItems,
      members,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeTrip.title || "trip"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!hasSupabaseConfig) {
    return (
      <Shell>
        <ConfigMissing />
      </Shell>
    );
  }

  if (!authReady) {
    return (
      <Shell>
        <div className="center-state">載入中...</div>
      </Shell>
    );
  }

  if (!session) {
    return (
      <Shell>
        <LoginView onSignIn={signInWithGoogle} notice={notice} />
      </Shell>
    );
  }

  return (
    <Shell>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">TP</div>
          <div>
            <h1>旅程規劃室</h1>
            <p>{trips.length} 個旅程</p>
          </div>
        </div>
        <button className="primary-button" type="button" onClick={() => setIsTripDialogOpen(true)}>
          <span aria-hidden="true">+</span>
          新增旅程
        </button>
        <TripList trips={trips} activeTripId={activeTripId} onSelect={setActiveTripId} />
        <div className="user-box">
          <strong>{session.user.user_metadata?.full_name || session.user.email}</strong>
          <button className="ghost-button" type="button" onClick={signOut}>
            登出
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Collaborative Travel Planner</p>
            <h2>{activeTrip?.title || "選擇或建立旅程"}</h2>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button" type="button" disabled={!activeTrip} onClick={exportTrip}>
              匯出 JSON
            </button>
            <button
              className="ghost-button"
              type="button"
              disabled={!isOwner}
              onClick={() => setIsInviteDialogOpen(true)}
            >
              邀請朋友
            </button>
            <button className="ghost-button danger" type="button" disabled={!isOwner} onClick={deleteTrip}>
              刪除旅程
            </button>
          </div>
        </header>

        {notice ? (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice("")}>
              X
            </button>
          </div>
        ) : null}

        {loading ? <div className="center-state">同步資料中...</div> : null}

        {!activeTrip && !loading ? (
          <EmptyState onCreate={() => setIsTripDialogOpen(true)} />
        ) : null}

        {activeTrip ? (
          <TripWorkspace
            activeTrip={activeTrip}
            activeDay={activeDay}
            canEdit={canEdit}
            dayItems={dayItems}
            days={days}
            isOwner={isOwner}
            isPending={isPending}
            items={items}
            members={members}
            packItems={packItems}
            onActiveDay={setActiveDay}
            onAddPackItem={addPackItem}
            onApproveMember={approveMember}
            onDeleteItem={deleteItem}
            onDeletePackItem={deletePackItem}
            onRejectMember={rejectMember}
            onReorderItem={reorderItem}
            onSaveItem={saveItem}
            onTogglePackItem={togglePackItem}
            onUpdateTrip={updateTrip}
          />
        ) : null}
      </main>

      {isTripDialogOpen ? (
        <TripDialog
          form={tripForm}
          onChange={setTripForm}
          onClose={() => setIsTripDialogOpen(false)}
          onSubmit={createTrip}
        />
      ) : null}

      {isInviteDialogOpen && activeTrip ? (
        <InviteDialog trip={activeTrip} onClose={() => setIsInviteDialogOpen(false)} />
      ) : null}
    </Shell>
  );
}

function normalizeItemPayload(payload) {
  return {
    ...payload,
    start_time: payload.start_time || null,
    end_time: payload.end_time || null,
  };
}

function Shell({ children }) {
  return <div className="app-shell">{children}</div>;
}

function ConfigMissing() {
  return (
    <section className="login-view">
      <div className="login-panel">
        <p className="eyebrow">Setup Required</p>
        <h1>需要 Supabase 設定</h1>
        <p>
          請複製 <code>.env.example</code> 為 <code>.env</code>，填入
          <code> VITE_SUPABASE_URL</code> 與 <code> VITE_SUPABASE_ANON_KEY</code>。
        </p>
      </div>
    </section>
  );
}

function LoginView({ onSignIn, notice }) {
  return (
    <section className="login-view">
      <div className="login-panel">
        <p className="eyebrow">Travel Planner</p>
        <h1>一起把旅程排好</h1>
        <p>使用 Google 登入後，就能建立旅程、邀請朋友、等待擁有者核准並即時共同編輯。</p>
        {notice ? <div className="notice">{notice}</div> : null}
        <button className="primary-button" type="button" onClick={onSignIn}>
          使用 Google 登入
        </button>
      </div>
    </section>
  );
}

function TripList({ trips, activeTripId, onSelect }) {
  return (
    <div className="trip-list" aria-label="旅程列表">
      {trips.map((trip) => (
        <button
          className={`trip-card${trip.id === activeTripId ? " active" : ""}`}
          key={trip.id}
          type="button"
          onClick={() => onSelect(trip.id)}
        >
          <strong>{trip.title}</strong>
          <span>
            {trip.destination} · {trip.start_date}
          </span>
          {trip.membership.status === "pending" ? <em>等待核准</em> : null}
        </button>
      ))}
    </div>
  );
}

function EmptyState({ onCreate }) {
  return (
    <section className="empty-state">
      <div className="empty-visual" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <h2>開始安排下一趟旅程</h2>
      <p>建立旅程後，就能邀請朋友加入，並一起編輯每天的景點、餐廳、交通、住宿和預算。</p>
      <button className="primary-button compact" type="button" onClick={onCreate}>
        建立第一個旅程
      </button>
    </section>
  );
}

function TripWorkspace(props) {
  const {
    activeTrip,
    activeDay,
    canEdit,
    dayItems,
    days,
    isOwner,
    isPending,
    items,
    members,
    packItems,
    onActiveDay,
    onAddPackItem,
    onApproveMember,
    onDeleteItem,
    onDeletePackItem,
    onRejectMember,
    onReorderItem,
    onSaveItem,
    onTogglePackItem,
    onUpdateTrip,
  } = props;

  return (
    <section className="trip-editor">
      {isPending ? (
        <div className="pending-banner">你已送出加入申請，旅程擁有者核准後即可共同編輯。</div>
      ) : null}

      <div className="field-group trip-fields">
        <label>
          旅程名稱
          <input
            key={`${activeTrip.id}-${activeTrip.updated_at}-title`}
            disabled={!isOwner}
            defaultValue={activeTrip.title}
            onBlur={(event) => onUpdateTrip({ title: event.target.value })}
          />
        </label>
        <label>
          目的地
          <input
            key={`${activeTrip.id}-${activeTrip.updated_at}-destination`}
            disabled={!isOwner}
            defaultValue={activeTrip.destination}
            onBlur={(event) => onUpdateTrip({ destination: event.target.value })}
          />
        </label>
        <label>
          開始日期
          <input
            disabled={!isOwner}
            type="date"
            value={activeTrip.start_date}
            onChange={(event) => onUpdateTrip({ start_date: event.target.value })}
          />
        </label>
        <label>
          結束日期
          <input
            disabled={!isOwner}
            type="date"
            value={activeTrip.end_date}
            onChange={(event) => onUpdateTrip({ end_date: event.target.value })}
          />
        </label>
      </div>

      <DayTabs activeDay={activeDay} days={days} onActiveDay={onActiveDay} />

      <div className="content-grid">
        <section className="panel itinerary-panel">
          <ItineraryTimeline
            activeDay={activeDay}
            canEdit={canEdit}
            dayItems={dayItems}
            dayLabel={days[activeDay] ? `Day ${activeDay + 1} · ${formatDate(days[activeDay])}` : ""}
            onDeleteItem={onDeleteItem}
            onReorderItem={onReorderItem}
            onSaveItem={onSaveItem}
          />
        </section>

        <aside className="side-panels">
          <RoutePanel dayItems={dayItems} />
          <BudgetPanel items={items} />
          <PackList
            canEdit={canEdit}
            items={packItems}
            onAdd={onAddPackItem}
            onDelete={onDeletePackItem}
            onToggle={onTogglePackItem}
          />
          <MembersPanel
            isOwner={isOwner}
            members={members}
            onApprove={onApproveMember}
            onReject={onRejectMember}
          />
        </aside>
      </div>
    </section>
  );
}

function DayTabs({ activeDay, days, onActiveDay }) {
  return (
    <nav className="day-tabs" aria-label="日期切換">
      {days.map((date, index) => (
        <button
          className={`day-tab${index === activeDay ? " active" : ""}`}
          key={date.toISOString()}
          type="button"
          onClick={() => onActiveDay(index)}
        >
          Day {index + 1} {formatDate(date)}
        </button>
      ))}
    </nav>
  );
}

function ItineraryTimeline({
  canEdit,
  dayItems,
  dayLabel,
  onDeleteItem,
  onReorderItem,
  onSaveItem,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyItemForm);

  function openNewItem() {
    setForm(emptyItemForm);
    setEditingId(null);
    setIsOpen(true);
  }

  function openEditItem(item) {
    setForm({
      type: item.type,
      start_time: item.start_time || "",
      end_time: item.end_time || "",
      title: item.title,
      location: item.location || "",
      note: item.note || "",
      cost: item.cost || 0,
    });
    setEditingId(item.id);
    setIsOpen(true);
  }

  async function submit(event) {
    event.preventDefault();
    await onSaveItem(
      {
        ...form,
        title: form.title.trim(),
        location: form.location.trim(),
        note: form.note.trim(),
        cost: Number(form.cost || 0),
      },
      editingId,
    );
    setForm(emptyItemForm);
    setEditingId(null);
    setIsOpen(false);
  }

  return (
    <>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Schedule</p>
          <h3>{dayLabel}</h3>
        </div>
        <button className="icon-button" disabled={!canEdit} type="button" title="新增行程" onClick={openNewItem}>
          +
        </button>
      </div>

      {isOpen ? (
        <form className="item-form" onSubmit={submit}>
          <div className="field-group form-grid">
            <label>
              類型
              <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
                {Object.entries(typeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              開始
              <input
                type="time"
                value={form.start_time}
                onChange={(event) => setForm({ ...form, start_time: event.target.value })}
              />
            </label>
            <label>
              結束
              <input
                type="time"
                value={form.end_time}
                onChange={(event) => setForm({ ...form, end_time: event.target.value })}
              />
            </label>
            <label>
              費用
              <input
                min="0"
                step="1"
                type="number"
                value={form.cost}
                onChange={(event) => setForm({ ...form, cost: event.target.value })}
              />
            </label>
          </div>
          <div className="field-group form-grid wide">
            <label>
              名稱
              <input
                required
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </label>
            <label>
              地點
              <input
                value={form.location}
                onChange={(event) => setForm({ ...form, location: event.target.value })}
              />
            </label>
          </div>
          <label className="full-label">
            備註
            <textarea
              rows="3"
              value={form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
            />
          </label>
          <div className="form-actions">
            <button className="ghost-button" type="button" onClick={() => setIsOpen(false)}>
              取消
            </button>
            <button className="primary-button compact" type="submit">
              儲存
            </button>
          </div>
        </form>
      ) : null}

      <div className="timeline">
        {dayItems.length ? (
          dayItems.map((item) => (
            <article
              className="timeline-item"
              draggable={canEdit}
              key={item.id}
              onDragStart={(event) => event.dataTransfer.setData("text/plain", item.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                onReorderItem(event.dataTransfer.getData("text/plain"), item.id);
              }}
            >
              <div className="time-block">
                {item.start_time || "--:--"}
                <br />
                {item.end_time || ""}
              </div>
              <div className="item-main">
                <h4>{item.title}</h4>
                <p>{item.location || "未設定地點"}</p>
                {item.note ? <p>{item.note}</p> : null}
                <div className="item-meta">
                  <span
                    className="pill"
                    style={{ background: `${typeColors[item.type]}22`, color: typeColors[item.type] }}
                  >
                    {typeLabels[item.type]}
                  </span>
                  <span className="pill">{formatMoney(item.cost)}</span>
                </div>
              </div>
              <div className="item-actions">
                <button
                  className="mini-button"
                  disabled={!canEdit}
                  type="button"
                  title="編輯"
                  onClick={() => openEditItem(item)}
                >
                  E
                </button>
                <button
                  className="mini-button"
                  disabled={!canEdit}
                  type="button"
                  title="刪除"
                  onClick={() => onDeleteItem(item.id)}
                >
                  X
                </button>
              </div>
            </article>
          ))
        ) : (
          <div className="timeline-empty">這一天還沒有行程</div>
        )}
      </div>
    </>
  );
}

function RoutePanel({ dayItems }) {
  const stops = dayItems.filter((item) => item.location || item.title);
  return (
    <section className="panel">
      <div className="panel-heading tight">
        <div>
          <p className="eyebrow">Route</p>
          <h3>路線</h3>
        </div>
      </div>
      <div className="route-map">
        {stops.length ? <div className="route-line" /> : null}
        {stops.length ? (
          stops.map((item, index) => (
            <div className="route-stop" key={item.id}>
              <span className="route-dot">{index + 1}</span>
              <span className="route-name">{item.location || item.title}</span>
            </div>
          ))
        ) : (
          <div className="timeline-empty">尚無路線</div>
        )}
      </div>
    </section>
  );
}

function BudgetPanel({ items }) {
  const totals = useMemo(() => {
    const next = {};
    items.forEach((item) => {
      next[item.type] = (next[item.type] || 0) + Number(item.cost || 0);
    });
    return next;
  }, [items]);
  const total = Object.values(totals).reduce((sum, value) => sum + value, 0);

  return (
    <section className="panel">
      <div className="panel-heading tight">
        <div>
          <p className="eyebrow">Budget</p>
          <h3>預算</h3>
        </div>
      </div>
      <div className="budget-total">{formatMoney(total)}</div>
      <div className="budget-list">
        {Object.keys(typeLabels).map((type) => {
          const amount = totals[type] || 0;
          const percent = total ? Math.round((amount / total) * 100) : 0;
          return (
            <div className="budget-row" key={type}>
              <strong>{typeLabels[type]}</strong>
              <div className="budget-bar">
                <span style={{ width: `${percent}%`, background: typeColors[type] }} />
              </div>
              <span>{formatMoney(amount)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PackList({ canEdit, items, onAdd, onDelete, onToggle }) {
  const [title, setTitle] = useState("");
  return (
    <section className="panel">
      <div className="panel-heading tight">
        <div>
          <p className="eyebrow">Pack</p>
          <h3>打包清單</h3>
        </div>
      </div>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          onAdd(title);
          setTitle("");
        }}
      >
        <input
          disabled={!canEdit}
          placeholder="新增項目"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button className="icon-button small" disabled={!canEdit} type="submit" title="新增清單">
          +
        </button>
      </form>
      <div className="pack-list">
        {items.map((item) => (
          <div className={`pack-item${item.done ? " done" : ""}`} key={item.id}>
            <input checked={item.done} disabled={!canEdit} type="checkbox" onChange={() => onToggle(item)} />
            <span>{item.title}</span>
            <button className="mini-button" disabled={!canEdit} type="button" onClick={() => onDelete(item.id)}>
              X
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function MembersPanel({ isOwner, members, onApprove, onReject }) {
  return (
    <section className="panel">
      <div className="panel-heading tight">
        <div>
          <p className="eyebrow">Members</p>
          <h3>成員</h3>
        </div>
      </div>
      <div className="member-list">
        {members.map((member) => (
          <div className="member-row" key={member.id}>
            <div>
              <strong>{member.display_name || member.email || member.user_id}</strong>
              <span>
                {member.role === "owner" ? "擁有者" : "編輯者"} ·{" "}
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

function TripDialog({ form, onChange, onClose, onSubmit }) {
  return (
    <div className="modal-backdrop">
      <form className="dialog-card" onSubmit={onSubmit}>
        <h2>新增旅程</h2>
        <label>
          旅程名稱
          <input
            required
            value={form.title}
            onChange={(event) => onChange({ ...form, title: event.target.value })}
          />
        </label>
        <label>
          目的地
          <input
            required
            value={form.destination}
            onChange={(event) => onChange({ ...form, destination: event.target.value })}
          />
        </label>
        <div className="field-group form-grid wide">
          <label>
            開始日期
            <input
              required
              type="date"
              value={form.start_date}
              onChange={(event) => onChange({ ...form, start_date: event.target.value })}
            />
          </label>
          <label>
            結束日期
            <input
              required
              type="date"
              value={form.end_date}
              onChange={(event) => onChange({ ...form, end_date: event.target.value })}
            />
          </label>
        </div>
        <div className="form-actions">
          <button className="ghost-button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary-button compact" type="submit">
            建立
          </button>
        </div>
      </form>
    </div>
  );
}

function InviteDialog({ trip, onClose }) {
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);

  async function createInvite() {
    let nextToken = token;
    if (!nextToken) {
      nextToken = crypto.randomUUID();
      const { error } = await supabase.from("trip_invites").insert({
        trip_id: trip.id,
        token: nextToken,
      });
      if (error) {
        window.alert(error.message);
        return;
      }
      setToken(nextToken);
    }
    const url = `${window.location.origin}?invite=${nextToken}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
  }

  const inviteUrl = token ? `${window.location.origin}?invite=${token}` : "";

  return (
    <div className="modal-backdrop">
      <div className="dialog-card">
        <h2>邀請朋友</h2>
        <p>朋友使用連結登入後會送出加入申請，核准後即可共同編輯。</p>
        {inviteUrl ? <input readOnly value={inviteUrl} /> : null}
        {copied ? <div className="notice">邀請連結已複製。</div> : null}
        <div className="form-actions">
          <button className="ghost-button" type="button" onClick={onClose}>
            關閉
          </button>
          <button className="primary-button compact" type="button" onClick={createInvite}>
            產生並複製連結
          </button>
        </div>
      </div>
    </div>
  );
}
