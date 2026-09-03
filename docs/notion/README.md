# Notion Decision Snapshots

Notion is the **authority** for Xentra business rules, locked decisions, invariants, and
architecture boundaries (see `AGENTS.md`). This folder holds **pinned Markdown snapshots**
of the Notion pages we rely on while coding.

## Why snapshots in Git?

- Every agent reads the same, deterministic context — no guessing, no per-task copy-paste drift.
- Snapshots are **diffable and reviewable**: changes over time are visible in Git history.
- Git remains the evidence trail of *implementation*, while the snapshot records the *decision*
  it was built against.
- No secrets, no live API, no extra dependencies.

## How to add or update a snapshot

1. Open the Notion page/database you want to mirror.
2. Click the page's `⋯` menu → **Export** → format **Markdown & CSV** (include subpages if needed).
3. Unzip the downloaded archive.
4. Copy the `.md` files (and their `assets/` folder, if any) into `docs/notion/`.
   - Prefer one folder per domain or feature, e.g. `docs/notion/promotion/`.
   - Keep Notion's filenames, or rename to a clear kebab-case slug.
5. Commit with a message naming what changed, e.g. `docs(notion): snapshot promotion decisions vN`.
6. If a decision changes in Notion, replace the old files in a new commit — never edit the
   snapshot and claim it matches live Notion.

## How agents must use this

- Before coding, check `docs/notion/` for a snapshot relevant to the task and read it.
- A snapshot is a **point-in-time copy**: if the task touches a decision that may have changed
  since the snapshot, ask the user for the current Notion wording instead of assuming.
- Never infer a business rule from code that contradicts a snapshot here; ask first.
- Exports are **private company material** — keep them in the repo, do not paste into public tools.
