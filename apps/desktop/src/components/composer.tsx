// The rounded box you type a request into, with its icon and round send button
// inside: Ask's questions, and changes to a meeting's written notes. Enter
// sends; Shift+Enter starts a new line.

import { ArrowUp, CircleNotch as Loader2 } from "@phosphor-icons/react";
import * as React from "react";

import { cn, isAndroid } from "@/lib/utils";

export function Composer({
  value,
  onChange,
  onSubmit,
  label,
  placeholder,
  sendLabel,
  icon,
  busy = false,
  actions,
  className,
}: {
  value: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
  /** Names the field for screen readers. */
  label: string;
  placeholder: string;
  sendLabel: string;
  icon?: React.ReactNode;
  /** A request is being answered: nothing can be sent until it's done. */
  busy?: boolean;
  /** Buttons before send. */
  actions?: React.ReactNode;
  className?: string;
}) {
  const ready = !!value.trim() && !busy;
  return (
    <form
      className={cn(
        "flex items-end gap-2 rounded-2xl border border-input bg-background p-2 shadow-xs transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20",
        className,
      )}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSubmit();
      }}
    >
      {icon && (
        <span aria-hidden className={cn("flex shrink-0 items-center justify-center pl-1 text-muted-foreground [&_svg]:size-4", isAndroid ? "h-11" : "h-8")}>
          {icon}
        </span>
      )}
      <textarea
        rows={1}
        className={cn(
          "field-sizing-content max-h-32 min-w-0 flex-1 resize-none bg-transparent px-1 leading-6 outline-none placeholder:text-muted-foreground",
          isAndroid ? "min-h-11 py-2 text-base" : "min-h-8 py-1 text-sm",
        )}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        readOnly={busy}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (ready) onSubmit();
          }
        }}
      />
      {actions}
      <button
        type="submit"
        aria-label={sendLabel}
        title={sendLabel}
        disabled={!ready}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full transition-[color,background-color,scale] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95 [&_svg]:size-4",
          isAndroid ? "size-11" : "size-8",
          ready ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-muted text-muted-foreground",
        )}
      >
        {busy ? <Loader2 className="animate-spin" /> : <ArrowUp weight="bold" />}
      </button>
    </form>
  );
}
