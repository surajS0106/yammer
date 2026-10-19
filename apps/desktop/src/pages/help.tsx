import * as React from "react";

import { PageHeader, PlatformContext, type PageId } from "@/App";
import { NavCards } from "@/components/nav-cards";
import { Hotkey, Kbd, Section } from "@/components/ui";
import { useSettings } from "@/lib/settings";
import { hotkeyParts } from "@/lib/utils";

function Item({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group px-4 py-3">
      <summary className="cursor-pointer list-none text-sm font-medium marker:hidden [&::-webkit-details-marker]:hidden">
        <span className="mr-2 inline-block text-muted-foreground transition-transform duration-300 group-open:rotate-90">›</span>
        {q}
      </summary>
      <div className="mt-2 animate-rise-in pl-4 text-xs leading-relaxed text-muted-foreground">{children}</div>
    </details>
  );
}

function Link({ to, go, children }: { to: PageId; go: (page: PageId) => void; children: React.ReactNode }) {
  return (
    <button type="button" className="font-medium text-primary hover:underline" onClick={() => go(to)}>
      {children}
    </button>
  );
}

export function HelpPage({ go }: { go: (page: PageId) => void }) {
  const { settings } = useSettings();
  const platform = React.useContext(PlatformContext);
  const paste = platform?.os === "macos" ? "⌘V" : "Ctrl+V";

  return (
    <div className="space-y-6">
      <PageHeader title="Help" description={`Yammer ${platform ? `v${platform.version}` : ""} · a product of Sush`} />

      <NavCards
        go={go}
        className="@2xl:grid-cols-2 @5xl:grid-cols-4"
        cards={[
          { to: "home", title: "Dictate", description: `Hold ${hotkeyParts(settings.hotkey).join(" ")}, talk, let go. Tap it instead to keep talking hands-free.` },
          { to: "dictionary", title: "Dictionary", description: "Get names, jargon and acronyms spelled right every time." },
          { to: "snippets", title: "Snippets", description: "Say a short trigger, paste a whole block of text." },
          { to: "transforms", title: "Transforms", description: "Turn what you say into an email, a list, or a tighter note." },
        ]}
      />

      <Section title="Things you can say" description="With AI cleanup on.">
        {[
          ["“scratch that” / “no wait” / “actually”", "Keeps only the correction."],
          ["“new line” / “new paragraph”", "Breaks the text there."],
          ["Saying a list (“first…, second…”)", "Formats it as a list."],
          ["A snippet trigger on its own", "Pastes the snippet, untouched."],
        ].map(([say, does]) => (
          <div key={say} className="flex flex-col gap-0.5 px-4 py-2.5 text-sm @md:flex-row @md:items-center @md:justify-between @md:gap-4">
            <span>{say}</span>
            <span className="text-xs text-muted-foreground @md:text-right">{does}</span>
          </div>
        ))}
      </Section>

      <Section title="Shortcuts">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2.5 text-sm">
          Hold to talk, or tap to start and tap again to finish <Hotkey accelerator={settings.hotkey} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2.5 text-sm">
          Cancel a dictation <Kbd>Esc</Kbd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2.5 text-sm">
          Paste the last dictation if it was only copied <Kbd>{paste}</Kbd>
        </div>
      </Section>

      <Section title="Troubleshooting">
        <Item q="Nothing gets pasted">
          {platform?.os === "macos" ? (
            <>
              Yammer needs Accessibility permission to press {paste} for you: System Settings → Privacy & Security → Accessibility.{" "}
            </>
          ) : platform?.wayland ? (
            <>On Wayland, install wtype or ydotool for auto-paste. Without them the text is copied and you press {paste}. </>
          ) : (
            <>Some apps running as administrator don’t accept pasted keystrokes. </>
          )}
          Either way, every dictation is kept in <Link to="history" go={go}>History</Link>.
        </Item>
        <Item q="It mishears a name or word">
          Add it to the <Link to="dictionary" go={go}>Dictionary</Link>. If it still comes out wrong, add a correction there.
        </Item>
        <Item q="The hotkey doesn’t do anything">
          Another app may have claimed it. Pick a different one in <Link to="general" go={go}>Settings → General</Link>.
        </Item>
        <Item q="Transcription is slow">
          Try a smaller on-device model, or a cloud engine, in <Link to="engine" go={go}>Settings → Speech engine</Link>. AI cleanup and transforms add a moment too.
        </Item>
        <Item q="Where is my data?">
          History, settings and Scratchpad notes stay on this computer. API keys are in your system keychain. Audio leaves the computer only with a cloud speech
          engine, and text only with AI cleanup.
        </Item>
      </Section>
    </div>
  );
}
