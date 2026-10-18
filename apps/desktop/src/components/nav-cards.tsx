// A row of ContentCards that open pages inside the app. ContentCard only
// knows `href`, so each points at `#<page>` and the click is caught here.

import type { PageId } from "@/App";
import { ContentCard } from "@/components/ui/ContentCard";
import { cn } from "@/lib/utils";

export interface NavCard {
  to: PageId;
  title: string;
  description: string;
}

// ContentCard is painted in stone/emerald; these put it on the app's tokens.
// Its dark: classes outrank plain overrides, so the colours are restated under dark: too.
const retheme =
  "[&>a]:rounded-xl [&>a]:border-border [&>a]:bg-card [&>a:hover]:border-primary/40 [&>a]:focus-visible:outline-ring " +
  "dark:[&>a]:border-border dark:[&>a]:bg-card dark:[&>a:hover]:border-primary/40 dark:[&>a]:focus-visible:outline-ring " +
  "[&_h3]:text-base [&_h3]:text-foreground [&>a:hover_h3]:text-primary dark:[&_h3]:text-foreground dark:[&>a:hover_h3]:text-primary " +
  "[&_p]:text-muted-foreground dark:[&_p]:text-muted-foreground " +
  "[&>a>span:first-child]:bg-primary [&>a>span:last-child]:text-primary dark:[&>a>span:last-child]:text-primary";

export function NavCards({ cards, go, className }: { cards: NavCard[]; go: (page: PageId) => void; className?: string }) {
  return (
    <div className={cn("grid gap-3 @2xl:grid-cols-3", className)}>
      {cards.map((c) => (
        <div
          key={c.to + c.title}
          className={cn("flex", retheme)}
          onClickCapture={(e) => {
            e.preventDefault();
            go(c.to);
          }}
        >
          <ContentCard title={c.title} description={c.description} href={`#${c.to}`} />
        </div>
      ))}
    </div>
  );
}
