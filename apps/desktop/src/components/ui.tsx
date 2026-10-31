// Small, dependency-free UI primitives in the Sush look (tokens from index.css).

import { Check, ChevronDown } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";

import { ease, spring } from "@/components/motion";
import { cn, hotkeyParts } from "@/lib/utils";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost" | "destructive";
  size?: "sm" | "md" | "icon";
};

export function Button({ variant = "default", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,scale] outline-none focus-visible:ring-3 active:scale-[0.97] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        variant === "default" && "bg-primary text-primary-foreground hover:bg-primary/90",
        variant === "outline" && "border bg-background hover:bg-accent hover:text-accent-foreground",
        variant === "ghost" && "hover:bg-accent hover:text-accent-foreground",
        variant === "destructive" && "bg-destructive/10 text-destructive hover:bg-destructive/20",
        size === "sm" && "h-7 px-2.5 text-xs",
        size === "md" && "h-8 px-3",
        size === "icon" && "size-8",
        className,
      )}
      {...props}
    />
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-[20px] w-[36px] shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
        checked ? "bg-primary" : "bg-input dark:bg-input/80",
      )}
    >
      <span
        className={cn(
          "block size-4 rounded-full bg-background shadow-sm transition-transform duration-300",
          checked ? "translate-x-[18px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}

const field =
  "w-full max-w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-50 dark:bg-input/30";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, "h-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(field, "min-h-20 resize-y py-2 leading-relaxed", className)} {...props} />;
}

export interface SelectOption<T> {
  value: T;
  label: string;
  /** A glyph before the label, e.g. a provider's logo. */
  icon?: React.ReactNode;
  disabled?: boolean;
}

/** The list's tallest height (`max-h-64`), its gap from the trigger (`mt-1`), and the margin it keeps from a clipped edge. */
const LIST_MAX = 256;
const GAP = 4;
const EDGE = 8;
/** Never squeeze the list below this, even with no room either side: two rows still scroll. */
const LIST_MIN = 80;

/** The vertical band `el` can paint into: the viewport, cut down by every ancestor that clips its y overflow (the page's scroller). */
function visibleBand(el: HTMLElement) {
  let top = 0;
  let bottom = window.innerHeight;
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (getComputedStyle(p).overflowY === "visible") continue;
    const r = p.getBoundingClientRect();
    top = Math.max(top, r.top);
    bottom = Math.min(bottom, r.bottom);
  }
  return { top, bottom };
}

/**
 * A listbox behind a combobox trigger, with a sliding highlight between options. The list floats over what's
 * below and opens toward whichever side has room. `value` matching no option shows `placeholder`.
 */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  placeholder,
  disabled,
  align = "end",
  onOpen,
  id,
  title,
  className,
}: {
  value: T | null;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** The accessible name, when no `<label htmlFor>` points at `id`. */
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Which edge of the trigger the list hangs from when it's wider than the trigger. */
  align?: "start" | "end";
  onOpen?: () => void;
  id?: string;
  title?: string;
  className?: string;
}) {
  const uid = React.useId();
  const [open, setOpen] = React.useState(false);
  const selected = options.findIndex((o) => o.value === value);
  const [highlighted, setHighlighted] = React.useState(selected);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const typed = React.useRef({ text: "", at: 0 });
  const reduce = useReducedMotion();
  const current = options[selected];

  /** The next enabled option from `from` in direction `by`, or `from` when there's none. */
  const step = (from: number, by: 1 | -1) => {
    for (let i = from + by; i >= 0 && i < options.length; i += by) if (!options[i].disabled) return i;
    return from;
  };

  const show = (next: boolean) => {
    if (next === open) return;
    if (next) {
      setHighlighted(selected >= 0 ? selected : step(-1, 1));
      onOpen?.();
    }
    setOpen(next);
  };

  const choose = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    if (o.value !== value) onChange(o.value);
    setOpen(false);
  };

  // Measured before paint and written straight to the DOM (`data-side` and the list's max-height),
  // so a flipped list never flashes on the wrong side.
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    const list = listRef.current;
    const pop = list?.parentElement;
    if (!open || !root || !list || !pop) return;
    const t = root.getBoundingClientRect();
    const band = visibleBand(root);
    const chrome = pop.offsetHeight - list.offsetHeight;
    const need = Math.min(list.scrollHeight, LIST_MAX) + chrome + GAP + EDGE;
    const below = band.bottom - t.bottom;
    const above = t.top - band.top;
    const side = below >= need || below >= above ? "bottom" : "top";
    pop.dataset.side = side;
    list.style.maxHeight = `${Math.max(LIST_MIN, Math.min(LIST_MAX, (side === "bottom" ? below : above) - chrome - GAP - EDGE))}px`;
  }, [open, options.length]);

  React.useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-index="${highlighted}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, highlighted]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) show(true);
      else setHighlighted((h) => step(h, e.key === "ArrowDown" ? 1 : -1));
    } else if (open && (e.key === "Home" || e.key === "End")) {
      e.preventDefault();
      setHighlighted(e.key === "Home" ? step(-1, 1) : step(options.length, -1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open) choose(highlighted);
      else show(true);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Type to jump, like a native select: letters typed in quick succession build up a prefix.
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 600 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
      const match = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(typed.current.text));
      if (match >= 0) {
        if (!open) show(true);
        setHighlighted(match);
      }
    }
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        role="combobox"
        id={id}
        title={title}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={`${uid}-list`}
        aria-activedescendant={open && highlighted >= 0 ? `${uid}-${highlighted}` : undefined}
        disabled={disabled}
        onClick={() => show(!open)}
        onKeyDown={onKeyDown}
        className={cn(
          field,
          "flex h-8 cursor-pointer items-center gap-2 pr-2 text-left hover:bg-accent/60 disabled:cursor-default disabled:hover:bg-transparent",
          open && "border-ring ring-3 ring-ring/30",
        )}
      >
        {current?.icon}
        <span className={cn("min-w-0 flex-1 truncate", !current && "text-muted-foreground")}>{current?.label ?? placeholder}</span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={reduce ? { duration: 0 } : spring}
          className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
        >
          <ChevronDown className="size-4" />
        </motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18, ease }}
            className={cn(
              // Grows out of the trigger's edge. Scale rather than a slide: the side is settled after mount.
              "absolute top-full z-50 mt-1 w-max max-w-[min(24rem,calc(100vw-2rem))] min-w-full origin-top overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg shadow-black/8 dark:shadow-black/40",
              "data-[side=top]:top-auto data-[side=top]:bottom-full data-[side=top]:mt-0 data-[side=top]:mb-1 data-[side=top]:origin-bottom",
              align === "end" ? "right-0" : "left-0",
            )}
          >
            <motion.ul
              ref={listRef}
              layoutScroll
              id={`${uid}-list`}
              role="listbox"
              aria-label={label}
              className="isolate max-h-64 overflow-y-auto overscroll-contain p-1 [scrollbar-width:thin]"
            >
              {options.map((o, i) => (
                <motion.li
                  key={String(o.value)}
                  id={`${uid}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === selected}
                  aria-disabled={o.disabled || undefined}
                  // Opacity only: a transform would make each row its own stacking context and undo the z-order below.
                  initial={reduce ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: reduce ? 0 : Math.min(i, 10) * 0.015, duration: 0.15 }}
                  onMouseEnter={() => !o.disabled && setHighlighted(i)}
                  onClick={() => choose(i)}
                  className={cn("relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm", o.disabled && "cursor-default opacity-50")}
                >
                  {/* The highlight slides in from the row it left, so it sits under every row's content (z-0 vs z-10),
                      not just its own; otherwise moving down, a later row's highlight covers the earlier row's text. */}
                  {i === highlighted && (
                    <motion.span
                      layoutId={`${uid}-highlight`}
                      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 600, damping: 40 }}
                      className="absolute inset-0 z-0 rounded-md bg-accent"
                    />
                  )}
                  {o.icon && <span className="relative z-10 flex shrink-0">{o.icon}</span>}
                  <span className={cn("relative z-10 min-w-0 flex-1 truncate", i === highlighted ? "text-accent-foreground" : "text-foreground/85")}>
                    {o.label}
                  </span>
                  <Check className={cn("relative z-10 size-4 shrink-0 text-primary", i !== selected && "invisible")} />
                </motion.li>
              ))}
            </motion.ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A text field that saves on blur or Enter, not on every keystroke. */
export function CommitInput({
  value,
  onCommit,
  multiline,
  ...props
}: {
  value: string;
  onCommit: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  type?: string;
  className?: string;
  rows?: number;
  list?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  if (multiline) {
    return <Textarea {...props} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />;
  }
  return (
    <Input
      {...props}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border bg-card text-card-foreground", className)} {...props} />;
}

/** A settings row: label and description on the left, the control on the right (or below, when stacked or out of room). */
export function Row({
  label,
  description,
  children,
  stacked,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  stacked?: boolean;
}) {
  return (
    <div className={cn("flex px-4 py-3.5", stacked ? "flex-col gap-2.5" : "flex-wrap items-center justify-between gap-x-4 gap-y-2.5")}>
      <div className={cn("min-w-0", !stacked && "flex-1 basis-56")}>
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</div>}
      </div>
      <div className={cn(stacked ? "w-full" : "max-w-full shrink-0")}>{children}</div>
    </div>
  );
}

export function Section({ title, description, children }: { title?: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      {title && (
        <div className="px-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
      )}
      <Card className="divide-y shadow-xs">{children}</Card>
    </section>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-b-2 bg-muted px-1.5 font-sans text-xs font-medium text-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Hotkey({ accelerator, className }: { accelerator: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {hotkeyParts(accelerator).map((part, i) => (
        <Kbd key={i}>{part}</Kbd>
      ))}
    </span>
  );
}

export function Badge({ tone = "muted", children }: { tone?: "muted" | "brand" | "warn" | "error"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "brand" && "bg-primary/12 text-primary",
        tone === "warn" && "bg-amber-500/12 text-amber-700 dark:text-amber-400",
        tone === "error" && "bg-destructive/12 text-destructive",
      )}
    >
      {children}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (value: T) => void;
}) {
  // The selected thumb slides between options; the id keeps two Segmented controls from sharing it.
  const id = React.useId();
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-lg bg-muted p-0.5 [scrollbar-width:none]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "relative shrink-0 rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            value === o.value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {value === o.value && <motion.span layoutId={`segmented-${id}`} transition={spring} className="absolute inset-0 rounded-md bg-background shadow-sm" />}
          <span className="relative inline-flex items-center gap-1.5">
            {o.icon}
            {o.label}
          </span>
        </button>
      ))}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 text-xs leading-relaxed",
        tone === "info" && "border-primary/20 bg-primary/5",
        tone === "warn" && "border-amber-500/25 bg-amber-500/8",
        tone === "error" && "border-destructive/25 bg-destructive/8 text-destructive",
      )}
    >
      {children}
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

/** A page's opening card: what the feature is for, with an example. */
export function Intro({ title, children, example }: { title: string; children: React.ReactNode; example?: React.ReactNode }) {
  return (
    <Card className="space-y-3 bg-gradient-to-br from-primary/10 via-card to-card p-4 @md:p-5">
      <h2 className="text-lg font-semibold tracking-tight text-balance">{title}</h2>
      <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">{children}</p>
      {example && <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">{example}</div>}
    </Card>
  );
}

/** "my linkedin" → "linkedin.com/in/…", as an example in an Intro. */
export function Mapping({ from, to }: { from: string; to: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span className="rounded-md bg-muted px-2 py-1 font-medium">“{from}”</span>
      <span className="text-muted-foreground">→</span>
      <span className="truncate rounded-md border bg-card px-2 py-1">{to}</span>
    </span>
  );
}
