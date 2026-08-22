# Running give-to-get.com in Hermes Agent

This repo is built with [Hermes Agent](https://hermes-agent.nousresearch.com)
(Nous Research). There's no persistent named swarm to spawn — Hermes loads
`AGENTS.md` automatically and treats each area of the stack (architecture,
frontend, database, backend, auth, testing, docs) as a **skill** it loads on
demand.

## 1. Install Hermes (one time)

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
hermes setup --portal   # one OAuth covers a model + web/image/TTS/browser tools
```

## 2. Add this repo's skills to your local Hermes install

Skills live in this repo under `skills/` in the default tap layout, so you
can either symlink them in directly or add the repo as a tap.

**Symlink (fastest for local dev on this machine):**

```bash
cd ~/Developer/Projects/give-to-get
ln -s "$(pwd)/skills" ~/.hermes/skills/givetoget
```

**Or add as a GitHub tap (works from anywhere, updates with `hermes skills update`):**

```bash
hermes skills tap add awykoff/give-to-get
```

## 3. Start a session in the repo

```bash
cd ~/Developer/Projects/give-to-get
hermes
```

Hermes auto-loads `AGENTS.md` as project context. Then, in the chat:

```
/givetoget-lead-developer
```

This loads the orchestration skill — it reads the phase sequence in
`AGENTS.md`, checks what's already built in the repo, and either does the
next piece of work directly or dispatches a subagent with a brief that
names the right specialist skill (`givetoget-architect`,
`givetoget-frontend`, `givetoget-database`, `givetoget-backend`,
`givetoget-auth`, `givetoget-tester`, `givetoget-docs`).

## 4. Delegating to subagents

When the Lead Developer decides a task is big enough to hand off, it'll
spawn a Hermes subagent with a brief. You can also do this yourself directly:

```
Delegate to a subagent: load the givetoget-database skill and apply
002_apollo_aligned_schema.sql, then generate lib/types/database.types.ts.
```

Subagents run as isolated Hermes sessions with their own context — the
brief is the only channel they get, so keep it concrete (what exists, what's
needed, what "done" looks like).
