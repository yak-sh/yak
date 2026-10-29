# Task tool transcript audit

T-133046. Historical cutoff: 2026-10-29 13:48:00 UTC. Sources are every JSONL
transcript under `~/.claude/projects/-home-yaks-code-tasks/` (including
subagents) and `~/.codex/sessions/`. Tool calls copied into fork histories are
deduplicated by call id. Tool outputs, quoted instructions, source-code changes,
verification fixtures, unrelated graph domains and read-only formatting are
excluded.

The scan streams assistant tool invocations, looking for Python, jq, sed,
heredocs and `graph_apply`. Review separates task work from source edits and
read filters; adjacent preparation supplies the intent of an opaque `@file`
application. A second broad scan finds preparation split from a later write,
including Python `subprocess.run(['yak', ...])` calls. Each retained invocation
has its source path, line, tool call id, command hash, concise intent, operation
syntax and stage in `evidence.jsonl`. No transcript bodies or credentials are
copied. `audit.py` replays all source references and checks the counts.

Counts are **observed invocations by intended act**, not affected entities or
unique successful outcomes. Preparation, rehearsal, failed attempts, retries and
application remain separate entries. A call may have several acts, so columns
overlap. This makes the repeated serialization and retry cost visible.

| Intended act                                                | Invocations | Supported tool and fields                                                                                                                                                                     |
| ----------------------------------------------------------- | ----------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change part of a body, including append/prepend             |         239 | `task_update.edit` (`find`, `replace`, `append`, `prepend`, `all`, `was`); any document: `graph_apply.edits[].text` with `path`.                                                              |
| Add, replace or remove prerequisites                        |         181 | `graph_apply.links[]` with `relation:"requires"`, `from`, `to`, optional `drop`; creation: `task_new.requires`.                                                                               |
| File a related task tree                                    |          80 | `task_new.tasks[]` with local `id`, `parent`, `requires`; top-level filing supplies shared defaults.                                                                                          |
| Replace an entire body through a bundle                     |          75 | `task_update.body`/`was`; `memory_save.id`/`said`/`was`; any document: `graph_apply.id`/`text`/`path`/`was`.                                                                                  |
| Change fields or lifecycle marks                            |          70 | `task_update` filing/status, `accept`, `blocked`, `reason`, nullable fields and atomic `updates[]`; other components: `graph_apply.edits[].set` with dotted fields or component objects/null. |
| Add/remove containment                                      |          49 | `topic_add.topic`/`ids`/`drop`; any containment: `graph_apply.links[]` with `relation:"contains"`, optional `drop`/`ord`.                                                                     |
| Other relations, including satisfies/cites/supersedes/reads |          52 | `graph_apply.links[]` with `relation`, `from`, `to`, optional `drop`, `ord`, `props`.                                                                                                         |
| File independent tasks together                             |          32 | `task_new.tasks[]`, inheriting top-level filing fields.                                                                                                                                       |
| File a single task or document through a bundle             |          18 | `task_new.title`/`body`, `design_new`, `comment_new`, `memory_save`, or `topic_new`; generic creation: `graph_apply.edits[]` with local `$id` and `set`.                                      |
| Delete entities or edges                                    |          25 | `graph_apply.edits[].delete`; relation removal also accepts `graph_apply.links[].drop`.                                                                                                       |
| Attach a commit and its full message                        |          22 | `graph_apply.edits[]` with the commit SHA as `id` and `set` fields `commit.target`, `commit.message` (and `commit.repo` when supplied).                                                       |
| File or revise decisions                                    |          14 | `decision_new.question`/`choices`/`recommended`; revise through `graph_apply.edits[].set`; record explicit answers with `decision_answer.by` or `design_decide.by`.                           |

Coverage reuses existing tool names, extending inputs where needed. Their `yak`
spellings are `task new`, `task update`, `graph apply`, `topic add`, and the
corresponding noun/verb spelling of the other tools; the CLI uses the same
schemas and implementations. For a whole body held in a local file,
`yak graph apply --id
<ID> --text @path` supplies the file contents without JSON
serialization.

The in-process MCP proofs are [generic edits and links](proof.ts),
[task batches and updates](task-mcp.ts), and
[decision attribution](decision-mcp.ts). They call the tools through MCP and
exercise the mirrored CLI argument grammar. The schemas are declared in
[graph](../../packages/graph/vocab.json),
[task](../../packages/task/vocab.json), and
[design](../../packages/design/vocab.json); commit fields are declared in
[git](../../packages/git/vocab.json).

There are 651 retained invocations. Body-edit counts span tasks, memories,
designs, topics and comments. Secondary scope tags in individual evidence rows
are nonexhaustive descriptions and should not be compared as prevalence by
entity kind. Mechanisms overlap: 363 Python, 45 sed, 11 jq, 35 JSON heredocs,
and 563 bundle-construction or application invocations. No task file/URL
attachment was found; the observed attachments were commit records, or ordinary
comments containing an inventory.

`gap` distinguishes a missing ergonomic act from avoidable scripting where a
purpose-built tool already existed. The task tool already supported simultaneous
title/body/status/filing changes; memory_save already replaced a whole memory;
topic_add already managed topic containment. Those examples are evidence of
unnecessary serialization or discoverability costs, not absent functionality.
Partial text edits, trees/batches, generic relations, generic document edits,
mark removal, edge ordering and deletion expose broader interface needs.

`fallbacks.jsonl` records 20 explicit tool-to-CLI fallback reports across 16
source sessions. Several are later reports of the same outage, so this is not 20
independent failures. Most describe the Oct 21–23 MCP connection remaining
disconnected after VACUUM/restart. One Oct 12 report follows incompatible
`bundles`/`change` input attempts on graph_apply. Reports establish what the
agent said, not a diagnosis independently proved by this audit.

The documentation also directed agents into these paths:

- `packages/task/tools.ts`'s opening comment and `packages/task/README.md`'s
  plan example prescribed raw task/edge bundles.
- `.claude/skills/design-docs/SKILL.md` prescribed Python JSON serialization for
  a design body edit and raw bundles for filing a task tree.

A few bulk operations mix task records with other entities, and their intent
comes from the surrounding transcript. The classification records attempted
work; it does not establish write success. The retained source references make
those judgments inspectable.

The final source replay verified all 651 retained invocation hashes and counts,
exit 0. It streamed 969 files / 945,543 lines, parsed 195,447 historical records
containing tool-call tags, and found 51,486 broad unique call candidates.
File/line totals include files growing during the audit; the historical cutoff
keeps their newer records out of the candidates. Verification took 77.238 s
because it reads roughly 3 GB of transcript JSON. The preceding replay took
90.596 s and failed its final count check because the fixture exclusions changed
while it was running; its individual source hashes had passed. The final replay
skips records without tool-call tags. Command timing details, including the
87.219 s thinking-inclusive scan, are in `audit-counts.json`.
