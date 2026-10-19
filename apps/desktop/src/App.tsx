import { getCurrentWindow } from "@tauri-apps/api/window";
import { BarChart3, BookA, CircleHelp, Copy, History, Home, Minus, NotebookPen, PanelLeft, Scissors, Settings, Square, Wand2, X } from "lucide-react";
import { MotionConfig, motion } from "motion/react";
import * as React from "react";

import { spring } from "@/components/motion";
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

/** Known synchronously, so the title bar lays out right on first paint. */
const isMac = navigator.userAgent.includes("Mac");

const COLLAPSED_KEY = "sidebar-collapsed";

export const PlatformContext = React.createContext<Platform | null>(null);

export default function App() {
  const [page, setPage] = React.useState<PageId>("home");
  const [platform, setPlatform] = React.useState<Platform | null>(null);
  const [collapsed, setCollapsed] = React.useState(() => localStorage.getItem(COLLAPSED_KEY) === "1");
  const scroller = React.useRef<HTMLDivElement>(null);

  // A newly opened page starts at the top, so its entrance plays where you can see it.
  // (Braces matter: Chromium's scrollTo returns a Promise, which React would take for a cleanup function.)
  React.useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [page]);

  React.useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  // Ctrl+B (⌘B on macOS) shows and hides the sidebar.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((isMac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      <MotionConfig reducedMotion="user">
        <div className="flex h-svh">
          {/* Ctrl+B slides the sidebar away. The wrapper animates its width while the nav keeps
              a fixed one, so labels clip instead of reflowing. `inert` keeps a hidden sidebar out of the tab order. */}
          <div
            inert={collapsed}
            className={cn(
              "shrink-0 overflow-hidden transition-[width] duration-300 ease-smooth motion-reduce:transition-none",
              collapsed ? "w-0" : "w-52",
            )}
          >
            <nav
              className={cn(
                "flex h-full w-52 flex-col gap-0.5 overflow-y-auto border-r bg-sidebar p-3 transition-[opacity,translate] duration-300 ease-smooth motion-reduce:transition-none",
                collapsed && "-translate-x-4 opacity-0",
              )}
            >
              {/* No native title bar: on macOS this strip sits under the traffic lights. */}
              {isMac && <div data-tauri-drag-region className="h-7 shrink-0" />}
              <div data-tauri-drag-region className="mb-4 flex items-center gap-2 px-2 pt-1">
                <img src="/yammer-mark.png" alt="" className="pointer-events-none size-6" />
                <span className="pointer-events-none text-xl font-semibold tracking-tight">Yammer</span>
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
          </div>
          <main className="flex min-w-0 flex-1 flex-col">
            {/* With the sidebar hidden, the macOS traffic lights sit at the left of this bar. */}
            <TitleBar
              className={cn("transition-[padding] duration-300 ease-smooth motion-reduce:transition-none", isMac && collapsed && "pl-20")}
              onToggleSidebar={() => setCollapsed((c) => !c)}
            />
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
              <div className="px-4 pt-2 pb-6 sm:px-6 sm:pt-4 sm:pb-8 lg:px-10">
                <div className={cn("@container mx-auto w-full", widePages.has(page) ? "max-w-6xl" : "max-w-3xl")}>
                  {isSettings(page) && (
                    <div className="mb-6">
                      <Segmented value={page as (typeof settingsTabs)[number]["value"]} options={settingsTabs} onChange={setPage} />
                    </div>
                  )}
                  {/* Keyed so each page mounts fresh and its blocks rise in (.page-enter in index.css). */}
                  <div key={page} className="page-enter">
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
              </div>
            </div>
          </main>
        </div>
      </MotionConfig>
    </PlatformContext.Provider>
  );
}

/** Drag strip standing in for the native title bar: the sidebar toggle, and off macOS the window buttons. */
function TitleBar({ className, onToggleSidebar }: { className?: string; onToggleSidebar: () => void }) {
  const [maximized, setMaximized] = React.useState(false);

  React.useEffect(() => {
    if (isMac) return;
    const win = getCurrentWindow();
    const sync = () => void win.isMaximized().then(setMaximized, () => {});
    sync();
    const unlisten = win.onResized(sync);
    return () => void unlisten.then((f) => f());
  }, []);

  const win = getCurrentWindow;
  return (
    <div data-tauri-drag-region className={cn("flex h-9 shrink-0 items-center pl-2 select-none", className)}>
      <button
        type="button"
        onClick={onToggleSidebar}
        title={`Toggle sidebar (${isMac ? "⌘" : "Ctrl+"}B)`}
        aria-label="Toggle sidebar"
        className="rounded-md p-1.5 text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <PanelLeft className="size-4" />
      </button>
      {!isMac && (
        <div className="ml-auto flex h-full">
          <WindowButton label="Minimize" onClick={() => void win().minimize()}>
            <Minus className="size-4" />
          </WindowButton>
          <WindowButton label={maximized ? "Restore" : "Maximize"} onClick={() => void win().toggleMaximize()}>
            {maximized ? <Copy className="size-3.5 -scale-x-100" /> : <Square className="size-3.5" />}
          </WindowButton>
          <WindowButton label="Close" danger onClick={() => void win().close()}>
            <X className="size-4" />
          </WindowButton>
        </div>
      )}
    </div>
  );
}

function WindowButton({ label, danger, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "flex h-full w-11 items-center justify-center text-muted-foreground transition-colors outline-none focus-visible:bg-accent",
        danger ? "hover:bg-red-600 hover:text-white" : "hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function NavButton({ item: { label, icon: Icon }, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active ? "font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      {/* One highlight shared by every item, so it slides to the page you pick. */}
      {active && <motion.span layoutId="nav-active" transition={spring} className="absolute inset-0 rounded-md bg-sidebar-accent" />}
      <Icon className="relative size-4 shrink-0" />
      <span className="relative truncate">{label}</span>
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
