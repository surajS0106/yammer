import * as React from "react";

import { PageHeader, PlatformContext } from "@/App";
import { HotkeyRecorder } from "@/components/hotkey-recorder";
import { Button, Row, Section, Segmented, Select, Switch } from "@/components/ui";
import { useSettings } from "@/lib/settings";
import { api, errorMessage, type Theme } from "@/lib/tauri";
import { isMac } from "@/lib/utils";

// 0 means none for recordings and forever for days, so it goes first in one list and last in the other.
const RECORDINGS = [0, 10, 20, 50, 100];
const DAYS = [7, 30, 90, 365, 0];

/** The choices, plus `current` among the others if a hand-edited settings file holds another value. */
function withCurrent(choices: number[], current: number) {
  if (choices.includes(current)) return choices;
  const at = choices.findIndex((n) => n > current);
  return at < 0 ? [...choices, current] : [...choices.slice(0, at), current, ...choices.slice(at)];
}

export function GeneralPage() {
  const { settings, update, toast } = useSettings();
  const platform = React.useContext(PlatformContext);
  const [devices, setDevices] = React.useState<string[]>([]);
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

  return (
    <div className="space-y-6">
      <PageHeader title="General" />

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
            className="w-56"
            value={settings.micDevice ?? ""}
            onChange={(e) => void update({ micDevice: e.target.value || null })}
            onFocus={() => void api.micDevices().then(setDevices, () => { })}
          >
            <option value="">System default</option>
            {devices.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            {settings.micDevice && !devices.includes(settings.micDevice) && <option value={settings.micDevice}>{settings.micDevice} (not connected)</option>}
          </Select>
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
        <Row label="Mute other audio" description="Silence music, videos and calls while you dictate, so they don’t end up in the recording. Sound comes back when you stop.">
          <Switch checked={settings.muteAudio} onChange={(muteAudio) => void update({ muteAudio })} label="Mute other audio" />
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
          <Select className="w-44" value={settings.keepRecordings} onChange={(e) => void update({ keepRecordings: Number(e.target.value) })}>
            {withCurrent(RECORDINGS, settings.keepRecordings).map((n) => (
              <option key={n} value={n}>
                {n ? `Latest ${n}` : "Don’t keep"}
              </option>
            ))}
          </Select>
        </Row>
        <Row label="Keep dictations" description="Older dictations, and their recordings, are deleted.">
          <Select className="w-44" value={settings.historyDays} onChange={(e) => void update({ historyDays: Number(e.target.value) })}>
            {withCurrent(DAYS, settings.historyDays).map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "Forever" : n === 365 ? "For a year" : `For ${n} days`}
              </option>
            ))}
          </Select>
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
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => void api.openPermissionSettings("accessibility")}>
                Accessibility {platform.accessibility ? "✓" : ""}
              </button>
            </div>
          </Row>
        )}
      </Section>
    </div>
  );
}
