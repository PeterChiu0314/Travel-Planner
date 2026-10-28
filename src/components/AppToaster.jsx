import { useEffect, useRef, useState } from "react";
import { Toaster } from "sonner";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import "./app-toaster.css";

export default function AppToaster() {
  const region = useRef(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    const element = region.current;
    let previous;
    const focus = event => { if (!element.contains(event.relatedTarget)) previous = event.relatedTarget; };
    const key = event => {
      if (event.key === "Escape" && previous?.isConnected) {
        event.preventDefault(); event.stopPropagation(); previous.focus({ preventScroll: true });
      }
    };
    element.addEventListener("focusin", focus); element.addEventListener("keydown", key);
    return () => { element.removeEventListener("focusin", focus); element.removeEventListener("keydown", key); };
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setKeyboardInset(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop));
    update(); viewport.addEventListener("resize", update); viewport.addEventListener("scroll", update);
    return () => { viewport.removeEventListener("resize", update); viewport.removeEventListener("scroll", update); };
  }, []);
  return <Toaster ref={region} position="bottom-center" theme="light" closeButton visibleToasts={keyboardInset > 0 ? 1 : 3} expand gap={10}
    className="app-toaster" customAriaLabel="通知（Alt+T）" hotkey={["altKey", "KeyT"]}
    offset={{ bottom: "var(--app-toast-bottom)" }} mobileOffset={{ bottom: "var(--app-toast-bottom)", left: 16, right: 16 }}
    style={{ "--width": "min(420px, calc(100vw - 32px))", "--app-keyboard-inset": `${keyboardInset}px` }}
    toastOptions={{ closeButtonAriaLabel: "關閉通知" }}
    icons={{ success: <CircleCheck size={18} />, info: <Info size={18} />, warning: <TriangleAlert size={18} />, error: <CircleAlert size={18} />, close: <X size={14} /> }} />;
}
