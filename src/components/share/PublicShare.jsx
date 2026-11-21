import ShareView from "./ShareView.jsx";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase.js";
import { Shell } from "../../app/WorkspaceShell.jsx";

export function PublicShare({ token }) {
  const [shareSnapshot, setShareSnapshot] = useState(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState("");
  useEffect(() => {

    async function loadShareSnapshot() {
      setShareLoading(true);
      setShareError("");
      const { data, error } = await supabase.rpc("get_share_snapshot", { share_token: token });
      if (error) {
        setShareError(error.message);
        setShareSnapshot(null);
      } else if (!data) {
        setShareError("這個分享連結已停用、過期，或不存在。");
        setShareSnapshot(null);
      } else {
        setShareSnapshot(data);
      }
      setShareLoading(false);
    }

    loadShareSnapshot();
  }, [token]);
  return <Shell><ShareView error={shareError} loading={shareLoading} snapshot={shareSnapshot} /></Shell>;
}
