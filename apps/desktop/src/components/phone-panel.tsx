// The phones' stand-ins for the hotkey: the Dictate button, the permissions it needs
// and, on Android, the Sushi bubble that floats over other apps. iOS has no bubble or
// paste, so its words are copied. The native sides are in
// src-tauri/gen/android/app/src/main/java/com/sush/yammer and src-tauri/gen/apple/Sources/yammer.

import { Bell, Check, ClipboardText, Microphone as Mic, CursorClick as MousePointerClick, PictureInPicture as PictureInPicture2, Square } from "@phosphor-icons/react";
import * as React from "react";

import { Badge, Button, Card, Notice, Sheet, Switch } from "@/components/ui";
import { useSettings } from "@/lib/settings";
import { api, errorMessage, type PhoneAction, type PhoneStatus } from "@/lib/tauri";
import { cn, isIOS } from "@/lib/utils";

const BUBBLE_KEY = "android-bubble";

function bubbleWanted(): boolean {
  try {
    return localStorage.getItem(BUBBLE_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberBubble(on: boolean) {
  try {
    localStorage.setItem(BUBBLE_KEY, on ? "1" : "0");
  } catch {
    // It just won't come back on by itself.
  }
}

/** Permissions are granted in Android's settings, so keep checking while this is on screen. */
export function usePhoneStatus(): PhoneStatus | null {
  const [status, setStatus] = React.useState<PhoneStatus | null>(null);
  React.useEffect(() => {
    const load = () => api.phoneStatus().then(setStatus, () => {});
    load();
    const timer = window.setInterval(load, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return status;
}

export function usePhoneAction() {
  const { toast } = useSettings();
  return React.useCallback((action: PhoneAction) => void api.phoneAction(action).catch((e) => toast(errorMessage(e))), [toast]);
}

function Permission({
  icon: Icon,
  title,
  optional,
  granted,
  action,
  onAllow,
  children,
}: {
  icon: React.ElementType;
  title: string;
  optional?: boolean;
  granted: boolean;
  action: string;
  onAllow: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex min-w-0 flex-col gap-3 rounded-3xl border bg-card p-4 text-left outline-none active:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50">
        <span className="flex w-full items-center justify-between">
          <Icon className="size-6.5 text-primary" weight={granted ? "fill" : "regular"} />
          {granted ? <Check className="size-5 text-emerald-500" weight="bold" /> : optional ? <Badge>Optional</Badge> : <Badge tone="warn">Not yet</Badge>}
        </span>
        <span className="text-sm leading-snug font-semibold">{title}</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <div className="space-y-4 px-3 pt-1">
          <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
          {granted ? (
            <p className="flex items-center gap-2 text-sm font-medium">
              <Check className="size-5 text-emerald-500" weight="bold" /> Allowed
            </p>
          ) : (
            <Button
              className="h-12 w-full rounded-2xl"
              onClick={() => {
                setOpen(false);
                onAllow();
              }}
            >
              {action}
            </Button>
          )}
        </div>
      </Sheet>
    </>
  );
}

/** iOS only asks for the microphone. Once it's refused, only the Settings app can change that. */
function IOSPermissions() {
  const status = usePhoneStatus();
  const act = usePhoneAction();
  return (
    <div className="grid gap-3">
      <Permission icon={Mic} title="Microphone" granted={!!status?.mic} action="Allow microphone" onAllow={() => act("requestMic")}>
        So Yammer can hear you. It only listens after you tap. If you said no before, this opens Settings, where you can switch it on.
      </Permission>
    </div>
  );
}

/** What Yammer needs from the phone, in the order that matters. */
export function PhonePermissions() {
  return isIOS ? <IOSPermissions /> : <AndroidPermissions />;
}

function AndroidPermissions() {
  const status = usePhoneStatus();
  const act = usePhoneAction();
  return (
    <div className="grid grid-cols-2 gap-3">
      <Permission icon={Mic} title="Microphone" granted={!!status?.mic} action="Allow microphone" onAllow={() => act("requestMic")}>
        So Yammer can hear you. It only listens after you tap.
      </Permission>
      <Permission icon={PictureInPicture2} title="Sushi over other apps" granted={!!status?.overlay} action="Open setting" onAllow={() => act("openOverlaySettings")}>
        So you can tap Sushi from any app. Find Yammer in the list and switch it on, then come back.
      </Permission>
      <Permission icon={MousePointerClick} title="Paste for you" optional granted={!!status?.accessibility} action="Open Accessibility settings" onAllow={() => act("openAccessibilitySettings")}>
        <p>Without it, your words are copied and you paste them yourself. Under Downloaded apps, pick Yammer and switch it on.</p>
        {!status?.accessibility && (
          <p>
            If Android says it’s a restricted setting,{" "}
            <button type="button" className="font-medium text-primary underline" onClick={() => act("openAppSettings")}>
              open Yammer’s app info
            </button>
            , tap ⋮ and choose Allow restricted settings.
          </p>
        )}
      </Permission>
      <Permission icon={Bell} title="Notifications" optional granted={!!status?.notifications} action="Allow notifications" onAllow={() => act("requestNotifications")}>
        Android requires a notification while Sushi is on. Allowing this lets you dictate and turn Sushi off from it.
      </Permission>
    </div>
  );
}

interface HeroProps {
  pill: React.ReactNode;
  sushi: React.ReactNode;
  side: React.ReactNode;
}

/** iOS's Home: dictation starts here, because no app can float over others, and the words are copied. */
function IOSHero({ pill, sushi, side }: HeroProps) {
  const status = usePhoneStatus();
  const act = usePhoneAction();
  return (
    <>
      <Card className="col-span-2 space-y-4 rounded-3xl border-primary/20 bg-primary/[0.06] p-5 dark:bg-primary/[0.08]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-3">
            {pill}
            <h2 className="text-2xl font-semibold tracking-tight text-balance">Tap Dictate and talk.</h2>
          </div>
          <div className="shrink-0">{sushi}</div>
        </div>
        <p className="text-sm leading-relaxed text-pretty text-muted-foreground">Tap again to finish, and your words are copied, ready to paste into any app.</p>
        <Button className={cn("h-14 w-full rounded-2xl text-base [&_svg]:size-5", status?.recording && "animate-pulse")} disabled={!status?.mic} onClick={() => act("toggle")}>
          {status?.recording ? <Square weight="fill" /> : <Mic weight="fill" />} {status?.recording ? "Finish" : "Dictate"}
        </Button>
      </Card>
      <div className="row-span-2 flex min-w-0 flex-col justify-between gap-6 rounded-3xl border bg-card p-4">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-primary/12 text-primary">
          <ClipboardText className="size-5.5" />
        </span>
        <span>
          <span className="block text-sm font-semibold">Paste anywhere</span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">Long-press any text box and choose Paste. Every dictation is in History too.</span>
        </span>
      </div>
      {side}
      {status && !status.mic && (
        <div className="col-span-2">
          <Notice tone="warn">
            Allow the microphone to start dictating.{" "}
            <button type="button" className="font-medium underline" onClick={() => act("requestMic")}>
              Allow
            </button>
          </Notice>
        </div>
      )}
    </>
  );
}

/** Home's first tiles on a phone: the Dictate button with Sushi and the status, then on Android the switch for Sushi over other apps, beside `side`. */
export function PhoneHero(props: HeroProps) {
  return isIOS ? <IOSHero {...props} /> : <AndroidHero {...props} />;
}

function AndroidHero({ pill, sushi, side }: HeroProps) {
  const status = usePhoneStatus();
  const act = usePhoneAction();
  const running = !!status?.running;
  const restored = React.useRef(false);

  // Android stops the service on a reboot, and only lets it start with the app on screen, as it is now.
  React.useEffect(() => {
    if (!status || restored.current) return;
    restored.current = true;
    if (bubbleWanted() && status.mic && !status.running) act("startBubble");
  }, [status, act]);

  const setBubble = (on: boolean) => {
    rememberBubble(on);
    act(on ? "startBubble" : "stopBubble");
  };

  return (
    <>
      <Card className="col-span-2 space-y-4 rounded-3xl border-primary/20 bg-primary/[0.06] p-5 dark:bg-primary/[0.08]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-3">
            {pill}
            <h2 className="text-2xl font-semibold tracking-tight text-balance">Tap Sushi and talk.</h2>
          </div>
          <div className="shrink-0">{sushi}</div>
        </div>
        <p className="text-sm leading-relaxed text-pretty text-muted-foreground">Tap again to finish, and your words go into the text box you’re in.</p>
        <Button className={cn("h-14 w-full rounded-2xl text-base [&_svg]:size-5", status?.recording && "animate-pulse")} disabled={!status?.mic} onClick={() => act("toggle")}>
          {status?.recording ? <Square weight="fill" /> : <Mic weight="fill" />} {status?.recording ? "Finish" : "Dictate"}
        </Button>
      </Card>
      <label className="row-span-2 flex min-w-0 flex-col justify-between gap-6 rounded-3xl border bg-card p-4">
        <span className="flex items-center justify-between">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-primary/12 text-primary">
            <PictureInPicture2 className="size-5.5" weight={running ? "fill" : "regular"} />
          </span>
          <Switch checked={running} disabled={!status?.mic || !status.overlay} onChange={setBubble} label="Show Sushi over other apps" />
        </span>
        <span>
          <span className="block text-sm font-semibold">Sushi over other apps</span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{running ? "On. The mic only opens when you tap." : "Turn on to dictate from any app. Drag Sushi anywhere."}</span>
        </span>
      </label>
      {side}
      {status && (!status.mic || !status.overlay) && (
        <div className="col-span-2">
          <Notice tone="warn">
            {!status.mic ? "Allow the microphone to start dictating." : "Allow Yammer to show over other apps to use Sushi."}{" "}
            <button type="button" className="font-medium underline" onClick={() => act(!status.mic ? "requestMic" : "openOverlaySettings")}>
              Allow
            </button>
          </Notice>
        </div>
      )}
      {status?.mic && status.overlay && !status.accessibility && (
        <p className="col-span-2 flex items-start gap-1.5 px-1 text-xs text-muted-foreground">
          <Check className="mt-0.5 size-3.5 shrink-0" />
          Words are copied for you to paste. Turn on “Paste for you” in Settings to skip that.
        </p>
      )}
    </>
  );
}

/** Onboarding's last step: a real dictation from inside the app. */
export function PhoneTry() {
  const status = usePhoneStatus();
  const act = usePhoneAction();
  return (
    <Button className={cn("h-12 w-full text-base", status?.recording && "animate-pulse")} disabled={!status?.mic} onClick={() => act("toggle")}>
      {status?.recording ? <Square /> : <Mic />} {status?.recording ? "Finish" : "Dictate"}
    </Button>
  );
}
