---
name: typecheck
description: Fast type check of Larp's TypeScript and Rust after an edit, without building whisper.cpp or running tests. Use after changing code and before /check or /ship, or when asked to "typecheck", "does it compile" or "check types".
---

# Typecheck

A quick compile-only pass. It should take seconds, not minutes. For the full pre-push gate, use `/check`.

Run from the repo root. Run the independent steps in parallel.

1. **TypeScript:** `bun run typecheck`.
2. **voice-core:** `cargo check -p voice-core --all-targets --config 'profile.dev.package."*".opt-level=0'`.
   The opt-level override matches CI. voice-core doesn't link whisper.cpp, so optimizing its dependencies only slows the check down.
3. **larp crate:** run only if `git status --porcelain` shows changes under `apps/desktop/src-tauri/`:
   `cargo check -p larp`.
   - Use the default profile, so it reuses the opt-level 3 whisper build from `bun run dev`. On a cold `target/`, this step compiles whisper.cpp and takes several minutes. Say so before you start it.
   - If it fails with an error about `dist/` or `frontendDist`, run `bun --filter desktop build` first.
4. **Rust ↔ TS drift:** if the diff touches a `#[tauri::command]`, a serde type in `crates/voice-core/src/settings.rs` or `history.rs`, or a command's arguments or return type, check that `apps/desktop/src/lib/tauri.ts` was updated to match. Rust struct fields serialize as camelCase and enums as kebab-case. tsc can't catch this drift, so flag it explicitly.

5. **Format:** if any `.rs` file changed, run `cargo fmt --all`. It takes about a second, and CI rejects unformatted code. Mention which files it touched.

## Report

One line per step: ✅ or ❌, plus the first few errors with `file:line`. Don't paste whole compiler logs. If everything passes, say so in one line.

Don't fix the errors unless the user asked you to. Report them and offer to fix.
