// Small, dependency-free UI primitives in the Sush look (tokens from index.css).

import { motion } from "motion/react";
import * as React from "react";

import { spring } from "@/components/motion";
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

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(field, "h-8 cursor-pointer pr-7", className)} {...props} />;
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
      <Card className="divide-y">{children}</Card>
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
  options: { value: T; label: string }[];
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
          <span className="relative">{o.label}</span>
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
