---
type: conventions
project: give-to-get
created: 2026-09-08
updated: 2026-09-08
tags:
  - conventions
  - project/give-to-get
---

# Vault conventions

> YAML schemas for every note type, captured from `05-research/give-to-get-obsidian-plugin-strategy.md` §5. Anyone writing a note — human or agent — should pick the matching schema below and fill every required field. If you find yourself wanting a field that isn't in the schema, add it to that schema's note in `CONVENTIONS.md` first and then use it; don't smuggle novel fields through silently.
>
> Conventions source: the strategy file in `05-research/`. This note is the *short form* so future note authors don't have to re-read the full doc every time. When the two disagree, the strategy wins.

---

## The two coexisting hierarchies

This vault has two parallel folder hierarchies from two different setup passes. They're additive, not conflicting, but you have to know which one to put a new note in:

**Title-Case (older, from `obsidian-vault-setup-part-b.sh`):**
- `00-Meta/` — frontmatter schemas and meta-documents
- `01-Projects/give-to-get/{ADRs, Architecture, Lessons, Sessions, Snippets, Specs}/` — project structure
- `02-Agents/` — Hermes agent profiles (Ananda, Sariputra)
- `03-Templates/` — hand-written template notes (not Templater templates)

**lowercase (newer, from the plugin strategy):**
- `00-inbox/` — raw QuickAdd captures, unsorted
- `01-projects/give-to-get/` — roadmap + cross-cutting index only
- `02-product/` — feature specs, product decisions, PRDs
- `03-engineering/` — ADRs, Supabase docs, implementation notes
- `04-operations/` — runbooks, deploy discipline, incidents
- `05-research/` — research notes (including the strategy file itself)
- `06-agent-memory/handoffs/` — Hermes session summaries and handoffs
- `tasks/` — TaskNotes task files (flat, one folder)
- `99-templates/` — Templater templates (NOT for hand-written content; agent-write forbidden)

**Quick rule for new notes:** prefer the strategy's lowercase hierarchy. Only fall back to the older Title-Case folders if the new note type doesn't have a clear home in the new structure (e.g. a `Frontmatter Schemas` doc belongs in `00-Meta/`, not `05-research/`).

---

## Common base fields (every note type)

```yaml
type: <one of the schemas below>
project: give-to-get   # always; this is a one-project vault
status: <lifecycle — see per-type>
owner: <name or empty>
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: []
related: []            # wikilinks to other notes / GitHub URLs
```

`type`, `project`, `status`, `owner`, `created`, `updated`, `tags`, `related` are common to most types. The per-type schemas below list the additions that earn their keep.

---

## 1. Feature specification

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
repo_path:      # path in the give-to-get repo when the spec graduates to code
```

Template: `99-templates/feature-spec.md`.

## 2. Product decision

```yaml
type: product-decision
project: give-to-get
status: proposed   # proposed | decided | reversed
owner:
created:
updated:
tags: []
related: []
decision:         # one-line summary — lets Dataview TABLE show the outcome without opening the note
```

## 3. Architecture decision record (ADR)

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

Template: `99-templates/adr.md`. **Note:** there's an existing `01-Projects/give-to-get/ADRs/` folder from the older hierarchy. New ADRs should go in `03-engineering/` per the strategy; old ones in the legacy folder should be migrated when convenient.

## 4. Supabase schema/RLS documentation

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

## 5. Next.js component / feature implementation note

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

## 6. Bug / incident report

**Technical archive only — GitHub Issues on `awykoff/give-to-get` stays canonical.** Use this only for incident postmortems that need durable vault-side detail (cross-link to the canonical issue).

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
github_issue:    # full URL — every incident note must link back to the GitHub Issue
```

## 7. Research note

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

Template: `99-templates/research.md`.

## 8. Task (TaskNotes-managed)

TaskNotes manages `title`, `status`, `priority`, `due`, `contexts`, `projects` natively via its own UI. These two fields are the only manual additions worth layering on top:

```yaml
project: give-to-get
related: []
```

Template: `99-templates/task.md` (fallback; prefer TaskNotes' own "Create task" command).

## 9. Meeting / founder planning note

```yaml
type: meeting
project: give-to-get
owner:
created:
tags: []
related: []
```

**No `status` field.** A meeting note doesn't have a lifecycle the same way; if it produces action items, those become TaskNotes tasks or graduate to a decision note.

## 10. Hermes agent handoff / session summary

```yaml
type: agent-handoff
project: give-to-get
persona: coder     # chief-of-staff | coder | researcher
status: complete   # complete | needs-follow-up
created:
related: []
repo_path:         # if the session touched a specific commit/PR
```

Template: `99-templates/agent-handoff.md`. Lands in `06-agent-memory/handoffs/<timestamp>.md`.

---

## Cross-cutting rules

- **Never invent field types.** If a schema says `status: draft`, don't write `status: "draft, needs review"` or anything else that doesn't match the enum. Dataview queries assume the enums as written.
- **YAML keys are sorted alphabetically by Linter.** Don't hand-format a different order — Linter will rewrite it on next save.
- **`updated` should be bumped on every meaningful edit.** Linter can auto-stamp this if configured (see strategy §2.4); until then, bump it by hand.
- **`related` is a list of wikilinks or full URLs.** Prefer wikilinks (`[[Note Name]]`) within the vault, full GitHub URLs when linking out to issues/PRs.
- **`tags` should use `namespace/value` form** for queryability: `project/give-to-get`, `status/active`, `area/migrations`, etc. Don't tag without a namespace unless it's truly a free-form tag.
- **Templater templates (`99-templates/`) are code.** Don't write to that folder from any agent context. Don't install community template packs from strangers.