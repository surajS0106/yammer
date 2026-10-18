import { BarChart3, BookA, CircleHelp, History, Home, NotebookPen, Scissors, Settings, Wand2 } from "lucide-react";
import * as React from "react";

import { Segmented } from "@/components/ui";
import { CleanupPage } from "@/pages/cleanup";
import { DictionaryPage } from "@/pages/dictionary";
import { EnginePage } from "@/pages/engine";
import { GeneralPage } from "@/pages/general";
import { HelpPage } from "@/pages/help";
import { HistoryPage } from "@/pages/history";
import { HomePage } from "@/pages/home";
import { InsightsPage } from "@/pages/insights";
import { ScratchpadPage } from "@/pages/scratchpad";
import { SnippetsPage } from "@/pages/snippets";
import { TransformsPage } from "@/pages/transforms";
import { api, on, type Platform } from "@/lib/tauri";
import { cn } from "@/lib/utils";

export type PageId =
  | "home"
  | "insights"
  | "dictionary"
  | "snippets"
  | "transforms"
  | "scratchpad"
  | "history"
  | "general"
  | "engine"
  | "cleanup"
  | "help";

type NavItem = { id: PageId; label: string; icon: React.ElementType };

const pages: NavItem[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "insights", label: "Insights", icon: BarChart3 },
  { id: "dictionary", label: "Dictionary", icon: BookA },
  { id: "snippets", label: "Snippets", icon: Scissors },
  { id: "transforms", label: "Transforms", icon: Wand2 },
  { id: "scratchpad", label: "Scratchpad", icon: NotebookPen },
  { id: "history", label: "History", icon: History },
];

/** The three settings pages share one nav entry and switch with tabs. */
const settingsTabs: { value: "general" | "engine" | "cleanup"; label: string }[] = [
  { value: "general", label: "General" },
  { value: "engine", label: "Speech engine" },
  { value: "cleanup", label: "AI cleanup" },
];
const isSettings = (id: PageId) => settingsTabs.some((t) => t.value === id);

const footer: (NavItem & { active: (page: PageId) => boolean })[] = [
  { id: "general", label: "Settings", icon: Settings, active: isSettings },
  { id: "help", label: "Help", icon: CircleHelp, active: (p) => p === "help" },
];

/** Pages that lay out dashboards or card grids get more room; forms and lists stay at a readable measure. */
const widePages = new Set<PageId>(["insights", "help"]);

const allIds = new Set<string>([...pages.map((p) => p.id), ...settingsTabs.map((t) => t.value), "help"]);

export const PlatformContext = React.createContext<Platform | null>(null);

export default function App() {
  const [page, setPage] = React.useState<PageId>("home");
  const [platform, setPlatform] = React.useState<Platform | null>(null);

  React.useEffect(() => {
    const unlisten = on.navigate((id) => {
      if (allIds.has(id)) setPage(id as PageId);
    });
    return () => void unlisten.then((f) => f());
  }, []);

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
        {/* Below md the sidebar collapses to an icon rail so narrow windows keep their width for content. */}
        <nav className="flex w-14 shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-sidebar p-2 md:w-52 md:p-3">
          <div className="mb-4 flex items-center justify-center gap-2 pt-1 md:justify-start md:px-2">
            <img src="/larp-mark.png" alt="" className="size-6" />
            <span className="sr-only text-xl font-semibold tracking-tight md:not-sr-only">Larp</span>
          </div>
          {pages.map((item) => (
            <NavButton key={item.id} item={item} active={page === item.id} onClick={() => setPage(item.id)} />
          ))}
          <div className="mt-auto space-y-0.5 border-t pt-3">
            {footer.map((item) => (
              <NavButton key={item.id} item={item} active={item.active(page)} onClick={() => setPage(item.id)} />
            ))}
          </div>
        </nav>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
            <div className={cn("@container mx-auto w-full", widePages.has(page) ? "max-w-6xl" : "max-w-3xl")}>
              {isSettings(page) && (
                <div className="mb-6">
                  <Segmented value={page as (typeof settingsTabs)[number]["value"]} options={settingsTabs} onChange={setPage} />
                </div>
              )}
              {page === "home" && <HomePage go={setPage} />}
              {page === "insights" && <InsightsPage go={setPage} />}
              {page === "dictionary" && <DictionaryPage />}
              {page === "snippets" && <SnippetsPage />}
              {page === "transforms" && <TransformsPage go={setPage} />}
              {page === "scratchpad" && <ScratchpadPage go={setPage} />}
              {page === "history" && <HistoryPage />}
              {page === "general" && <GeneralPage />}
              {page === "engine" && <EnginePage go={setPage} />}
              {page === "cleanup" && <CleanupPage />}
              {page === "help" && <HelpPage go={setPage} />}
            </div>
          </div>
        </main>
      </div>
    </PlatformContext.Provider>
  );
}

function NavButton({ item: { label, icon: Icon }, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={label}
      className={cn(
        "flex w-full items-center justify-center gap-2.5 rounded-md p-2 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:justify-start md:px-2.5 md:py-1.5",
        active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="sr-only truncate md:not-sr-only">{label}</span>
    </button>
  );
}

export function PageHeader({ title, description }: { title: string; description?: React.ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="text-xl font-semibold tracking-tight text-balance">{title}</h1>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </header>
  );
}
