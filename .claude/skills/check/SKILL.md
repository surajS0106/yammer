---
name: check
description: Pre-push gate for Larp. Runs exactly what GitHub CI runs, plus the larp-crate tests and lints that CI skips, so a push doesn't go red. Use before pushing, when asked to "run CI locally", "lint" or "will CI pass", and as the first step of /ship.
---

# Check

CI (`.github/workflows/ci.yml`) runs on Linux with a 3-minute budget, and it never builds the `larp` crate. This skill runs the CI steps exactly, then the extra coverage CI skips.

Run from the repo root. Stop at the first **blocking** failure and report it. Don't keep running slower steps on top of a broken build.

## 1. CI mirror (blocking)

Run these in this order, the same order as CI:

```sh
bun install --frozen-lockfile        # fails if bun.lock is stale; run `bun install` and commit the lockfile
bun run typecheck
bun --filter desktop build           # tsc + vite build
cargo fmt --all --check              # whole workspace, including larp
cargo clippy -p voice-core --all-targets --config 'profile.dev.package."*".opt-level=0' -- -D warnings
cargo test -p voice-core --config 'profile.dev.package."*".opt-level=0'
```

If `cargo fmt --check` fails, run `cargo fmt --all`, show the user the resulting diff, and re-run the check. The diff is only formatting, so you don't need to ask first. Then continue. Don't work around `rustfmt.toml` by changing it.

If all six pass, CI will pass, apart from platform differences (CI is Linux and this machine may not be).

## 2. larp crate (blocking if `apps/desktop/src-tauri/` changed)

Check with `git status --porcelain` and `git diff --name-only @{u}.. 2>/dev/null`, which covers unpushed commits. If anything under `apps/desktop/src-tauri/` changed, run:

```sh
cargo clippy -p larp --all-targets -- -D warnings
cargo test -p larp
```

Clippy on larp is blocking too: the crate is warning-free, so keep it that way. If you edit macOS-only code (`dock.rs`, `panel.rs` or `cfg(target_os = "macos")` arms) on Windows or Linux, nothing compiles or lints it. Say so in the report.

- Use the default profile, so it reuses the opt-level 3 whisper build. A cold build compiles whisper.cpp and takes several minutes, so say so before you start.
- `transcribes_real_audio` is `#[ignore]`d. Don't try to run it.

## 3. Lints (advisory: report, don't block)

- **Rust ↔ TS drift:** if a `#[tauri::command]` or a serde type changed, check that `apps/desktop/src/lib/tauri.ts` matches it: names, argument names, camelCase fields, kebab-case enum values.
- **Settings compatibility:** a new field in `crates/voice-core/src/settings.rs` needs a default (the struct has `#[serde(default)]`, and the `Default` impl must set it), so old `settings.json` files still load. If the test that pins the default JSON exists, extend it.
- **Capabilities:** if the frontend now calls a new Tauri window or webview API, check that `apps/desktop/src-tauri/capabilities/default.json` grants it.
- **Leftovers:** look for `console.log`, `dbg!`, `todo!()` and `.only` added in the diff.

## Report

Show a compact table with one row per step: ✅ pass, ❌ fail or ⚠️ advisory, with the time it took. Under the table, list each failure or warning with `file:line` and a one-line cause. End with a verdict: **ready to push** or **not ready**, and why.

Don't fix anything unless the user asked you to. Offer to fix the failures you found.
