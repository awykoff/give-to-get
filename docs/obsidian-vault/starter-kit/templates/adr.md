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