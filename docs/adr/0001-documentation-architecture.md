---
type: adr
project: give-to-get
status: accepted
owner: Aaron Wykoff
created: 2026-09-08
updated: 2026-09-08
tags: [documentation, obsidian, onboarding]
related: []
decision: Repo docs/ is canonical and shared; each contributor's Obsidian vault is personal, local, and never version-controlled in this repo.
repo_path: docs/adr/0001-documentation-architecture.md
---

# ADR 0001: Documentation architecture as the project grows beyond one founder and one local agent

## Context

give-to-get.com's knowledge base has, to date, lived in three places that only work because there's exactly one founder and one local agent framework (Hermes, running Sariputra and Ananda):

1. Aaron's personal claude.ai Project — visible only to Aaron's Claude sessions.
2. Aaron's personal Obsidian vault — a single-writer local application, not shared or synced.
3. A local file-drop convention (`~/.hermes/messages/`) specific to how this one instance of Hermes happens to be wired up on Aaron's machine.

None of these three survive contact with a second human contributor, a second team, or a second AI agent framework — none of them are reachable by `git clone`. The project already solved an analogous problem once: bug tracking moved to GitHub Issues specifically because it's the one surface every party (human or agent, on any machine) can reach, and Obsidian/the claude.ai Project were kept only as detailed archives cross-linking back to it.

This ADR extends that same reasoning to setup documentation, conventions, and templates as the project anticipates other human developers or other agent frameworks ("other agent swarms") joining.

## Decision

- **The git repo is the canonical, shared source of truth for anything a new contributor — human or agent, regardless of framework — needs to bootstrap or understand conventions.** This includes `AGENTS.md` (the framework-agnostic entry point), and a new `docs/obsidian-vault/` folder holding the vault setup guide, a plugin strategy writeup, and a starter kit of templates and YAML schema conventions.
- **Each contributor's actual working Obsidian vault is personal, local, and explicitly not committed to this repo.** Obsidian is a single-writer tool; treating a shared vault as team infrastructure would recreate exactly the coordination problem GitHub Issues already solved for bugs. Contributors copy the repo's starter kit into their own vault once, the same way they'd copy `.env.example` to `.env`.
- **A contributor's local integration details (e.g. Aaron's `~/.hermes/messages/` file-drop convention with Ananda) are personal plumbing, not part of the repo contract.** `AGENTS.md` and `docs/` describe conventions any framework can follow; they must never assume a specific local tool's file layout.
- Changes to the starter kit (templates, schemas, folder layout) go through a normal PR, same as code.

## Consequences

**Easier:** onboarding a new human dev or a new agent framework — clone, read `AGENTS.md`, read `docs/obsidian-vault/`, stand up a personal vault, contribute. No dependency on Aaron's personal tooling or account access.

**Harder:** nothing meaningfully — this trades a small amount of setup copying (pasting the starter kit into a new vault once) for not having to solve real-time multi-writer sync across independently-run Obsidian vaults, which isn't a problem worth solving when the repo already does this job.

## Alternatives considered

- **A shared, synced vault** (e.g. via a sync service or a git-tracked vault folder in this repo) — rejected. Obsidian isn't built for concurrent multi-writer editing, and a git-tracked vault full of personal notes would collide constantly and duplicate what PRs/Issues already do well.
- **Leaving setup knowledge as tribal/local** (status quo before this ADR) — rejected as soon as a second contributor was anticipated; this is exactly the "GitHub Issues vs. Obsidian" bug-tracking decision playing out again for onboarding docs specifically.