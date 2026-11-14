import { useEffect, useRef } from "react";
import { BadgeInfo, ChevronDown, ChevronUp, LogOut, Settings } from "lucide-react";

export default function SidebarAccountMenu({
  collapsed = false,
  email = "",
  initial = "?",
  isOpen,
  name,
  onClose,
  onSettings,
  onSignOut,
  onToggle,
  onVersion,
  settingsDisabled = false,
  signOutDisabled = false,
}) {
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    function handlePointerDown(event) {
      if (!menuRef.current || menuRef.current.contains(event.target)) return;
      onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpen, onClose]);

  return (
    <div className="user-box" ref={menuRef}>
      {isOpen ? (
        <div className="account-menu" role="menu" aria-label="帳號選單">
          <button
            className="account-menu-item"
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onVersion();
            }}
          >
            <BadgeInfo size={16} aria-hidden="true" strokeWidth={2.2} />
            <span>版本</span>
          </button>
          <button
            className="account-menu-item"
            type="button"
            role="menuitem"
            disabled={settingsDisabled}
            onClick={() => {
              onClose();
              onSettings();
            }}
          >
            <Settings size={16} aria-hidden="true" strokeWidth={2.2} />
            <span>設定</span>
          </button>
          <div className="account-menu-separator" aria-hidden="true" />
          <button
            className="account-menu-item"
            type="button"
            role="menuitem"
            disabled={signOutDisabled}
            onClick={() => {
              onClose();
              onSignOut();
            }}
          >
            <LogOut size={16} aria-hidden="true" strokeWidth={2.2} />
            <span>登出</span>
          </button>
        </div>
      ) : null}
      <button
        className="user-box-card"
        type="button"
        title="帳號選單"
        aria-label="帳號選單"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={onToggle}
      >
        <span className="user-avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="user-account">
          <strong className="nav-label">{name}</strong>
          {email ? <span className="user-email nav-label">{email}</span> : null}
        </span>
        <span className="account-menu-arrow" aria-hidden="true">
          {collapsed ? null : isOpen ? <ChevronDown size={16} strokeWidth={2.2} /> : <ChevronUp size={16} strokeWidth={2.2} />}
        </span>
      </button>
    </div>
  );
}
