import * as React from "react";

import { PageHeader, PlatformContext } from "@/App";
import { HotkeyRecorder } from "@/components/hotkey-recorder";
import { Button, Row, Section, Select, Switch } from "@/components/ui";
import { useSettings } from "@/lib/settings";
import { api, errorMessage } from "@/lib/tauri";
import { isMac } from "@/lib/utils";

export function GeneralPage() {
  const { settings, update, toast } = useSettings();
  const platform = React.useContext(PlatformContext);
  const [devices, setDevices] = React.useState<string[]>([]);
  const [autostart, setAutostart] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    api.micDevices().then(setDevices, () => {});
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
            platform?.wayland
              ? "Wayland only delivers this to X11 apps. Bind a system shortcut to `larp --toggle` instead."
              : "Hold to talk, or tap to start and tap again to finish."
          }
        >
          <HotkeyRecorder value={settings.hotkey} onChange={(hotkey) => update({ hotkey })} />
        </Row>
        <Row label="Microphone" description="Falls back to the system default if this one is unplugged.">
          <Select
            className="w-56"
            value={settings.micDevice ?? ""}
            onChange={(e) => void update({ micDevice: e.target.value || null })}
            onFocus={() => void api.micDevices().then(setDevices, () => {})}
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
      </Section>

      <Section title="Pasting">
        <Row label="Restore clipboard" description="Put back what was on your clipboard after pasting.">
          <Switch checked={settings.restoreClipboard} onChange={(restoreClipboard) => void update({ restoreClipboard })} label="Restore clipboard" />
        </Row>
        <Row label="Add a space after" description="So consecutive dictations don’t run into each other.">
          <Switch checked={settings.trailingSpace} onChange={(trailingSpace) => void update({ trailingSpace })} label="Add a space after" />
        </Row>
      </Section>

      <Section title="System">
        <Row label="Launch at login" description={`Starts quietly in the ${isMac ? "menu bar" : "tray"}.`}>
          <Switch checked={!!autostart} disabled={autostart === null} onChange={(v) => void toggleAutostart(v)} label="Launch at login" />
        </Row>
        {platform?.os === "macos" && (
          <Row label="Permissions" description="Microphone to hear you; Accessibility to paste.">
            <div className="flex gap-2">
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
