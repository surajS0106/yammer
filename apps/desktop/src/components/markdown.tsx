// The little Markdown that meeting notes are written in: headings, bullets,
// numbered lists, "- [ ]" action items and **bold**. Built from React elements,
// never HTML, so nothing a model writes can run. A checkbox can be ticked:
// `onToggle` gets the line it's on, to rewrite the source.

import * as React from "react";

import { cn } from "@/lib/utils";

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: { text: string; line: number; check?: boolean }[] }
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
      const item = bullet ? { text: bullet[2], line, check: bullet[1] === undefined ? undefined : bullet[1] !== " " } : { text: numbered![1], line };
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

export function Markdown({ source, onToggle, className }: { source: string; onToggle?: (line: number) => void; className?: string }) {
  const blocks = React.useMemo(() => parse(source), [source]);
  return (
    <div className={cn("space-y-3 text-sm leading-relaxed text-foreground/90", className)}>
      {blocks.map((b, i) => {
        if (b.kind === "heading") {
          return b.level <= 2 ? (
            <h3 key={i} className={cn("text-[15px] font-semibold tracking-tight text-foreground", i > 0 && "pt-2")}>
              {inline(b.text)}
            </h3>
          ) : (
            <h4 key={i} className="text-sm font-semibold text-foreground">
              {inline(b.text)}
            </h4>
          );
        }
        if (b.kind === "paragraph") return <p key={i}>{inline(b.text)}</p>;
        const List = b.ordered ? "ol" : "ul";
        return (
          <List key={i} className={cn("space-y-1.5", b.ordered ? "list-decimal pl-5" : "pl-1")}>
            {b.items.map((item) =>
              item.check === undefined ? (
                <li key={item.line} className={cn(!b.ordered && "relative pl-4")}>
                  {!b.ordered && <span aria-hidden className="absolute top-[0.6em] left-0.5 size-1.5 rounded-full bg-primary/70" />}
                  {inline(item.text)}
                </li>
              ) : (
                <li key={item.line} className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    className="mt-[0.3em] size-4 shrink-0 accent-[var(--brand)]"
                    checked={item.check}
                    disabled={!onToggle}
                    aria-label={item.text}
                    onChange={() => onToggle?.(item.line)}
                  />
                  <span className={cn(item.check && "text-muted-foreground line-through decoration-muted-foreground/40")}>{inline(item.text)}</span>
                </li>
              ),
            )}
          </List>
        );
      })}
    </div>
  );
}
