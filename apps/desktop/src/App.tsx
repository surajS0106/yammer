import { getCurrentWindow } from "@tauri-apps/api/window";
import { CaretLeft as ChevronLeft, CaretRight as ChevronRight, Copy, Minus, SidebarSimple as PanelLeft, Square, X } from "@phosphor-icons/react";
import { MotionConfig } from "motion/react";
import * as React from "react";

import { BottomNav } from "@/components/bottom-nav";
import { navPageIds, Sidebar } from "@/components/sidebar";
import { Segmented } from "@/components/ui";
import { ChangelogPage } from "@/pages/changelog";
import { CleanupPage } from "@/pages/cleanup";
import { DictionaryPage } from "@/pages/dictionary";
import { EnginePage } from "@/pages/engine";
import { GeneralPage } from "@/pages/general";
import { HelpPage } from "@/pages/help";
import { HistoryPage } from "@/pages/history";
import { HomePage } from "@/pages/home";
import { InsightsPage } from "@/pages/insights";
import { Onboarding } from "@/pages/onboarding";
import { ScratchpadPage } from "@/pages/scratchpad";
import { SnippetsPage } from "@/pages/snippets";
import { TransformsPage } from "@/pages/transforms";
import { useBackKey } from "@/lib/back";
import { DockActionContext, type DockAction } from "@/lib/dock";
import { useSettings } from "@/lib/settings";
import { api, on, type Platform } from "@/lib/tauri";
import { cn, isMac, isPhone } from "@/lib/utils";

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
  | "help"
  | "changelog";

/** The three settings pages share one nav entry and switch with tabs. */
const settingsTabs: { value: PageId; label: string }[] = [
  { value: "general", label: "General" },
  { value: "engine", label: "Speech engine" },
  { value: "cleanup", label: "AI cleanup" },
];
const isSettings = (id: PageId) => settingsTabs.some((t) => t.value === id);

/** The phone's bottom nav has one Teach tab, so these switch the same way. */
const teachTabs: { value: PageId; label: string }[] = [
  { value: "dictionary", label: "Dictionary" },
  { value: "snippets", label: "Snippets" },
  { value: "transforms", label: "Transforms" },
];
const pageTabs = (id: PageId) => [settingsTabs, ...(isPhone ? [teachTabs] : [])].find((tabs) => tabs.some((t) => t.value === id));

/** Pages reached from inside another one: they get a back button and a breadcrumb trail up to it. The phone has no tab for Insights or Help. */
const pageParents: Partial<Record<PageId, PageId>> = isPhone
  ? { changelog: "help", help: "general", insights: "home", general: "home", engine: "home", cleanup: "home" }
  : { changelog: "help" };
const pageLabels: Partial<Record<PageId, string>> = { home: "Home", general: "Settings", help: "Help", insights: "Insights", changelog: "What's new" };

/** The page and its ancestors, outermost first. */
function trail(page: PageId): PageId[] {
  const parent = pageParents[page];
  return parent ? [...trail(parent), page] : [page];
}

/** Pages that lay out dashboards or card grids get more room; forms and lists stay at a readable measure. */
const widePages = new Set<PageId>(["insights", "help"]);

const allIds = new Set<string>([...navPageIds, ...settingsTabs.map((t) => t.value), "help", "changelog"]);

/** Known synchronously, so the title bar lays out right on first paint. */

const COLLAPSED_KEY = "sidebar-collapsed";

export const PlatformContext = React.createContext<Platform | null>(null);

export default function App() {
  const { settings, update } = useSettings();
  const [page, setPage] = React.useState<PageId>("home");
  const [platform, setPlatform] = React.useState<Platform | null>(null);
  const [collapsed, setCollapsed] = React.useState(() => localStorage.getItem(COLLAPSED_KEY) === "1");
  const scroller = React.useRef<HTMLDivElement>(null);
  const [dockAction, setDockAction] = React.useState<DockAction | null>(null);
  const tabs = pageTabs(page);
  // Home is one screen on a computer: the chain down to it takes the full height. A phone just scrolls.
  const fillHeight = page === "home" && !isPhone;

  // Back climbs to the parent page, or from any tab to Home, and from Home leaves the app.
  const path = trail(page);
  useBackKey(settings.onboarded ? path.length - (path[0] === "home" ? 1 : 0) : 0, () => setPage((p) => pageParents[p] ?? "home"));

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

  // A new install has nothing to catch up on: only versions after the one it started with count as new.
  React.useEffect(() => {
    if (!settings.onboarded && platform && settings.seenChangelog !== platform.version) void update({ seenChangelog: platform.version });
  }, [settings.onboarded, settings.seenChangelog, platform, update]);

  // First run: the setup guide takes the whole window until it's finished or skipped.
  if (!settings.onboarded) {
    return (
      <PlatformContext.Provider value={platform}>
        <MotionConfig reducedMotion="user">
          <div className="flex h-svh flex-col">
            {!isPhone && <TitleBar className={cn(isMac && "pl-20")} />}
            <Onboarding onDone={(next) => setPage(next ?? "home")} />
          </div>
        </MotionConfig>
      </PlatformContext.Provider>
    );
  }

  return (
    <PlatformContext.Provider value={platform}>
      <DockActionContext.Provider value={setDockAction}>
      <MotionConfig reducedMotion="user">
        <div className="relative flex h-svh overflow-hidden">
          {/* Ctrl+B slides the sidebar away. The wrapper animates its width while the nav keeps
              a fixed one, so labels clip instead of reflowing. `inert` keeps a hidden sidebar out of the tab order. */}
          {!isPhone && (
            <div inert={collapsed} className={cn("shrink-0 overflow-hidden transition-[width] duration-300 ease-smooth motion-reduce:transition-none", collapsed ? "w-0" : "w-56")}>
              <div
                className={cn(
                  "h-full transition-[opacity,translate] duration-300 ease-smooth motion-reduce:transition-none",
                  collapsed && "-translate-x-4 opacity-0",
                )}
              >
                <Sidebar page={trail(page)[0]} go={setPage} settingsActive={isSettings(page)} dragStrip={isMac} />
              </div>
            </div>
          )}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* With the sidebar hidden, the macOS traffic lights sit at the left of this bar. */}
            {!isPhone && (
              <TitleBar
                className={cn("transition-[padding] duration-300 ease-smooth motion-reduce:transition-none", isMac && collapsed && "pl-20")}
                onToggleSidebar={() => setCollapsed((c) => !c)}
              />
            )}
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
              {/* Home's Recent list scrolls inside this height. On a phone the bottom padding clears the dock. */}
              <div className={cn("relative px-4 pt-2 pb-6 sm:px-6 sm:pt-4 sm:pb-8 lg:px-10", isPhone && "pt-4 pb-24 sm:pb-24", fillHeight && "h-full")}>
                {/* Ambient backdrop behind every page: a soft coral glow at the top, so the canvas
                    isn't flat. Scrolls with the page. */}
                <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] overflow-hidden">
                  <div
                    className="absolute inset-0"
                    style={{
                      background:
                        "radial-gradient(50% 70% at 50% 0%, color-mix(in oklch, var(--brand) 9%, transparent), transparent 70%), radial-gradient(40% 50% at 85% 10%, color-mix(in oklch, var(--chart-1) 8%, transparent), transparent 70%)",
                    }}
                  />
                </div>
                <div
                  className={cn(
                    "@container relative mx-auto w-full",
                    widePages.has(page) ? "max-w-6xl" : page === "home" ? cn("max-w-4xl", fillHeight && "h-full") : "max-w-3xl",
                  )}
                >
                  {pageParents[page] && <Breadcrumbs trail={trail(page)} go={setPage} />}
                  {tabs && (
                    <div className="mb-6">
                      <Segmented value={page} options={tabs} onChange={setPage} fill={isPhone} />
                    </div>
                  )}
                  {/* Keyed so each page mounts fresh and its blocks rise in (.page-enter in index.css). */}
                  <div key={page} className={cn("page-enter", fillHeight && "h-full")}>
                    {page === "home" && <HomePage go={setPage} />}
                    {page === "insights" && <InsightsPage go={setPage} />}
                    {page === "dictionary" && <DictionaryPage />}
                    {page === "snippets" && <SnippetsPage />}
                    {page === "transforms" && <TransformsPage go={setPage} />}
                    {page === "scratchpad" && <ScratchpadPage go={setPage} />}
                    {page === "history" && <HistoryPage />}
                    {page === "general" && <GeneralPage go={setPage} />}
                    {page === "engine" && <EnginePage go={setPage} />}
                    {page === "cleanup" && <CleanupPage />}
                    {page === "help" && <HelpPage go={setPage} />}
                    {page === "changelog" && <ChangelogPage />}
                  </div>
                </div>
              </div>
            </div>
          </main>
          {isPhone && <BottomNav page={page} go={setPage} action={dockAction} />}
        </div>
      </MotionConfig>
      </DockActionContext.Provider>
    </PlatformContext.Provider>
  );
}

function Breadcrumbs({ trail, go }: { trail: PageId[]; go: (page: PageId) => void }) {
  const parent = trail[trail.length - 2];
  if (isPhone) {
    return (
      <button type="button" onClick={() => go(parent)} className="mb-2 -ml-2 flex h-11 items-center gap-1 pr-3 text-sm font-medium text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronLeft className="size-5" /> {pageLabels[parent]}
      </button>
    );
  }
  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm">
      <button
        type="button"
        onClick={() => go(parent)}
        title={`Back to ${pageLabels[parent]}`}
        aria-label={`Back to ${pageLabels[parent]}`}
        className="mr-1 rounded-md p-1 text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronLeft className="size-4" />
      </button>
      <ol className="flex min-w-0 items-center gap-1">
        {trail.map((id, i) => (
          <li key={id} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/60" />}
            {i < trail.length - 1 ? (
              <button
                type="button"
                onClick={() => go(id)}
                className="truncate rounded-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {pageLabels[id]}
              </button>
            ) : (
              <span aria-current="page" className="truncate font-medium">
                {pageLabels[id]}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Drag strip standing in for the native title bar: the sidebar toggle (when there's a sidebar), and off macOS the window buttons. */
function TitleBar({ className, onToggleSidebar }: { className?: string; onToggleSidebar?: () => void }) {
  const [maximized, setMaximized] = React.useState(false);

  React.useEffect(() => {
    if (isMac || isPhone) return;
    const win = getCurrentWindow();
    const sync = () => void win.isMaximized().then(setMaximized, () => {});
    sync();
    const unlisten = win.onResized(sync);
    return () => void unlisten.then((f) => f());
  }, []);

  const win = getCurrentWindow;
  return (
    <div data-tauri-drag-region className={cn("flex h-9 shrink-0 items-center pl-2 select-none", className)}>
      {onToggleSidebar && (
        <button
          type="button"
          onClick={onToggleSidebar}
          title={`Toggle sidebar (${isMac ? "⌘" : "Ctrl+"}B)`}
          aria-label="Toggle sidebar"
          className="rounded-md p-1.5 text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <PanelLeft className="size-4" />
        </button>
      )}
      {!isMac && !isPhone && (
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

export function PageHeader({ title, description }: { title: string; description?: React.ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="text-xl font-semibold tracking-tight text-balance">{title}</h1>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </header>
  );
}
