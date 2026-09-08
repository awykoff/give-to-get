# Obsidian Plugin & Vault Strategy for give-to-get.com

Prepared for Aaron Wykoff / A. Wykoff Consulting. This supersedes the Perplexity brief — it's grounded in give-to-get.com's actual architecture (Next.js 15 on Vercel, Supabase Postgres + RLS, Hermes running Sariputra/Ananda locally, GitHub Issues as the canonical bug tracker) and in primary-source research on each plugin, current as of September 2026. Every maintenance/version/security claim below is cited; see Sources at the end.

---

## 1. Executive Recommendation

| Plugin | Rating | Why |
|---|---|---|
| Templater | **Must install now** | Actively maintained (maintainer transitioned to Zachatoo, releases through Aug 2026), zero ongoing risk, directly enables the templates this doc requires. |
| Dataview | **Must install now — with a watch flag** | Still the only mature querying engine, but it hasn't shipped a release in ~17 months while its own creator builds a successor ("Datacore"). Fine for give-to-get.com's simple frontmatter queries today; re-evaluate in 6–12 months. |
| Dataview Serializer | **Install soon** (week 3) | Real, separate, actively-maintained plugin (releases as recent as Sept 6, 2026) — not a Templater trick. Becomes necessary the moment Hermes needs to read query results from outside the Obsidian app (see §2.3 — this is the single most give-to-get-specific finding in this report). |
| QuickAdd | **Must install now** | Actively maintained, weekly-ish releases. This is your low-friction capture layer — the whole point of the vault falls apart without it. |
| Linter | **Install soon** (after templates exist) | In active development, but configure narrowly — its YAML rules can silently change a field's type, which would break Hermes' ability to parse frontmatter reliably. |
| Obsidian Local REST API | **Install later, staged** (week 3–4) | Real security surface: one API key grants full-vault read/write with **no folder-level scoping at all** — confirmed in the plugin's own docs. A past CVE (path traversal, CVSS 8.8) is patched in current versions, but you must verify your installed version. Do this last, and only behind a narrow wrapper you build yourself. |
| TaskNotes | **Must install now** | One file per task with clean YAML frontmatter — genuinely agent-friendly in a way inline checkboxes aren't. See §3 for the full comparison. |
| Tasks | **Avoid for now** | Don't run two task systems in a one-project vault. Use plain native Markdown checkboxes for throwaway inline TODOs instead of installing this plugin at all. |
| Various Complements | **Optional** | Genuinely safe (no code execution, unlike the other four "smart" plugins) and mildly useful for consistent `[[links]]`, but it's quality-of-life, not leverage. Install whenever, no rush. |

---

## 2. Plugin-by-Plugin Analysis

### 2.1 Templater

**What it does.** Template engine (`<% %>` syntax) with built-in helpers (`tp.date`, `tp.file`, `tp.frontmatter`) plus full arbitrary JavaScript execution and `tp.system` calls that can shell out to the OS. Runs once, at insertion time — not live like Dataview.

Maintained by Zachatoo (transitioned from original creator SilentVoid13); latest release v2.25.0, Aug 5 2026, with a steady monthly cadence through the year. Not archived, no compatibility issues reported. ~5.3k stars, ~5.5M cumulative downloads. [Repo](https://github.com/SilentVoid13/Templater) · [Docs](https://silentvoid13.github.io/Templater/)

**Value for give-to-get.com: Must install now.** This is what makes every YAML schema in §5 actually usable — without it, every new note means hand-copying frontmatter and getting a field wrong eventually. Given how much this session has emphasized "Hermes needs to reliably parse frontmatter," a template that generates it correctly every time is not optional.

**Three workflows:**
1. New feature spec: prompts for a name ("Share Contact by QR Code"), stamps `type: feature-spec`, `project: give-to-get`, `status: draft`, `created: <%tp.date.now()%>`, creates the file in `02-product/`.
2. New ADR: prompts for the decision being recorded, pre-fills `type: adr`, `status: proposed`, and inserts the standard ADR body skeleton (Context / Decision / Consequences).
3. Hermes handoff: `tp.system.prompt()` asks which persona is writing, stamps `persona:`, `created:`, and drops the note straight into `06-agent-memory/`.

**Recommended configuration.** Point Templater's "Template folder location" setting at `99-templates/`. Leave "Trigger Templater on new file creation" **off** — trigger templates explicitly via QuickAdd instead (§7), so template selection is a deliberate choice, not something that fires on every blank note. Don't install community template packs from strangers — a template file is executable code once used.

**Risks.** Templater JS and `tp.system` calls run with full local privilege — a malicious or careless template can read/write any file or shell out. Mitigation: only Aaron authors/edits files in `99-templates/`; see §8 for why Hermes should never get write access there.

---

### 2.2 Dataview (+ Dataview Serializer)

**What Dataview does.** Indexes frontmatter/inline fields across the vault and exposes a SQL-like query language (`TABLE`, `LIST`, `TASK`) plus an optional DataviewJS mode. Query results render live, in the Obsidian app, at view time — they are **not** written into the note as static text.

**Maintenance — the one real caveat in this whole report.** Latest release is v0.5.70, April 2025 — no release in roughly 17 months as of this writing. The changelog's own last entry mentions a stalled GitHub issue ("still attempting to fix #2557"). 636 of 1,470 issues remain open. Creator Michael Brenan is now building **Datacore**, a from-scratch successor prioritizing performance, currently pre-1.0 (v0.1.29). This isn't abandonment, but it is a plugin in low-maintenance mode while its own author's attention has moved elsewhere. [Repo](https://github.com/blacksmithgu/obsidian-dataview) · [Changelog](https://blacksmithgu.github.io/obsidian-dataview/changelog/) · [Datacore](https://github.com/blacksmithgu/datacore)

Despite that, it's still the most-installed query plugin (~9.3k stars, ~4.9M downloads) and give-to-get.com's needs are simple `TABLE`/`LIST` queries over frontmatter — the least likely feature surface to break even if Obsidian's API drifts further from what Dataview was last tested against.

**Security note, already handled for you.** DataviewJS had a real CVE — [CVE-2021-42057](https://github.com/blacksmithgu/obsidian-dataview/issues/615) — an unsafe `eval()` that allowed arbitrary command execution from a crafted note. Fixed in v0.4.13 by disabling JS Queries **by default**; it's opt-in. **Leave it off.** Nothing in this plan needs DataviewJS.

**What Dataview Serializer does, and why it matters specifically for give-to-get.com.** It's a real, separate, actively-maintained plugin (v3.1.2, Sept 6 2026) that depends on Dataview and does one thing: converts a live query's output into literal, static Markdown written back into the note. [Repo](https://github.com/dsebastien/obsidian-dataview-serializer)

Here's the give-to-get-specific reason this isn't cosmetic: **Dataview's query results only exist inside Obsidian's own renderer.** If Hermes reads a vault file directly — through the filesystem, through the Local REST API, through anything that isn't the Obsidian app itself — it sees the raw ` ```dataview ` query source, not the computed table. A "Chief of Staff dashboard" note that looks perfect when Aaron opens it in Obsidian is **invisible content** to an agent reading the same file any other way. Dataview Serializer is what turns a live query into something Hermes can actually consume.

**Value: Dataview is must-install-now; Serializer is install-soon (right when you start wiring up Hermes access in week 3).**

**Three workflows:**
1. `LIST FROM "03-engineering" WHERE supabase_area = "rls"` — every RLS-related engineering note, live, for Aaron browsing in Obsidian.
2. A materialized (Serializer'd) Chief-of-Staff dashboard note in `06-agent-memory/` that Hermes reads as plain text before starting a session — see §6, query 8.
3. `TABLE status, updated FROM "02-product" WHERE type = "feature-spec" AND status != "shipped"` on the vault's home note, so Aaron sees active work at a glance without opening every file.

**Recommended configuration.** Dataview: JS queries off, "Enable inline queries" on (harmless — inline fields, not code). Serializer: only materialize the 1–2 queries Hermes actually needs to read externally (the CoS dashboard); leave everything else as live dynamic queries for human browsing — materializing everything just creates redundant static content that goes stale.

**Risks.** Dataview: the maintenance slowdown is the risk — nothing actionable today, just don't build anything exotic (DataviewJS, complex nested queries) that would be painful to migrate to Datacore later if Dataview stalls further. Serializer: it overwrites note content on each run between marker comments — don't point it at a note a human is actively hand-editing, or a manual edit can get clobbered on the next serialize.

---

### 2.3 QuickAdd

**What it does.** Four building blocks: **Template Choice** (new note from a template), **Capture Choice** (append/insert into an existing file without opening it), **Macro Choice** (chains Template/Capture steps plus arbitrary User Scripts), **Multi Choice** (folder-like grouping). Actively maintained by chhoumann, releases roughly every 1–3 weeks, most recent Sept 2 2026. ~2.3k stars, ~2.1M downloads. [Repo](https://github.com/chhoumann/quickadd) · [Docs](https://quickadd.obsidian.guide/)

**Value: Must install now.** This is the actual capture mechanism — without a one-hotkey way to get a founder idea or a bug note into the vault, the whole system depends on Aaron remembering to manually open Obsidian, find the right folder, and copy a template by hand. That doesn't survive contact with a busy day.

**Three workflows:** see §7 for the full spec — Founder Idea Capture, New Feature Spec, Hermes Handoff Capture.

**Recommended configuration.** Use Template and Capture choices for everything in this plan. Skip Macro Choice's User Scripts entirely for now — they run with full Node/Obsidian privilege and no sandboxing, and nothing here needs that power yet.

**Risks.** QuickAdd's scripting API is explicitly designed to be callable from Templater and vice versa — combined, they can execute arbitrary local JavaScript and touch any vault file. Real risk only materializes if you install a shared "workflow pack" from someone else; everything in this document is hand-written and scoped to Template/Capture choices only.

---

### 2.4 Linter

**What it does.** Auto-formats Markdown and YAML frontmatter, on manual trigger, on save, or in an auto-format mode. Rule categories: YAML (~14 rules — timestamps, key sorting, array formatting), Headings (~5), Content (~16), Spacing (~19), Paste (~8), plus custom regex rules. In active development (commits within the last few days of this research) though formal version tags lag slightly behind master. Not archived, no maintainer handoff. ~2k stars, ~1M downloads. [Repo](https://github.com/platers/obsidian-linter) · [Docs](https://platers.github.io/obsidian-linter/)

**Value: Install soon**, right after your first templates exist and you've written a handful of real notes by hand — not before, and not with every rule on.

**Three workflows:**
1. A single YAML rule auto-stamps `updated:` to today whenever a note is saved, so Dataview's "last 30 days" and "needs review" queries stay accurate without anyone remembering to bump a date by hand.
2. A key-sort rule keeps every note's frontmatter in the same field order, so a human skimming raw Markdown (or Hermes doing a naive read) always finds `status:` in the same place.
3. Per-file rule exclusion (a frontmatter flag) turns Linter off for `99-templates/` files, so it never "helpfully" reformats a Templater template's own YAML placeholders into something Templater can't parse.

**Recommended configuration — the smallest durable set, not the default set.** Enable only: YAML timestamp rules (created/updated), YAML key sorting, trailing-whitespace, and one or two spacing rules. **Explicitly leave off** anything that changes a field's *type* — a rule that coerces a scalar to an array (or vice versa) will silently break a strict schema Hermes depends on. Start with trigger = "manual run only," not auto-format-on-save, until you trust the rule set on real notes; flip to on-save later if nothing's gone wrong after a week or two.

**Risks.** This is the one place in the whole plan where a well-intentioned automation could quietly corrupt the exact machine-readable structure this system depends on. No official warning exists for this — it's inferred from the rule set's documented behavior — so treat it as something to test, not something to trust.

---

### 2.5 Obsidian Local REST API

Full staged rollout plan is in §8 — this section covers what it is and why it's rated "later."

**What it does.** A local HTTPS server (port 27124, self-signed cert; plain HTTP optionally available on 27123, off by default) authenticated with a bearer-token API key generated in plugin settings. Surface area: `/vault/{path}` (full CRUD — GET/PUT/PATCH/POST/DELETE — on any file by path), `/active/` (same, on the currently open file), `/search/` (full-text and structured), `/commands/{id}/` (execute any registered Obsidian command), and — as of v5.1.0 — a built-in `/mcp/` endpoint, an official MCP server using the same auth. Actively maintained, current v5.1.0, ~712k downloads. [Repo](https://github.com/coddingtonbear/obsidian-local-rest-api)

**The finding that matters most: there is no folder-level scoping.** One API key grants access to the *entire vault* via path-based addressing — this is confirmed directly in the plugin's own documentation, not an assumption. Anything you want Hermes restricted to has to be enforced by something sitting *between* Hermes and this API, because the plugin itself won't do it.

**A patched but real CVE.** [GHSA-62gx-5q78-wrvx](https://advisories.gitlab.com/npm/obsidian-local-rest-api/GHSA-62gx-5q78-wrvx/) — authenticated path traversal via double-encoded `../` sequences, CVSS 8.8 (High), allowing arbitrary file read/write/delete outside the vault at Obsidian's process privilege. Fixed in 4.1.3+; current is 5.1.0. **Action item: after installing, check Settings → Community Plugins → Local REST API and confirm the version shown is well past 4.1.3.**

**Value: install later, staged, never as a blanket grant.** Rated below Templater/QuickAdd/Dataview/TaskNotes not because it's low-value — a durable Hermes memory layer is the whole point of this exercise — but because it's the only plugin here that opens a live network listener with full-vault access and no native permission model. Sequence it last.

**Three workflows** (the good version, once staged per §8):
1. Chief of Staff reads `06-agent-memory/*` and the materialized dashboard note at session start via the read-only wrapper, instead of Aaron pasting status into a prompt.
2. Coder (Ananda) writes a session handoff into `06-agent-memory/handoffs/` at the end of a work session — the durable memory the brief actually asked for.
3. Researcher reads `05-research/*` for prior investigation before starting new research, avoiding duplicate work.

**Recommended configuration.** HTTPS only (leave the plain-HTTP option off). Generate the key, store it exactly like the GitHub App private key from earlier this session — in Hermes' own `.env`, `chmod 600`, never echoed, never in a shell arg. Full detail in §8.

**Risks.** Covered in depth in §8 — this is the section of the report to read most carefully.

---

### 2.6 TaskNotes vs Tasks

See §3 for the full comparison and recommendation (**install TaskNotes, not Tasks**).

---

### 2.7 Various Complements

**What it does.** IDE-style autocomplete — completes words/phrases from the current file, internal `[[links]]` against real vault notes, frontmatter keys/values, and custom dictionaries. No code execution of any kind — purely a text-suggestion engine, which makes it the only plugin in this list with no security surface to discuss. Actively maintained, most recent release Aug 26 2026 (a routine dependency-hygiene patch), ~914 stars, ~585k downloads. [Repo](https://github.com/tadashi-aikawa/obsidian-various-complements-plugin)

**Value: Optional.** Genuinely useful once the vault has enough notes that typing `[[Supabase RLS` should reliably suggest the real note instead of creating a near-duplicate with slightly different capitalization — but it's convenience, not leverage. Install whenever it's convenient; nothing else in this plan depends on it.

**Three workflows:**
1. Typing `[[Supa` after a few weeks of real notes suggests `[[Supabase RLS Policies]]` instead of letting Aaron create a second, slightly-differently-named note on the same topic.
2. Frontmatter value autocomplete means typing `status: ap` in a new ADR suggests `accepted` — pulled from values already used elsewhere in the vault — instead of a typo like `Accepted` that a Dataview `WHERE status = "accepted"` query would silently miss.
3. Tag autocomplete keeps `#give-to-get` consistent instead of accidentally forking into `#givetoget` or `#GiveToGet` across different notes.

**Recommended configuration.** Enable internal-link completion and frontmatter completion; current-file word completion is optional taste. No folder restrictions needed — it's read-only-by-nature.

**Risks.** None beyond routine dependency hygiene, which the maintainer is already handling.

---

## 3. Required Comparison: TaskNotes vs Tasks

| Dimension | TaskNotes | Tasks |
|---|---|---|
| Best use case | Structured, queryable task records an agent needs to read/update reliably | Lightweight inline TODOs embedded in prose (meeting notes, daily notes) |
| Setup complexity | Low — install, point at a folder | Low — install, start typing checkboxes |
| State-machine support | Yes — fully custom statuses/priorities/fields, README-documented | Yes — `TODO`/`IN_PROGRESS`/`ON_HOLD`/`DONE`/`CANCELLED`/`NON_TASK`, each with configurable symbol/behavior |
| Dataview compatibility | Not documented/positioned as an integration — TaskNotes uses Obsidian's native **Bases** for querying. Frontmatter is plain YAML, so Dataview *can* read it, but this isn't a supported, documented path. | Commonly run alongside Dataview in the community; own query engine, no hard conflicts found, but two overlapping query systems |
| AI/Hermes friendliness | **High** — one clean file per task, plain YAML frontmatter, trivially parsed and edited by a script without touching surrounding content | **Lower** — metadata is emoji+text shorthand embedded inline inside a shared note; editing programmatically risks corrupting the note around it |
| Git friendliness | Isolated diffs per task (each change touches exactly one small file); tradeoff is many small files | Edits land as single-line diffs inside larger shared files — fewer files, but more collision surface per file |
| Ability to manage feature work | Strong — a task-per-file model maps cleanly onto "one task = one feature-spec sub-item," cross-linkable via `related:` | Workable, but harder for Hermes to safely update a status embedded mid-paragraph in someone else's note |
| Ability to manage founder/CoS work | Strong — same clean model works for founder task tracking as for engineering tasks | Workable for a human, awkward for an agent to touch reliably |
| Long-term maintainability | Active (v4.12.5, ~10-day-old release, 1.39M downloads) but a fairly heavy open-issue backlog (398 open) for its size | Very active and the most-adopted of the two (4.18M downloads, 139 releases) |
| Recommendation for this project | **Install** | **Don't install** |

**Recommendation: install TaskNotes, not Tasks, and not both.** A one-project vault with two AI personas that need to read and update task state doesn't benefit from running two incompatible task systems — it just creates ambiguity about which one is authoritative, and Hermes has to guess. TaskNotes' one-file-per-task model is the more agent-friendly of the two by a wide margin: an agent can locate exactly one file and read or write clean YAML, instead of parsing an emoji-encoded shorthand string embedded inside a paragraph it didn't write and shouldn't otherwise touch. Tasks is more mature and more widely adopted, but that maturity is optimized for a different use case (fast inline capture in a personal note-taking workflow) than "an AI agent needs to reliably update a task's state without corrupting a document."

For quick, throwaway inline TODOs inside a meeting note or feature spec (`- [ ] follow up with Mark on the intro flow`), just use Obsidian's **native checkbox syntax** — no plugin required. Reserve TaskNotes for anything that needs a real status, owner, or priority that Dataview/Bases or Hermes will query.

---

## 4. Recommended Vault Architecture

```text
give-to-get-vault/
├── 00-inbox/
├── 01-projects/
│   └── give-to-get/           # roadmap + cross-cutting index only
├── 02-product/
├── 03-engineering/
├── 04-operations/
├── 05-research/
├── 06-agent-memory/
│   └── handoffs/
├── tasks/                      # all TaskNotes files, flat, one level
└── 99-templates/
```

One deliberate change from the proposed skeleton: **`02-product` through `06-agent-memory` sit at the vault root, not nested under `01-projects/give-to-get/`.** With exactly one real project today, nesting everything under a project folder adds a path segment for no benefit — you'd write `01-projects/give-to-get/03-engineering/...` a thousand times for nothing. `01-projects/give-to-get/` stays as the home for the roadmap and a cross-linking index note; if A. Wykoff Consulting ever runs a second project through this vault, mirror the same `02-06` substructure under `01-projects/<other-project>/` at that point. Also added a flat `tasks/` folder — TaskNotes works best with a single, dedicated home for its per-task files rather than scattering them across topic folders, and a flat `FROM "tasks"` is simpler for every Dataview query in §6 than unioning multiple folders.

| Folder | Belongs there | Doesn't belong | Note types | Hermes access | Git-versioned |
|---|---|---|---|---|---|
| `00-inbox/` | Raw QuickAdd captures, unsorted bug notes before triage | Anything already processed/filed | inbox capture (minimal frontmatter) | Chief of Staff: read-only | Yes |
| `01-projects/give-to-get/` | Roadmap, milestones, cross-cutting index | Day-to-day implementation detail (→ 02–06) | meeting/planning note | All personas: read-only | Yes |
| `02-product/` | PRD sections, feature specs, product decisions | Engineering detail, raw bug reports | feature-spec, product-decision | Read-only for all personas — agents may *draft* new specs for review, never edit existing decisions | Yes |
| `03-engineering/` | ADRs, Supabase schema/RLS docs, Next.js implementation notes, API contracts | Actual source code (lives in the repo — cross-link via `repo_path`, don't duplicate) | adr, supabase-doc, implementation-note | Coder: read/write. Others: read-only | Yes |
| `04-operations/` | Vercel runbooks, deploy-discipline notes, incident/postmortem notes that **cross-link to the canonical GitHub Issue** (mirrors the exact convention this project already uses for `bugs/*.md` in the claude.ai Project — don't duplicate status, link to it) | The bug tracker itself (stays in GitHub Issues), any production secrets/logs | incident, runbook | Coder + Chief of Staff: read/write | Yes |
| `05-research/` | Market/competitor research, plugin evaluations (like this document), one-off spikes | Decisions (those graduate to 02/03 once made) | research | Researcher: read/write. Others: read-only | Yes |
| `06-agent-memory/` | Hermes session summaries, handoffs, agent working notes | Anything meant to be the permanent product record (graduate it out to 02/03/04 once stable) | agent-handoff | **All personas: read/write** — the one folder built for this | Yes (see §8 note on commit-message discipline) |
| `tasks/` | One file per TaskNotes task | — | task (TaskNotes-managed frontmatter) | All personas: read/write | Yes |
| `99-templates/` | Templater templates, QuickAdd targets | Actual content | — | **Read-only, never write** — a template is executable code every time it's *used*; agent write access here is a supply-chain risk, not just a content risk | Yes — review diffs here carefully; it's rare, small, high-blast-radius changes |

---

## 5. Note Types and YAML Schemas

Common base fields on every type: `type`, `project`, `status`, `owner`, `created`, `updated`, `tags`, `related`. Additions below are the ones that earn their keep for this specific project — nothing decorative.

**1. Feature specification**
```yaml
type: feature-spec
project: give-to-get
status: draft   # draft | in-review | approved | building | shipped | dropped
owner:
priority: p1    # p0 | p1 | p2
created:
updated:
tags: []
related: []
repo_path:
```

**2. Product decision**
```yaml
type: product-decision
project: give-to-get
status: proposed   # proposed | decided | reversed
owner:
created:
updated:
tags: []
related: []
decision:           # one-line summary — lets a Dataview TABLE show the outcome without opening the note
```

**3. Architecture decision record (ADR)**
```yaml
type: adr
project: give-to-get
status: proposed   # proposed | accepted | superseded | deprecated
owner:
created:
updated:
tags: []
related: []
decision:
repo_path:
```

**4. Supabase schema/RLS documentation**
```yaml
type: supabase-doc
project: give-to-get
status: current    # current | stale
owner:
created:
updated:
tags: []
related: []
supabase_area: rls   # schema | rls | trigger | function
repo_path:
```

**5. Next.js component/feature implementation note**
```yaml
type: implementation-note
project: give-to-get
status: complete   # draft | complete | needs-tests
owner:
created:
updated:
tags: []
related: []
repo_path:
```

**6. Bug/incident report** (technical archive only — GitHub Issues stays canonical, per the convention already established for this project)
```yaml
type: incident
project: give-to-get
status: open       # open | resolved
priority: p0
owner:
created:
updated:
tags: []
related: []
repo_path:
github_issue:      # full URL — added beyond the brief's suggested fields because this project already treats GitHub Issues as the source of truth; every incident note must link back to it
```

**7. Research note**
```yaml
type: research
project: give-to-get
status: active     # active | needs-review | archived
owner:
created:
updated:
tags: []
related: []
```

**8. Task** (TaskNotes manages `title`/`status`/`priority`/`due`/`contexts`/`projects` natively via its own UI — these two fields are the only manual additions worth layering on top)
```yaml
project: give-to-get
related: []
```

**9. Meeting/founder planning note**
```yaml
type: meeting
project: give-to-get
owner:
created:
tags: []
related: []
```
(No `status` field — a meeting note doesn't have a lifecycle the same way; if it produces action items, those become TaskNotes tasks or graduate to a decision note.)

**10. Hermes agent handoff/session summary**
```yaml
type: agent-handoff
project: give-to-get
persona: coder     # chief-of-staff | coder | researcher
status: complete   # complete | needs-follow-up
created:
related: []
repo_path:         # if the session touched a specific commit/PR
```

---

## 6. Required Templates

All five below are Templater-compatible, kept to minimal JS (just `tp.date.now()` and `tp.file.title` / `tp.system.prompt()`), and live in `99-templates/`.

**1. Feature specification** — `99-templates/feature-spec.md`
```markdown
---
type: feature-spec
project: give-to-get
status: draft
owner: <% tp.system.prompt("Owner") %>
priority: p1
created: <% tp.date.now("YYYY-MM-DD") %>
updated: <% tp.date.now("YYYY-MM-DD") %>
tags: []
related: []
repo_path:
---

# <% tp.file.title %>

## Problem
What's broken or missing, for whom.

## Proposed solution


## Scope (v1)
-

## Explicitly out of scope
-

## Open questions
-
```

**2. Architecture decision record** — `99-templates/adr.md`
```markdown
---
type: adr
project: give-to-get
status: proposed
owner: <% tp.system.prompt("Owner") %>
created: <% tp.date.now("YYYY-MM-DD") %>
updated: <% tp.date.now("YYYY-MM-DD") %>
tags: []
related: []
decision: <% tp.system.prompt("One-line decision summary") %>
repo_path:
---

# <% tp.file.title %>

## Context
What prompted this decision.

## Decision
<% tp.frontmatter.decision %> — expand here.

## Consequences
What this makes easier, what it makes harder.

## Alternatives considered
-
```

**3. Task** — `99-templates/task.md` (a Templater fallback; TaskNotes' own "Create task" command is the primary path and manages its frontmatter automatically — use this only if creating a task file by hand outside TaskNotes' UI)
```markdown
---
title: <% tp.file.title %>
status: open
priority: normal
due:
contexts: []
projects: [give-to-get]
project: give-to-get
related: []
---

## Notes

```

**4. Research note** — `99-templates/research.md`
```markdown
---
type: research
project: give-to-get
status: active
owner: <% tp.system.prompt("Owner") %>
created: <% tp.date.now("YYYY-MM-DD") %>
updated: <% tp.date.now("YYYY-MM-DD") %>
tags: []
related: []
---

# <% tp.file.title %>

## Question
What are we trying to find out.

## Findings


## Sources
-

## Next step / decision this feeds
```

**5. Hermes handoff / implementation summary** — `99-templates/agent-handoff.md`
```markdown
---
type: agent-handoff
project: give-to-get
persona: <% tp.system.prompt("Persona (chief-of-staff / coder / researcher)") %>
status: complete
created: <% tp.date.now("YYYY-MM-DD") %>
related: []
repo_path:
---

# Session: <% tp.date.now("YYYY-MM-DD HH:mm") %>

## What happened


## Decisions made


## Still open / next session should


## Links
-
```

---

## 7. Required Dataview Queries

Live queries #1–7 render dynamically for Aaron browsing in Obsidian. Query #8 is the one to materialize with Dataview Serializer once it's installed (§2.2) — it's the one Hermes needs to read as literal text.

**1. All active features**
```dataview
TABLE status, owner, priority, updated
FROM "02-product"
WHERE type = "feature-spec" AND status != "shipped" AND status != "dropped"
SORT priority ASC, updated DESC
```

**2. All blocked tasks**
```dataview
TABLE status, due, priority
FROM "tasks"
WHERE status = "blocked"
SORT due ASC
```

**3. Notes related to Supabase auth/RLS**
```dataview
LIST
FROM "03-engineering"
WHERE type = "supabase-doc" AND supabase_area = "rls"
SORT updated DESC
```

**4. Unresolved architecture decisions**
```dataview
TABLE status, owner, updated
FROM "03-engineering"
WHERE type = "adr" AND status = "proposed"
SORT updated ASC
```

**5. Implementation notes lacking tests**
```dataview
TABLE owner, updated
FROM "03-engineering"
WHERE type = "implementation-note" AND status = "needs-tests"
SORT updated ASC
```

**6. Research notes needing review**
```dataview
TABLE owner, created
FROM "05-research"
WHERE type = "research" AND status = "needs-review"
SORT created ASC
```

**7. Decisions made in the last 30 days**
```dataview
TABLE decision, status, updated
FROM "02-product" OR "03-engineering"
WHERE (type = "product-decision" OR type = "adr") AND updated >= date(today) - dur(30 days)
SORT updated DESC
```

**8. Chief of Staff dashboard — materialize this one**
```dataview
TABLE priority, status, owner
FROM "02-product" OR "04-operations"
WHERE (priority = "p0" OR priority = "p1") AND status != "shipped" AND status != "resolved"
SORT priority ASC
```
```dataview
TABLE due, priority
FROM "tasks"
WHERE status = "blocked"
SORT due ASC
```
```dataview
TABLE decision, updated
FROM "02-product" OR "03-engineering"
WHERE (type = "product-decision" OR type = "adr") AND updated >= date(today) - dur(14 days)
SORT updated DESC
```

Run Dataview Serializer on this note's queries manually (its command palette action) at the start of any session where Hermes' Chief of Staff persona needs fresh context — no need for an auto-scheduler at this scale; a habit of "serialize before you ask Hermes to catch up" is simpler and just as effective.

---

## 8. Required QuickAdd Workflows

Capped at five, prioritizing founder and engineering capture speed.

**1. Founder Idea Capture**
- Trigger: hotkey (e.g. `Cmd+Shift+I`)
- Asks: free-text idea
- Saves to: `00-inbox/inbox.md`, appended under today's date heading
- Template: inline Capture format string — `- [{{DATE}}] {{VALUE}}`
- Hermes may invoke: **No** — this is Aaron's raw voice; agents reading it is fine, agents writing into it muddies authorship.
- Example: `- [2026-09-08] What if we let a workspace set a "no personal domains" exception for one specific approved partner?`

**2. New Feature Spec**
- Trigger: command palette / hotkey
- Asks: feature name, one-line owner
- Saves to: `02-product/<name>.md`
- Template: `feature-spec.md`
- Hermes may invoke: **Yes, to draft** — Coder or Researcher can create a first-pass spec for review; status stays `draft` until Aaron flips it.
- Example: invoking with "Share Contact by QR Code" creates `02-product/Share Contact by QR Code.md` pre-filled per §6 template 1.

**3. Quick Bug Capture**
- Trigger: hotkey
- Asks: one-line description, severity guess
- Saves to: `04-operations/triage.md`, appended
- Template: inline capture — `- [{{DATE}}] [{{VALUE:severity}}] {{VALUE:description}}`
- Hermes may invoke: **Yes** — this is a five-second flag, not the bug tracker; anything real still gets filed as a GitHub Issue per this project's existing convention, this just catches the thought before it's lost.
- Example: `- [2026-09-08] [p1] Settings save silently no-ops if linkedin_url regex rejects a valid uk.linkedin.com URL — check the validation.`

**4. New ADR**
- Trigger: command palette
- Asks: decision one-liner, owner
- Saves to: `03-engineering/<decision>.md`
- Template: `adr.md`
- Hermes may invoke: **Yes** — Coder is often the one proposing an architecture decision (e.g. the RLS `SECURITY DEFINER` helper pattern from this session would be a good first real ADR).
- Example: invoking with "Use SECURITY DEFINER helper functions for cross-workspace RLS lookups" creates a pre-filled ADR ready for the Context/Consequences sections.

**5. Hermes Handoff Capture**
- Trigger: command palette (invoked by Hermes itself at end of session, or by Aaron)
- Asks: persona, status
- Saves to: `06-agent-memory/handoffs/<timestamp>.md`
- Template: `agent-handoff.md`
- Hermes may invoke: **Yes — this one is built for that.** It's the durable memory layer the whole brief is aiming at.
- Example: Ananda invokes it at the end of a session, producing a handoff note documenting the topbar-profile-identity PR, the branch cleanup, and the schema_migrations correction — exactly the kind of session this very conversation just had.

---

## 9. Hermes + Local REST API: Security and Rollout Plan

1. **Install now or later?** Later — week 3–4, after the vault structure and note conventions in §4–§7 are actually in use by hand for at least a couple of weeks. Installing a live network listener before there's real content or habits in place just opens a surface for no benefit yet.

2. **Read-only or read/write to start?** **Read-only, full stop**, for the entire first integration window. Do not enable write access until the read-only path has been used and manually audited for at least several real sessions.

3. **Exact folders Hermes may read:** `06-agent-memory/*` (its own), `03-engineering/*`, `04-operations/*`, `05-research/*`. Add `02-product/*` (read-only) once the above is proven stable — product context is useful for Chief of Staff, but product *authorship* stays human.

4. **Exact folders Hermes may write:** `06-agent-memory/*` only, and only after the read-only period is validated.

5. **Folders Hermes must never write:** `99-templates/` (a template is code that runs every future time it's used — write access here is a supply-chain risk, not just a content risk), `02-product/` (founder decision authorship), `01-projects/give-to-get/` (roadmap), `00-inbox/` (Aaron's raw capture stream).

6. **The architectural point that matters most:** the plugin itself provides **no folder-level access control** — one API key opens the entire vault via `/vault/{path}`. Every restriction above has to be enforced by something *between* Hermes and the real API: a thin wrapper script that allowlists paths before forwarding a request, and rejects anything outside it. This is the same shape of fix this project already reaches for elsewhere — a narrow, purpose-built gate in front of broad access, the same idea as the `SECURITY DEFINER` helper functions used for cross-workspace Supabase lookups. Don't rely on Hermes' own judgment about which paths it "should" touch; enforce it outside the model.

7. **Protecting the API key.** Store it exactly like the GitHub App private key from earlier this session: in Hermes' own `.env`, `chmod 600`, never echoed to a terminal, never passed as a shell argument that lands in process listing or history, never pasted into any Obsidian note (including this one, and including any future "how we set this up" documentation note — reference the env var's *name*, never its value).

8. **Keeping other secrets out of the vault entirely.** No `.env` contents, no Supabase service_role key, no Vercel tokens, no GitHub tokens, no customer contact records or emails — ever, in any note, "for reference" or otherwise. If a note needs to describe a secret's existence, name the variable and where it lives on disk, the same pattern already used in every message this session sent to Ananda.

9. **A patched CVE to verify.** [GHSA-62gx-5q78-wrvx](https://advisories.gitlab.com/npm/obsidian-local-rest-api/GHSA-62gx-5q78-wrvx/) — authenticated path traversal, CVSS 8.8, fixed in 4.1.3+. Confirm the installed version (check Settings → Community Plugins) is meaningfully past that before generating a key, and keep the plugin updated going forward since it runs a live listener.

10. **Testing safely before automated writes.** Configure the wrapper to only issue GET requests for the first real test window. Manually check (via Obsidian's own UI, or `git status`/`git diff` on the vault repo) that nothing unexpected changed. Only then flip on a single, narrow write test — have Hermes write exactly one handoff note into `06-agent-memory/handoffs/` — and inspect that specific diff by hand before trusting the path further.

11. **Rollback via git.** The whole vault should be git-versioned (§4), so a Hermes write is just a normal commit — review it, and `git revert`/`git checkout` the file if it's wrong. One durable convention worth adopting: have Hermes prefix its own vault commit messages (e.g. `agent-memory: <summary>`) so `git log --grep agent-memory:` gives Aaron a complete audit trail of everything an agent has ever written to the vault, at a glance — the same discipline already established for Ananda's GitHub Issues footer this session.

12. **MCP vs raw REST.** Prefer the plugin's own built-in MCP server (`/mcp/`, shipped as of v5.1.0) over hand-rolled REST calls — it's the vendor's own stated intended path now, and MCP's structured tool definitions integrate far more naturally with an agent's tool-calling loop than raw HTTP does. Important: MCP talks to the *same* underlying vault access with the *same* lack of folder scoping — switching from REST to MCP doesn't remove the need for the wrapper in point 6, it just changes the protocol the wrapper sits in front of.

---

## 10. Two-Hour Setup-Today Checklist

- **0:00–0:15** — Create the folder skeleton from §4 by hand (`00-inbox` through `99-templates`, plus `tasks/`).
- **0:15–0:30** — Install and enable: Templater, Dataview (leave JS queries off), QuickAdd, Linter, Various Complements, TaskNotes. **Do not** install Local REST API or Dataview Serializer yet.
- **0:30–0:50** — Paste the five templates from §6 into `99-templates/`; point Templater's template-folder setting there.
- **0:50–1:05** — Configure Linter with only the narrow rule set from §2.4 (timestamps, key sort, trailing whitespace); set trigger to manual-run, not auto-format-on-save, for now.
- **1:05–1:25** — Set up QuickAdd workflows 1, 2, and 5 from §8 (Founder Capture, New Feature Spec, Hermes Handoff) — defer 3 and 4 to later this week.
- **1:25–1:40** — Hand-write one real feature spec and one real ADR using the new templates — good candidates: turn today's actual "profile identity in TopBar" feature and the RLS `SECURITY DEFINER` pattern into your first two real notes.
- **1:40–1:55** — Create a `Dashboard.md` note at the vault root, paste in queries 1, 2, and 8 from §7, confirm they render against your two new notes.
- **1:55–2:00** — `git init` the vault (if not already) and make the first commit.

---

## 11. 30-Day Phased Rollout

**Week 1 — human-only.** Complete the checklist above. Use TaskNotes for every new feature/engineering task. No agent access to the vault yet — everything so far is Aaron working by hand.

**Week 2 — real content, remaining capture workflows.** Add QuickAdd workflows 3 (Quick Bug Capture) and 4 (New ADR). Start writing real ADRs and implementation notes for decisions actually being made — this session alone produced at least two good candidates: the RLS `SECURITY DEFINER` pattern, and the messaging feature's "adder needs reach, not mutual connection" permission rule.

**Week 3 — Dataview Serializer, and prep (not launch) of Local REST API.** Install Dataview Serializer; materialize the Chief of Staff dashboard query. Install Local REST API but stop there for now — generate the key, verify the version is past the patched CVE, but don't build or enable the Hermes-facing wrapper yet.

**Week 4 — staged Hermes access.** Build the narrow read-only wrapper described in §9. Point Chief of Staff at it, read-only, against `06-agent-memory/`, `03-engineering/`, `04-operations/`, and `05-research/` only. Validate for several days by hand. Only if that's gone cleanly, flip on scoped write access to `06-agent-memory/` alone, and have Hermes produce its first real handoff note through the automated path rather than manually.

---

## Sources

- Templater: [GitHub](https://github.com/SilentVoid13/Templater) · [Docs](https://silentvoid13.github.io/Templater/) · [Releases](https://github.com/SilentVoid13/Templater/releases)
- Dataview: [GitHub](https://github.com/blacksmithgu/obsidian-dataview) · [Changelog](https://blacksmithgu.github.io/obsidian-dataview/changelog/) · [CVE-2021-42057 / issue #615](https://github.com/blacksmithgu/obsidian-dataview/issues/615) · [Datacore (successor, pre-1.0)](https://github.com/blacksmithgu/datacore)
- Dataview Serializer: [GitHub](https://github.com/dsebastien/obsidian-dataview-serializer) · [Docs](https://dsebastien.github.io/obsidian-dataview-serializer/) · [Community listing](https://community.obsidian.md/plugins/dataview-serializer)
- QuickAdd: [GitHub](https://github.com/chhoumann/quickadd) · [Docs](https://quickadd.obsidian.guide/) · [API docs](https://quickadd.obsidian.guide/docs/QuickAddAPI/)
- Linter: [GitHub](https://github.com/platers/obsidian-linter) · [Docs](https://platers.github.io/obsidian-linter/) · [Rules reference](https://github.com/platers/obsidian-linter/blob/master/docs/rules.md)
- Obsidian Local REST API: [GitHub](https://github.com/coddingtonbear/obsidian-local-rest-api) · [Obsidian Stats](https://www.obsidianstats.com/plugins/obsidian-local-rest-api) · [CVE GHSA-62gx-5q78-wrvx](https://advisories.gitlab.com/npm/obsidian-local-rest-api/GHSA-62gx-5q78-wrvx/)
- TaskNotes: [GitHub](https://github.com/callumalpass/tasknotes) · [Docs](https://tasknotes.dev/obsidian/)
- Tasks: [GitHub](https://github.com/obsidian-tasks-group/obsidian-tasks) · [Docs](https://publish.obsidian.md/tasks/) · [Status types](https://publish.obsidian.md/tasks/Getting+Started/Statuses/Status+Types)
- Various Complements: [GitHub](https://github.com/tadashi-aikawa/obsidian-various-complements-plugin) · [Docs](https://tadashi-aikawa.github.io/docs-obsidian-various-complements-plugin/)
