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
| Add, replace or remove prerequisites                        |         182 | `graph_apply.links[]` with `relation:"requires"`, `from`, `to`, optional `drop`; creation: `task_new.requires`.                                                                               |
| File a related task tree                                    |          80 | `task_new.tasks[]` with local `id`, `parent`, `requires`; top-level filing supplies shared defaults.                                                                                          |
| Replace an entire body through a bundle                     |          75 | `task_update.body`/`was`; `memory_save.id`/`said`/`was`; any document: `graph_apply.id`/`text`/`path`/`was`.                                                                                  |
| Change fields or lifecycle marks                            |          70 | `task_update` filing/status, `accept`, `blocked`, `reason`, nullable fields and atomic `updates[]`; other components: `graph_apply.edits[].set` with dotted fields or component objects/null. |
| Add/remove containment                                      |          49 | `topic_add.topic`/`ids`/`drop`; any containment: `graph_apply.links[]` with `relation:"contains"`, optional `drop`/`ord`.                                                                     |
| Other relations, including satisfies/cites/supersedes/reads |          52 | `graph_apply.links[]` with `relation`, `from`, `to`, optional `drop`, `ord`, `props`.                                                                                                         |
| File independent tasks together                             |          32 | `task_new.tasks[]`, inheriting top-level filing fields.                                                                                                                                       |
| File a single task or document through a bundle             |          17 | `task_new.title`/`body`, `design_new`, `comment_new`, `memory_save`, or `topic_new`; generic creation: `graph_apply.edits[]` with local `$id` and `set`.                                      |
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

`fallbacks.jsonl` records **34 explicit tool-to-CLI reports across 23 source
sessions**, including thinking and assistant prose. Repeated progress/final
reports and reports about another agent remain reports, not independent
incidents. Most describe the Oct 21–23 MCP connection remaining disconnected
after VACUUM/restart; others describe the Oct 12–13 `graph_apply` schema
mismatch. Reports establish what the agent said, not an independently proved
diagnosis.

The separate failed-call audit finds **8 task-domain failed-call cases followed
by 9 same-operation CLI attempts across 7 sessions**. These are two commit
attachments, a containment-edge deletion, a task read, two design reads, a task
range inspection and a memory read. Two cases also have explicit reports; six
have no explicit fallback prose. Do not add these counts to the report count.
`fallback-transitions.jsonl` records all 89 reviewed failure candidates, the
matched CLI call ids and reasons for exclusions. Of those candidates, 62 are
failed or declined outputs (one is a user rejection); 27 are successful results
or tool metadata quoting errors. Corrected MCP retries and later CLI operations
on different records are excluded from same-operation transitions.

`fallback-audit.py` discovers failures and subsequent CLI calls as well as
prose. Its complete replay read 974 files / 954,749 lines, decoded 540,282
candidate records, and deduplicated 147,093 tool calls. It found 666 direct
task-MCP calls, 23 wrapped-call candidates, and 1,067 distinct narrative
candidates. All were classified; 21 additional prior narrative candidates, all
negative, were also reviewed. `fallback-narrative-review.jsonl` keeps the
classification ledger. The automatic next-30-call window only proposes matches:
review checked retries and extended context, including a later admin fallback 64
calls away. The corpus grows during the audit; timestamps after the cutoff are
excluded. The discovery took 431.338 s reading roughly 3 GB under concurrent
gate/disk load.

The initially skipped malformed record was recovered after a native syntax pass
over 977 files (114.125 s). It is
`~/.claude/projects/-home-yaks-code-tasks/b4337949-3029-4f3f-9e32-21c2e328f4ad.jsonl:5347`,
at byte offset 11,244,980, length 3,308 bytes, SHA-256
`ef8c20025fd67f2919abb1fd9bc28a59a1438c3a2ddc80533d8a8841c9c1e623`. An intact
assistant message precedes corrupted `wireToolInputs` metadata and an
interleaved attachment. Call `toolu_01KPpR8zQmfzijN3DhRGLSHL` uses Python to
construct nine prerequisite edges joining two task trees, then applies them
through the CLI. It adds one prerequisite invocation and no fallback report or
MCP failure. The attachment timestamp, 2026-10-02 03:06:45.358 UTC, is an upper
bound for the recovered call; its preceding record is at 03:05:39.884 UTC.
`audit.py` verifies the raw hash before decoding the intact message value. The
source file is unchanged. Two other native-parser error segments were one valid
Unicode-containing number-format verification record split by Node's line
reader; targeted Python JSON parsing confirmed the original record valid.

The ledger separately retains 11 failed-call cases followed by 7 CLI attempts
outside task authoring: deployment/landing, hosted app administration and
tracker bugs. In particular, historically valid `admin_tool` calls for
`app_list`, `app_versions`, `store_inspect` and `bug_resolve` now report a
missing tool. This change does not claim to restore that administration
interface. It was removed by `7958c76326f6b2644209ad2c4673068e905c9964`, “Run
admin operations as the selected yaks.app connection (T-64688)”; the commit
describes replacing separate admin accounts/login/tool verbs with ordinary
connection commands. That is the recorded commit rationale, not a quoted owner
instruction.

Compatibility history distinguishes invalid inputs from removed contracts:
`graph_show` has required `ids: string[]` since its introduction in
`286eb40e62bd92d108d954e2699f0bdb05e24b7c`; none of its 45 historical vocabulary
revisions declares singular `id`. Those failures do not prove a compatibility
regression. `graph_apply.change` arrays were valid before the rename in
`fa990015c717e7190159136bb93ca6d8efb6ceb4`; the current translation retains that
alias. A JSON string in `bundles` was not the declared array contract.

The documentation also directed agents into these paths:

- `packages/task/tools.ts`'s opening comment and `packages/task/README.md`'s
  plan example prescribed raw task/edge bundles.
- `.claude/skills/design-docs/SKILL.md` prescribed Python JSON serialization for
  a design body edit and raw bundles for filing a task tree.

A few bulk operations mix task records with other entities, and their intent
comes from the surrounding transcript. The classification records attempted
work; it does not establish write success. The retained source references make
those judgments inspectable.

The final source replay verified all 651 then-retained invocation hashes and
counts, exit 0. It streamed 969 files / 945,543 lines, parsed 195,447 historical
records containing tool-call tags, and found 51,486 broad unique call
candidates. File/line totals include files growing during the audit; the
historical cutoff keeps their newer records out of the candidates. One
additional design-copy verification fixture was subsequently excluded: all 650
remaining hashes were verified by that replay. The recovered prerequisite
invocation was independently hash-verified through the replay parser, bringing
the retained total to 651. Verification took 77.238 s because it reads roughly 3
GB of transcript JSON. The preceding replay took 90.596 s and failed its final
count check because the fixture exclusions changed while it was running; its
individual source hashes had passed. The final replay skips records without
tool-call tags. Command timing details, including the 87.219 s
thinking-inclusive scan, are in `audit-counts.json`.

The current retained set was replayed with
`python3
artifacts/task-tools/audit.py --references`: all 651 command hashes
across 96 source files and the act/mechanism counts passed in 3.001 s. This mode
checks the retained evidence without repeating discovery across unrelated
transcripts. An independent targeted replay also verified 136 fallback
call/report source hashes across 59 files in 1.917 s; every retained report
excerpt occurs verbatim in its hashed source text.
