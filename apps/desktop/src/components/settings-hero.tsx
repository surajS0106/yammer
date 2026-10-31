// The banner at the top of each Settings tab: the title on the left, Sushi on the right acting
// out what the tab is about (typing on a laptop for the speech engine, polishing for cleanup).
// Same surface as Home's dictation card, so Settings feels part of the same app.

import * as React from "react";

import { Sushi, type SushiMood } from "@/components/sushi";
import { Card } from "@/components/ui";

export function SettingsHero({
  title,
  description,
  mood = "idle",
  children,
}: {
  title: string;
  description?: React.ReactNode;
  mood?: SushiMood;
  /** A line of chips under the description: what's set up right now. */
  children?: React.ReactNode;
}) {
  return (
    <Card className="relative overflow-hidden border-primary/20 bg-primary/[0.05] dark:bg-primary/[0.08]">
      {/* A coral wash from the top left, and the pixel grid Sushi stands on fading in from the right.
          Separate layers: WebKit drops animated children of a masked element. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(90% 120% at 0% 0%, color-mix(in oklch, var(--brand) 12%, transparent), transparent 60%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-1/2"
        style={{
          backgroundImage: "radial-gradient(color-mix(in oklch, var(--foreground) 14%, transparent) 1px, transparent 1.5px)",
          backgroundSize: "10px 10px",
          maskImage: "linear-gradient(to right, transparent, black 60%)",
          WebkitMaskImage: "linear-gradient(to right, transparent, black 60%)",
        }}
      />
      <div className="relative flex items-stretch">
        <div className="min-w-0 flex-1 space-y-1.5 px-5 py-5 @md:px-6 @md:py-6">
          <h1 className="text-xl font-semibold tracking-tight text-balance @md:text-2xl">{title}</h1>
          {description && <p className="max-w-md text-sm leading-relaxed text-pretty text-muted-foreground">{description}</p>}
          {children && <div className="flex flex-wrap items-center gap-1.5 pt-2">{children}</div>}
        </div>
        {/* Sushi on its plate. */}
        <div className="hidden w-40 shrink-0 flex-col items-center justify-end pt-4 pb-4 @md:flex @2xl:w-52">
          <Sushi mood={mood} px={4} interactive className="relative z-10 text-muted-foreground" />
          <span className="-mt-2 h-3 w-24 rounded-[50%] bg-foreground/10 dark:bg-foreground/15" />
        </div>
      </div>
    </Card>
  );
}

/** A small rounded chip for the hero's status line. */
export function HeroChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-background/70 px-2.5 py-1 text-xs font-medium text-muted-foreground ring-1 ring-border backdrop-blur-sm">
      {children}
    </span>
  );
}
