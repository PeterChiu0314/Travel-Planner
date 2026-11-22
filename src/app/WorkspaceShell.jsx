export function Shell({ appLayout = false, children, collapsed = false }) {
  return <div className={`app-shell${appLayout ? " app-shell-workspace" : ""}${collapsed ? " sidebar-collapsed" : ""}`}>{children}</div>;
}

export function ConfigMissing() {
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

export function LoginView({ onSignIn }) {
  return (
    <section className="login-view">
      <div className="login-panel">
        <p className="eyebrow">Travel Planner</p>
        <h1>一起把旅程排好</h1>
        <p>使用 Google 登入後，就能建立旅程、邀請朋友、等待擁有者核准並即時共同編輯。</p>
        <button className="primary-button" type="button" onClick={onSignIn}>
          使用 Google 登入
        </button>
        <div className="demo-login-entry">
          <a className="ghost-button demo-login-link" href="/demo/timeline">
            查看 Demo 頁面
          </a>
          <span>不需登入，使用展示資料。</span>
        </div>
      </div>
    </section>
  );
}

export function EmptyState({ onCreate }) {
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
