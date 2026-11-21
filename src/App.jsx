import { hasSupabaseConfig } from "./lib/supabase.js";
import { shareTokenFromUrl, demoSectionFromPath } from "./app/entryRoutes.js";
import { FormalWorkspace } from "./app/FormalWorkspace.jsx";
import { Shell, ConfigMissing } from "./app/WorkspaceShell.jsx";
import { DemoApp } from "./demo/DemoApp.jsx";
import { PublicShare } from "./components/share/PublicShare.jsx";

export default function App() {
  const demoSection = demoSectionFromPath();
  if (demoSection) return <DemoApp initialSection={demoSection} />;
  if (!hasSupabaseConfig) return <Shell><ConfigMissing /></Shell>;
  const token = shareTokenFromUrl();
  if (token) return <PublicShare token={token} />;
  return <FormalWorkspace />;
}
