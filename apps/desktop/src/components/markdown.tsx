// The little Markdown that meeting notes are written in: headings, bullets,
// numbered lists, "- [ ]" action items and **bold**. Built from React elements,
// never HTML, so nothing a model writes can run. A checkbox can be ticked:
// `onToggle` gets the line it's on, to rewrite the source.

import * as React from "react";

import { Checkbox } from "@/components/ui";
import { cn } from "@/lib/utils";

/** `indent` is its leading spaces, for bullets under bullets. */
type Item = { text: string; line: number; indent: number; check?: boolean };

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: Item[] }
  | { kind: "paragraph"; text: string };

function parse(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const endParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  source.split("\n").forEach((raw, line) => {
    const text = raw.trim();
    const indent = /^\s*/.exec(raw.replace(/\t/g, "  "))![0].length;
    const heading = /^(#{1,4})\s+(.*)$/.exec(text);
    const bullet = /^[-*•]\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(text);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(text);
    if (!text) return endParagraph();
    if (heading) {
      endParagraph();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
    } else if (bullet || numbered) {
      endParagraph();
      const ordered = !bullet;
      const item = bullet ? { text: bullet[2], line, indent, check: bullet[1] === undefined ? undefined : bullet[1] !== " " } : { text: numbered![1], line, indent };
      const last = blocks[blocks.length - 1];
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(item);
      else blocks.push({ kind: "list", ordered, items: [item] });
    } else {
      paragraph.push(text);
    }
  });
  endParagraph();
  return blocks;
}

/** **bold** spans, as elements. */
function inline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i} className="font-semibold text-foreground">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

/** Flip the checkbox on `line` of `source`. */
export function toggleCheck(source: string, line: number): string {
  const lines = source.split("\n");
  lines[line] = lines[line].replace(/\[([ xX])\]/, (_, c: string) => (c === " " ? "[x]" : "[ ]"));
  return lines.join("\n");
}

/** The titles of the sections in `source`, for an outline. Their elements carry `data-section`, counting from 0. */
export function sections(source: string): string[] {
  return parse(source).flatMap((b) => (b.kind === "heading" && b.level <= 2 ? [b.text.replace(/\*\*/g, "")] : []));
}

/** How many of the checkboxes in `source` are ticked. */
export function checks(source: string): { done: number; total: number } {
  const items = parse(source).flatMap((b) => (b.kind === "list" ? b.items.filter((i) => i.check !== undefined) : []));
  return { done: items.filter((i) => i.check).length, total: items.length };
}

/** "Ana: send the deck" → who it's for, and the rest. */
function ownerOf(text: string): { owner?: string; task: string } {
  const m = /^(?:\*\*)?(\p{Lu}[\p{L}.'’-]*(?:\s+(?:and\s+|&\s+)?[\p{L}.'’-]+){0,3})(?::\*\*|\*\*:|:)\s+(.+)$/u.exec(text);
  return m && m[1].length <= 32 ? { owner: m[1], task: m[2] } : { task: text };
}

const isTitle = (item: Item) => item.check === undefined && /^\*\*[^*]+\*\*:?$/.test(item.text);

/** A bullet that's only bold, with bullets after it, is their title. */
function grouped(items: Item[]): { title?: Item; items: Item[] }[] {
  const groups: { title?: Item; items: Item[] }[] = [];
  items.forEach((item, i) => {
    const next = items[i + 1];
    if (isTitle(item) && next && !isTitle(next) && next.indent >= item.indent) groups.push({ title: item, items: [] });
    else if (groups.length) groups[groups.length - 1].items.push(item);
    else groups.push({ items: [item] });
  });
  return groups;
}

function Check({ item, onToggle }: { item: Item; onToggle?: (line: number) => void }) {
  const { owner, task } = ownerOf(item.text);
  return (
    <li>
      <label className={cn("flex items-start gap-3 px-4 py-3", onToggle && "cursor-pointer transition-colors hover:bg-muted/50")}>
        <Checkbox className="mt-1" checked={item.check} disabled={!onToggle} aria-label={item.text} onChange={() => onToggle?.(item.line)} />
        <span className={cn("min-w-0 flex-1 transition-colors", item.check && "text-muted-foreground line-through decoration-muted-foreground/40")}>{inline(task)}</span>
        {owner && <span className="max-w-32 shrink-0 truncate rounded-full bg-muted px-2 py-0.5 text-xs leading-5 font-medium text-muted-foreground">{owner}</span>}
      </label>
    </li>
  );
}

function List({ items, ordered, onToggle }: { items: Item[]; ordered: boolean; onToggle?: (line: number) => void }) {
  if (items.length > 0 && items.every((i) => i.check !== undefined)) {
    return (
      <ul className="divide-y overflow-hidden rounded-xl border bg-background/60">
        {items.map((item) => (
          <Check key={item.line} item={item} onToggle={onToggle} />
        ))}
      </ul>
    );
  }
  const L = ordered ? "ol" : "ul";
  const outer = Math.min(...items.map((i) => i.indent));
  return (
    <L className={cn("space-y-2", ordered && "list-decimal pl-5 marker:text-muted-foreground")}>
      {items.map((item) => {
        const nested = item.indent - outer >= 2;
        if (item.check !== undefined) {
          return (
            <li key={item.line} className={cn("flex items-start gap-3", nested && "ml-5")}>
              <Checkbox className="mt-1" checked={item.check} disabled={!onToggle} aria-label={item.text} onChange={() => onToggle?.(item.line)} />
              <span className={cn(item.check && "text-muted-foreground line-through decoration-muted-foreground/40")}>{inline(item.text)}</span>
            </li>
          );
        }
        return (
          <li key={item.line} className={cn(!ordered && "relative pl-5", nested && "ml-5")}>
            {!ordered && (
              <span aria-hidden className={cn("absolute top-[0.6em] left-1 size-1.5 rounded-full", nested ? "border border-muted-foreground/60" : "bg-primary/70")} />
            )}
            {inline(item.text)}
          </li>
        );
      })}
    </L>
  );
}

export function Markdown({
  source,
  onToggle,
  document,
  className,
}: {
  source: string;
  onToggle?: (line: number) => void;
  /** Laid out as a page to read: more air between sections, and an opening paragraph that leads in. */
  document?: boolean;
  className?: string;
}) {
  const blocks = React.useMemo(() => parse(source), [source]);
  const lead = blocks.findIndex((b) => b.kind === "paragraph");
  let section = -1;
  return (
    <div className={cn("space-y-3 text-sm leading-relaxed text-foreground/90", className)}>
      {blocks.map((b, i) => {
        if (b.kind === "heading") {
          if (b.level > 2) {
            return (
              <h4 key={i} className={cn("text-sm font-semibold text-foreground", document && i > 0 && "pt-2")}>
                {inline(b.text)}
              </h4>
            );
          }
          section++;
          const next = blocks[i + 1];
          const tasks = document && next?.kind === "list" ? next.items.filter((t) => t.check !== undefined) : [];
          return (
            <div key={i} data-section={section} className={cn("flex scroll-mt-6 items-baseline gap-3", i > 0 && (document ? "pt-6" : "pt-2"))}>
              <h3 className={cn("font-semibold tracking-tight text-foreground", document ? "text-base" : "text-[15px]")}>{inline(b.text)}</h3>
              {tasks.length > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {tasks.filter((t) => t.check).length} of {tasks.length} done
                </span>
              )}
            </div>
          );
        }
        if (b.kind === "paragraph") {
          return (
            <p key={i} className={cn(document && i === lead && i <= 1 && "text-base leading-7 text-foreground")}>
              {inline(b.text)}
            </p>
          );
        }
        return (
          <div key={i} className="space-y-4">
            {grouped(b.items).map((g, j) => (
              <div key={j} className="space-y-2">
                {g.title && <h4 className="text-sm font-semibold text-foreground">{inline(g.title.text)}</h4>}
                <List items={g.items} ordered={b.ordered} onToggle={onToggle} />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
