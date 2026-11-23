import { ArrowCounterClockwise, Check, Question } from "@phosphor-icons/react";
import * as React from "react";

import { PlatformContext, type PageId } from "@/App";
import { AndroidPermissions } from "@/components/android-panel";
import { HotkeyRecorder } from "@/components/hotkey-recorder";
import { SettingsHero } from "@/components/settings-hero";
import { Button, Row, Section, Segmented, Select, Switch } from "@/components/ui";
import { useSettings } from "@/lib/settings";
import { api, errorMessage, type OtherAudio, type Theme } from "@/lib/tauri";
import { isAndroid, isMac } from "@/lib/utils";

// 0 means none for recordings and forever for days, so it goes first in one list and last in the other.
const RECORDINGS = [0, 10, 20, 50, 100];
const DAYS = [7, 30, 90, 365, 0];

/** The choices, plus `current` among the others if a hand-edited settings file holds another value. */
function withCurrent(choices: number[], current: number) {
  if (choices.includes(current)) return choices;
  const at = choices.findIndex((n) => n > current);
  return at < 0 ? [...choices, current] : [...choices.slice(0, at), current, ...choices.slice(at)];
}

export function GeneralPage({ go }: { go: (page: PageId) => void }) {
  const { settings, update, toast } = useSettings();
  const platform = React.useContext(PlatformContext);
  const [devices, setDevices] = React.useState<string[]>([]);
  const [checkingAudio, setCheckingAudio] = React.useState(false);
  const [autostart, setAutostart] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    api.micDevices().then(setDevices, () => { });
    api.autostartGet().then(setAutostart, () => setAutostart(null));
  }, []);

  const toggleAutostart = async (enabled: boolean) => {
    try {
      await api.autostartSet(enabled);
      setAutostart(enabled);
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const setOtherAudio = async (otherAudio: OtherAudio) => {
    if (checkingAudio) return;
    if (otherAudio === "ignore") {
      setCheckingAudio(true);
      try {
        await api.referenceCheck();
      } catch (e) {
        toast(errorMessage(e));
        return;
      } finally {
        setCheckingAudio(false);
      }
    }
    await update({ otherAudio });
  };

  if (isAndroid) {
    const tile = "flex min-w-0 flex-col justify-between gap-3 rounded-3xl border bg-card p-4";
    return (
      <div className="space-y-6">
        <AndroidPermissions />
        <section className="grid grid-cols-2 gap-3">
          <div className={tile}>
            <span className="text-sm leading-snug font-semibold">Keep recordings</span>
            <Select
              label="Keep recordings"
              value={settings.keepRecordings}
              onChange={(keepRecordings) => void update({ keepRecordings })}
              options={withCurrent(RECORDINGS, settings.keepRecordings).map((n) => ({ value: n, label: n ? `Latest ${n}` : "Don’t keep" }))}
            />
          </div>
          <div className={tile}>
            <span className="text-sm leading-snug font-semibold">Keep dictations</span>
            <Select
              label="Keep dictations"
              value={settings.historyDays}
              onChange={(historyDays) => void update({ historyDays })}
              options={withCurrent(DAYS, settings.historyDays).map((n) => ({ value: n, label: n === 0 ? "Forever" : n === 365 ? "For a year" : `For ${n} days` }))}
            />
          </div>
          <div className={`col-span-2 ${tile}`}>
            <span className="text-sm font-semibold">Appearance</span>
            <Segmented<Theme>
              fill
              value={settings.theme}
              options={[
                { value: "system", label: "System" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
              onChange={(theme) => void update({ theme })}
            />
          </div>
          <label className={`col-span-2 flex-row items-center ${tile}`}>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Add a space after</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">So consecutive dictations don’t run into each other.</span>
            </span>
            <Switch checked={settings.trailingSpace} onChange={(trailingSpace) => void update({ trailingSpace })} label="Add a space after" />
          </label>
          <button type="button" onClick={() => go("help")} className={`text-left outline-none active:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 ${tile}`}>
            <Question className="size-6.5 text-primary" />
            <span>
              <span className="block text-sm font-semibold">Help</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">And what’s new</span>
            </span>
          </button>
          <button type="button" onClick={() => void update({ onboarded: false })} className={`text-left outline-none active:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 ${tile}`}>
            <ArrowCounterClockwise className="size-6.5 text-primary" />
            <span>
              <span className="block text-sm font-semibold">Setup guide</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">Walk through it again</span>
            </span>
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsHero title="General" description="Your hotkeys and microphone, what Yammer keeps, and how it looks." />

      <Section title="Dictation">
        <Row
          label="Hotkey"
          description={
            platform?.gnomeShortcut
              ? "Added to GNOME's keyboard shortcuts. Tap to start, tap again to finish; Esc cancels."
              : platform?.wayland
              ? "Wayland only delivers this to X11 apps. Bind a system shortcut to `yammer --toggle` instead."
              : "Hold to talk, or tap to start and tap again to finish."
          }
        >
          <HotkeyRecorder value={settings.hotkey} onChange={(hotkey) => update({ hotkey })} />
        </Row>
        <Row
          label="Edit by voice"
          description="Select text in any app, hold this, and say how to change it: “make it shorter”, “turn this into bullet points”, “translate to Spanish”. Uses your AI cleanup model."
        >
          <HotkeyRecorder value={settings.editHotkey} onChange={(editHotkey) => update({ editHotkey })} onClear={() => void update({ editHotkey: "" })} />
        </Row>
        <Row label="Microphone" description="Falls back to the system default if this one is unplugged.">
          <Select
            className="w-64"
            label="Microphone"
            value={settings.micDevice ?? ""}
            onChange={(d) => void update({ micDevice: d || null })}
            onOpen={() => void api.micDevices().then(setDevices, () => { })}
            options={[
              { value: "", label: "System default" },
              ...devices.map((d) => ({ value: d, label: d })),
              ...(settings.micDevice && !devices.includes(settings.micDevice) ? [{ value: settings.micDevice, label: `${settings.micDevice} (not connected)` }] : []),
            ]}
          />
        </Row>
        <Row label="Always show the pill" description="Keep a small pill on screen between dictations, not only while recording.">
          <Switch
            checked={settings.overlayAlwaysVisible}
            onChange={(overlayAlwaysVisible) => void update({ overlayAlwaysVisible })}
            label="Always show the pill"
          />
        </Row>
        <Row
          label="Pill position"
          description={settings.overlayPosition ? "Where you dragged it. Double-click Sushi to put it back too." : "Bottom centre of the screen. Drag Sushi or the pill to move it."}
        >
          <Button size="sm" variant="ghost" disabled={!settings.overlayPosition} onClick={() => void update({ overlayPosition: null })}>
            Reset
          </Button>
        </Row>
        <Row label="Sounds" description="A short chime when recording starts and stops.">
          <Switch checked={settings.sounds} onChange={(sounds) => void update({ sounds })} label="Sounds" />
        </Row>
        <Row
          label="Other audio while you dictate"
          description={
            checkingAudio
              ? "Playing a chime to check Yammer can hear this computer’s sound…"
              : settings.otherAudio === "ignore"
                ? "Music, videos and calls keep playing, and Yammer takes them out of what you said. It can’t take out other sounds in the room."
                : settings.otherAudio === "mute"
                  ? "Music, videos and calls go silent while you dictate, and come back when you stop."
                  : "Music, videos and calls keep playing, and the microphone may pick them up."
          }
        >
          <Select<OtherAudio>
            className="w-56"
            label="Other audio while you dictate"
            value={settings.otherAudio}
            onChange={(otherAudio) => void setOtherAudio(otherAudio)}
            options={[
              { value: "leave", label: "Leave it on" },
              { value: "mute", label: "Mute it" },
              { value: "ignore", label: "Keep playing, but ignore it" },
            ]}
          />
        </Row>
      </Section>

      <Section title="Pasting">
        <Row label="Restore clipboard" description="Put back what was on your clipboard after pasting.">
          <Switch checked={settings.restoreClipboard} onChange={(restoreClipboard) => void update({ restoreClipboard })} label="Restore clipboard" />
        </Row>
        <Row label="Add a space after" description="So consecutive dictations don’t run into each other.">
          <Switch checked={settings.trailingSpace} onChange={(trailingSpace) => void update({ trailingSpace })} label="Add a space after" />
        </Row>
      </Section>

      <Section title="History">
        <Row label="Keep recordings" description="The audio of your latest dictations, so one that failed or came out wrong can be transcribed again from History.">
          <Select
            className="w-44"
            label="Keep recordings"
            value={settings.keepRecordings}
            onChange={(keepRecordings) => void update({ keepRecordings })}
            options={withCurrent(RECORDINGS, settings.keepRecordings).map((n) => ({ value: n, label: n ? `Latest ${n}` : "Don’t keep" }))}
          />
        </Row>
        <Row label="Keep dictations" description="Older dictations, and their recordings, are deleted.">
          <Select
            className="w-44"
            label="Keep dictations"
            value={settings.historyDays}
            onChange={(historyDays) => void update({ historyDays })}
            options={withCurrent(DAYS, settings.historyDays).map((n) => ({ value: n, label: n === 0 ? "Forever" : n === 365 ? "For a year" : `For ${n} days` }))}
          />
        </Row>
      </Section>

      <Section title="System">
        <Row label="Appearance" description="System follows your OS light/dark setting.">
          <Segmented<Theme>
            value={settings.theme}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            onChange={(theme) => void update({ theme })}
          />
        </Row>
        <Row label="Launch at login" description={`Starts quietly in the ${isMac ? "menu bar" : "tray"}.`}>
          <Switch checked={!!autostart} disabled={autostart === null} onChange={(v) => void toggleAutostart(v)} label="Launch at login" />
        </Row>
        <Row label="Setup guide" description="Walk through the first-run setup again. Your settings stay as they are.">
          <Button size="sm" variant="outline" onClick={() => void update({ onboarded: false })}>
            Show setup guide
          </Button>
        </Row>
        {platform?.os === "macos" && (
          <Row label="Permissions" description="Microphone to hear you; Accessibility to paste.">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => void api.openPermissionSettings("microphone")}>
                Microphone
              </button>
              <button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => void api.openPermissionSettings("accessibility")}>
                Accessibility {platform.accessibility && <Check aria-label="allowed" className="size-3" weight="bold" />}
              </button>
            </div>
          </Row>
        )}
      </Section>
    </div>
  );
}
