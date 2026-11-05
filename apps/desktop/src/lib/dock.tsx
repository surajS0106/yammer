// What the round button beside the phone's dock does right now. A page sets it for as long as it's on screen,
// like "+" to add a snippet; with none set the button dictates.

import * as React from "react";

export type DockAction = { label: string; icon: React.ElementType; run: () => void };

export const DockActionContext = React.createContext<(action: DockAction | null) => void>(() => {});

/** While `action` isn't null, the round button does this. */
export function useDockAction(action: DockAction | null) {
  const set = React.useContext(DockActionContext);
  const latest = React.useRef(action);
  latest.current = action;
  const label = action?.label;
  const icon = action?.icon;
  React.useEffect(() => {
    if (!label || !icon) return;
    set({ label, icon, run: () => latest.current?.run() });
    return () => set(null);
  }, [set, label, icon]);
}
