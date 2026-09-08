# Setting up the give-to-get.com knowledge vault

This is the setup guide for the Obsidian-based internal knowledge base and agent-memory layer used alongside this repo. It's written for anyone bootstrapping their own copy — a new human contributor, a different local AI agent framework, or a future maintainer — not just the original team. If you're an AI agent reading this to set yourself up, see the note at the end.

## What this is, and what it deliberately is not

This vault holds product specs, architecture decisions, Supabase/RLS documentation, incident write-ups, and agent working memory — all as Markdown with consistent YAML frontmatter, queryable via Obsidian's Dataview/Bases plugins.

It is **not** the bug tracker (that's GitHub Issues on this repo — see `AGENTS.md`), not a replacement for code comments or migration files, and not a shared, synced, multi-writer knowledge base. Obsidian vaults are single-writer tools by design. **Every contributor — human or agent — runs their own local vault.** What's shared and version-controlled is the *starter kit* in this folder: the folder layout, note templates, and YAML schemas that keep everyone's independent vault consistent enough that notes, once written up as a PR-attached export or referenced by path, are legible to anyone else on the project. Cross-team and cross-agent knowledge sharing happens through this repo — this doc, `AGENTS.md`, PRs, and Issues — not through a shared vault.

The reasoning is documented as an ADR: `docs/adr/0001-documentation-architecture.md`.

## Prerequisites

- [Obsidian](https://obsidian.md) installed
- This repo cloned locally

## 1. Create your own vault

Create a new, empty Obsidian vault **outside this repo** — anywhere on your machine (`~/vaults/give-to-get/` is a reasonable default). Do not create it as a folder inside your clone of this repo; the vault is personal and shouldn't be committed here.

## 2. Install the plugin set

Install these community plugins (Settings → Community Plugins → Browse):

| Plugin | Why |
|---|---|
| Templater | Powers the note templates in this starter kit |
| Dataview | Queries notes by frontmatter (e.g. "all active feature specs") |
| QuickAdd | One-hotkey capture for ideas, bugs, and new notes |
| Linter | Keeps YAML frontmatter consistent so queries and agents can rely on it |
| TaskNotes | Task tracking — one file per task, clean frontmatter, agent-friendly |
| Various Complements | Autocomplete for `[[links]]` and frontmatter values (optional, quality-of-life) |

Also enable **Bases** under Settings → Core Plugins if it isn't already — it's built into Obsidian itself, no install needed, and gives GUI-driven table/card views as a lower-maintenance complement to Dataview.

Don't install the **Tasks** plugin (redundant with TaskNotes — running both creates two competing task systems) or **Local REST API** yet (it's a staged rollout with its own security plan — see the full plugin strategy doc referenced below, and don't wire up agent access to your vault until you've read it).

Full rationale, current maintenance status, and configuration detail for every plugin above is in [`plugin-strategy.md`](./plugin-strategy.md) in this same folder.

## 3. Copy in the starter kit

From this repo:
```
docs/obsidian-vault/starter-kit/templates/*.md   →  your vault's 99-templates/
docs/obsidian-vault/starter-kit/CONVENTIONS.md   →  your vault's root
```

Then create the rest of the folder skeleton in your vault:
```
00-inbox/
01-projects/give-to-get/
02-product/
03-engineering/
04-operations/
05-research/
06-agent-memory/handoffs/
tasks/
99-templates/          (already populated in step above)
```

Point Templater's "template folder location" setting at your vault's `99-templates/`.

## 4. What goes where

| Folder | Purpose | Note types |
|---|---|---|
| `00-inbox/` | Unsorted captures before triage | inbox capture |
| `01-projects/give-to-get/` | Roadmap, milestones | meeting/planning |
| `02-product/` | PRD, feature specs, product decisions | feature-spec, product-decision |
| `03-engineering/` | ADRs, Supabase/RLS docs, implementation notes | adr, supabase-doc, implementation-note |
| `04-operations/` | Deploy runbooks, incident notes (cross-link the GitHub Issue — don't duplicate status) | incident, runbook |
| `05-research/` | Investigations, plugin evaluations | research |
| `06-agent-memory/` | Agent session handoffs and working memory | agent-handoff |
| `tasks/` | One file per TaskNotes task | task |

Full per-folder read/write guidance and the complete YAML schemas for all 10 note types are in `CONVENTIONS.md` (copied into your vault in step 3) and in `plugin-strategy.md`.

## 5. Optional: version your own vault

If you want history/backup of your *own* notes, that's a separate, personal `git init` inside your vault folder — unrelated to this repo, not pushed anywhere shared. Don't point it at this repo's remote.

## If you're an AI agent bootstrapping this yourself

Read `AGENTS.md` at the repo root first — that's the framework-agnostic entry point regardless of which agent framework you're running under. This doc and the starter kit in `docs/obsidian-vault/` are read-only reference material: copy from them to build your own working vault, don't edit them as part of normal operation. If a convention here should change, propose it the same way you'd propose any other repo change — a PR, reviewed like code. Any local file-drop or messaging convention a specific contributor uses to talk to their own agent (for example, a `~/.hermes/messages/` folder) is that contributor's own local integration detail, not a repo-level contract — don't assume it exists or means anything outside that one person's setup.