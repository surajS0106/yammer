import * as React from "react";

import { PageHeader, PlatformContext, type PageId } from "@/App";
import { NavCards } from "@/components/nav-cards";
import { Button, Hotkey, Kbd, Row, Section } from "@/components/ui";
import { useSettings } from "@/lib/settings";
import { hotkeyParts, isAndroid } from "@/lib/utils";

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
  const { settings, update } = useSettings();
  const platform = React.useContext(PlatformContext);
  const paste = platform?.os === "macos" ? "⌘V" : "Ctrl+V";

  return (
    <div className="space-y-6">
      <PageHeader title="Help" description={`Yammer ${platform ? `v${platform.version}` : ""} · a product of Sush`} />

      <NavCards
        go={go}
        className={isAndroid ? "grid-cols-2" : "@2xl:grid-cols-2 @5xl:grid-cols-4"}
        cards={[
          { to: "home", title: "Dictate", description: isAndroid ? "Tap Sushi, talk, and tap again. Your words go into the text box you’re in." : `Hold ${hotkeyParts(settings.hotkey).join(" ")}, talk, let go. Tap it instead to keep talking hands-free.` },
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

      {!isAndroid && <Section title="Shortcuts">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2.5 text-sm">
          Hold to talk, or tap to start and tap again to finish <Hotkey accelerator={settings.hotkey} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2.5 text-sm">
          Cancel a dictation <Kbd>Esc</Kbd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2.5 text-sm">
          Paste the last dictation if it was only copied <Kbd>{paste}</Kbd>
        </div>
      </Section>}

      <Section title="Updates">
        <Row label="What's new" description="See what changed in each version of Yammer.">
          <Button size="sm" variant="outline" onClick={() => go("changelog")}>
            Open
          </Button>
        </Row>
      </Section>

      <Section title="Setup">
        <Row label="Setup guide" description={isAndroid ? "Walk through the speech service and permissions again, step by step." : "Walk through the speech engine, permissions and hotkey again, step by step."}>
          <Button size="sm" variant="outline" onClick={() => void update({ onboarded: false })}>
            Run setup again
          </Button>
        </Row>
      </Section>

      <Section title="Troubleshooting">
        <Item q="Nothing gets pasted">
          {isAndroid ? (
            <>Turn on “Paste for you” in <Link to="general" go={go}>Settings → General</Link>. Without it your words are copied, and you paste them yourself. </>
          ) : platform?.os === "macos" ? (
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
        {!isAndroid && <Item q="The hotkey doesn’t do anything">
          Another app may have claimed it. Pick a different one in <Link to="general" go={go}>Settings → General</Link>.
        </Item>}
        <Item q="Transcription is slow">
          {isAndroid ? "Try another service or model" : "Try a smaller on-device model, or a cloud engine,"} in <Link to="engine" go={go}>Settings → Speech engine</Link>. AI cleanup and transforms add a moment too.
        </Item>
        <Item q="Where is my data?">
          {isAndroid
            ? "History, meetings, settings and Scratchpad notes stay in Yammer’s private storage on this phone, and API keys are encrypted there with a key the Android Keystore holds. Your audio goes to your speech service for each dictation and while a meeting is transcribed. Text goes to your AI cleanup service only with AI cleanup, or when a meeting’s notes are written."
            : "History, meetings, settings and Scratchpad notes stay on this computer. API keys are in your system keychain. Audio leaves the computer only with a cloud speech engine or a streaming meeting engine, and text only with AI cleanup or when a meeting’s notes are written."}
        </Item>
        {isAndroid && (
          <Item q="What does “Paste for you” do?">
            It’s an Accessibility service. When a dictation finishes, Yammer finds the text box you’re in and pastes into it. It never pastes
            into password fields, doesn’t read or keep anything else on your screen, and clears the clipboard after pasting. Without it, the
            words are copied for you to paste.
          </Item>
        )}
        <Item q="Can I transcribe a meeting without telling people?">
          Tell everyone at the start that you’re transcribing, and stop if anyone objects. Recording people without their consent is against
          the law in many places.
        </Item>
      </Section>
    </div>
  );
}
