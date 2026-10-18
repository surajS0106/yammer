import { AudioLines, History, Home, Settings2, Sparkles } from "lucide-react";
import * as React from "react";

import { CleanupPage } from "@/pages/cleanup";
import { EnginePage } from "@/pages/engine";
import { GeneralPage } from "@/pages/general";
import { HistoryPage } from "@/pages/history";
import { HomePage } from "@/pages/home";
import { api, type Platform } from "@/lib/tauri";
import { cn } from "@/lib/utils";

export type PageId = "home" | "general" | "engine" | "cleanup" | "history";

const pages: { id: PageId; label: string; icon: React.ElementType }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "general", label: "General", icon: Settings2 },
  { id: "engine", label: "Speech engine", icon: AudioLines },
  { id: "cleanup", label: "AI cleanup", icon: Sparkles },
  { id: "history", label: "History", icon: History },
];

export const PlatformContext = React.createContext<Platform | null>(null);

export default function App() {
  const [page, setPage] = React.useState<PageId>("home");
  const [platform, setPlatform] = React.useState<Platform | null>(null);

  React.useEffect(() => {
    const load = () => api.platformInfo().then(setPlatform, () => {});
    load();
    // Permissions are granted in System Settings; re-check when the user comes back.
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, []);

  return (
    <PlatformContext.Provider value={platform}>
      <div className="flex h-svh">
        <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r bg-sidebar p-3">
          <div className="mb-4 flex items-center gap-2 px-2 pt-1">
            <img src="/larp-icon-light.png" alt="" className="size-6 rounded-md dark:hidden" />
            <img src="/larp-icon-dark.png" alt="" className="hidden size-6 rounded-md dark:block" />
            <span className="font-semibold tracking-tight">Larp</span>
          </div>
          {pages.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setPage(id)}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                page === id
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
          <div className="mt-auto px-2 text-[11px] text-muted-foreground">{platform && `v${platform.version}`}</div>
        </nav>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-8 py-8">
            {page === "home" && <HomePage go={setPage} />}
            {page === "general" && <GeneralPage />}
            {page === "engine" && <EnginePage />}
            {page === "cleanup" && <CleanupPage />}
            {page === "history" && <HistoryPage />}
          </div>
        </main>
      </div>
    </PlatformContext.Provider>
  );
}

export function PageHeader({ title, description }: { title: string; description?: React.ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </header>
  );
}
