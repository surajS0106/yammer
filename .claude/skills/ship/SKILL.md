---
name: ship
description: Ship the current work on Yammer. Runs the /check gate, reviews the diff for things that shouldn't go out, writes the commit, pushes, and watches CI. Optionally starts a release. Use when the user says "ship it", "commit and push" or "/ship".
disable-model-invocation: true
argument-hint: "[commit message hint] [release]"
---

# Ship

Take the working tree from "done editing" to "pushed and green". Arguments: `$ARGUMENTS`. Any text other than `release` is a hint for the commit message.

Only the user can trigger this skill (`disable-model-invocation`), but every step that leaves the machine still needs its own confirmation, as described below.

## 1. Look at what's going out

Run these in parallel:

- `git status --porcelain`
- `git diff --stat` and `git diff --cached --stat`
- `git log --oneline @{u}.. 2>/dev/null`: unpushed commits
- `git branch --show-current`

If nothing has changed and nothing is unpushed, say so and stop.

Read the diff itself, not just the stat. You need it for the review and the message.

## 2. Gate

Follow `.claude/skills/check/SKILL.md` in full. If any blocking step fails, stop. Report the failures and offer to fix them. Don't commit red code, and don't skip the gate even if the user is in a hurry. If the user says to ship anyway, say plainly what will break in CI, then continue.

## 3. Review for things that shouldn't ship

Flag these, and ask before going on:

- **Secrets:** API keys, tokens, `.env*` contents, or `dev-secrets.json`, which normally lives in the app config dir, not the repo.
- **Stray files:** `target/`, `dist/`, `*.log`, model files (`ggml-*.bin`), WAV recordings, or editor and OS junk. Also flag untracked files that look accidental, but **don't** treat new source files as stray. Untracked `.tsx`, `.ts` and `.rs` files under `apps/` or `crates/` are probably part of the work.
- **Half-done work:** `TODO`/`FIXME` added in this diff, commented-out blocks, or debug logging.
- **Docs drift:** if behaviour, commands or architecture changed, does `CLAUDE.md` or `README.md` say something that's now false? Example: the README still describing tag-pushed releases after `release.yml` went manual-only. Offer the doc edit. Don't make it silently.
- **Mixed concerns:** if the diff holds clearly separate changes (for example a theme feature plus a CI change), suggest splitting them into separate commits. Offer the split, and go with whatever the user picks.

## 4. Commit

- Stage files explicitly by path. Don't use `git add -A` or `git add .`.
- Write the message in the style of `git log --oneline -10`:
  - A short imperative subject, about 72 characters or fewer. A `feat:`, `fix:` or `ci:` prefix is fine, since history mixes plain and conventional subjects.
  - A blank line, then a body that explains *why* when it isn't obvious from the subject.
  - Finally, the `Co-Authored-By` trailer from the session's attribution reminder, if there is one.
- Show the user the file list and the full message, and **wait for confirmation** before running `git commit`.
- Never use `--no-verify`, `--amend` on pushed commits, or `-c commit.gpgsign=false`. If a hook fails, fix the cause and make a new commit.

## 5. Push

- Show the branch, the remote (`origin`) and the commits that will go up. **Wait for confirmation.**
- Run `git push`. If there's no upstream, run `git push -u origin <branch>` instead.
- Never force-push unless the user asks for it explicitly, and never force-push `main`.
- If the push is rejected because the remote moved ahead, run `git pull --rebase`. Then re-run the CI-mirror part of the gate and ask again before pushing.

## 6. Watch CI

If `gh` is available, find the run with `gh run list --branch <branch> --limit 1`, then run `gh run watch <id> --exit-status` in the background. CI should take under 3 minutes. When it finishes, report green, or red with the failing step and the relevant log lines from `gh run view <id> --log-failed`.

## 7. Release (only if `$ARGUMENTS` contains `release`)

Releases are manual (`workflow_dispatch`). They build installers on Windows, two macOS targets and Linux, and macOS minutes bill at 10×. So:

1. Read `version` in `apps/desktop/src-tauri/tauri.conf.json`. Compare it with `git tag --list 'v*' --sort=-v:refname | head -1` and `gh release list --limit 1`. If that version is already released, stop and ask which version to bump to.
2. A bump changes three files: `tauri.conf.json`, `[workspace.package] version` in the root `Cargo.toml` and `apps/desktop/package.json`. Then run `cargo check -p voice-core` so that `Cargo.lock` updates. Commit and push the bump through steps 4 and 5.
3. Only after CI on that commit is green, and after the user confirms, run `gh workflow run release.yml --ref <branch>`. Report the run URL. The workflow creates the `v<version>` tag and the GitHub release itself.

## Finish

End with one short summary: the commit hash and subject, the push target, the CI result, and the release run if there was one. If anything was skipped or overridden, say so.
