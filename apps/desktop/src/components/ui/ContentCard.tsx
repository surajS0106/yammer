"use client";

import { motion } from "framer-motion";

export function ContentCard({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <motion.a
      href={href}
      transition={{ type: "spring", stiffness: 400, damping: 28 }}
      className="group relative flex w-full flex-col gap-3 overflow-hidden rounded-2xl border border-stone-200 bg-white p-6 transition-colors duration-150 hover:border-stone-300 dark:border-stone-700 dark:bg-stone-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:focus-visible:outline-emerald-400"
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 bg-emerald-500 transition-transform duration-300 ease-out group-hover:scale-x-100"
      />
      <h3 className="text-lg font-semibold text-stone-900 transition-colors group-hover:text-emerald-700 dark:text-stone-100 dark:group-hover:text-emerald-400">
        {title}
      </h3>
      <p className="text-sm leading-relaxed text-stone-500 dark:text-stone-400">{description}</p>
      <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-emerald-700 dark:text-emerald-400">
        Read more
        <span aria-hidden className="inline-block transition-transform duration-300 ease-out group-hover:translate-x-1">
          →
        </span>
      </span>
    </motion.a>
  );
}