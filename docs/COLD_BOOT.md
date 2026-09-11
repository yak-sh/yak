# Cold boot: keep the answer, stop fetching rows just to count them

T-37407 follows the measurement procedure in `CLIENT_MIGRATION.md`.
`COLD_BOOT_CDP.json` records the paired runs, including **every cold
subscription's query, bytes, frames, distinct/member/peer IDs and exclusive
IDs**. The shared `bin/cdp-wire.ts` collector is used by both
`bin/probe-client.ts` and `bin/archetype-probe.ts`. It counts
unaddressed/control bytes too, and never records row contents. Sub/group ID
counts overlap and must not be summed; their byte totals are additive.

## What were the extra IDs?

The historical numbers were 479,778 B / 297 IDs (T-37034) and 635,262 B / 572
IDs (`ARCHETYPE_BOOT_CDP.json`). They are not two runs against this snapshot,
and the older report did not retain a per-subscription ID inventory. We cannot
honestly name an exact historical set of 275 IDs from those totals alone.

A fresh same-snapshot before/after comparison **does** identify the excess:

| Cold subscription group                                           | Before bytes | Before distinct IDs | After bytes | After distinct IDs |
| ----------------------------------------------------------------- | -----------: | ------------------: | ----------: | -----------------: |
| Boot/unaddressed                                                  |      197,547 |                 133 |     197,547 |                133 |
| Broad reverse references (`.refs=<open card>`)                    |       55,591 |                 151 |           0 |                  0 |
| Inbox candidate rows for seven badges                             |      109,370 |                 146 |           0 |                  0 |
| Inbox count-only answers                                          |            0 |                   0 |       7,168 |                  0 |
| Authoritative actor project/email profiles                        |            0 |                   0 |       4,338 |                  7 |
| Standing watch/mute instructions                                  |        1,351 |                   0 |       1,351 |                  0 |
| Board pages and their edge peers                                  |       78,300 |                  81 |      78,300 |                 81 |
| Session tray                                                      |       68,610 |                  30 |      67,957 |                 30 |
| Wake indicators                                                   |       12,920 |                   0 |      12,920 |                  0 |
| Other visible reads, bodies, favorites, archetypes and aggregates |       97,538 |                  73 |      98,252 |                 73 |
| **Entire cold union**                                             |  **621,227** |             **559** | **467,833** |            **268** |

Of the 151 reverse references, **145 IDs disappear from the cold union**; the
other six are already needed elsewhere. All **146 inbox candidate IDs**
disappear. Those two non-overlapping sets explain the **291 net IDs saved**.
There is also a replaced ephemeral browser-client identity (one removed, one
new). The seven actor profile rows already belong to the working set; asking for
their policy fields adds coverage, not new IDs.

The earlier exploratory run of this snapshot was 625,328 B / 561 IDs; rolling
six-hour tray queries explain why the later paired baseline is slightly smaller.
Fresh identities and time-sensitive reads mean cold numbers are not constants.
The final result is **153,394 B (24.7%) smaller** than its paired before, and is
also below the historical 479,778 B / 297 ID baseline. It is about 5.9 KB above
the separate 461,948 B result the owner liked, while carrying fewer IDs. No
first-paint data was capped or discarded.

## Changes and correctness boundary

- **Runs:** replace “all reverse referrers, then discard all but session role
  and requested-task refs” with two server-owned typed membership queries. Union
  their IDs and the existing claim holder. A referrer outside browser RAM still
  arrives; unrelated comments, entries and other referrers do not.
- **Project Tasks:** ask the server for open/wip tasks filed in that project,
  rather than all reverse references followed by local component/status screens.
  Existing display ordering is unchanged.
- **Unread badges:** fetch counts, not candidate rows, **only after** a complete
  addressed `.subscription.actor=<actor>` answer says there are no standing
  instructions, and an explicit project/email profile read is ready. Five
  disjoint count queries preserve the shared `addressed()` policy's component
  precedence (comment, notice, knock, mail), inbound message-ID truthiness and
  target/address de-duplication. They use ordinary indexed `.count!` answers.
- **Any watch/mute instruction:** keep the existing authoritative candidate
  queries plus `inboxItem`/`isUnread` policy. A loading/refused profile,
  instruction read, count, or fallback candidate read is not a confident zero.
  Instruction edits switch modes reactively. No cache-membership fallback was
  introduced. Opening an Inbox still fetches its actual rows.
- **Lifetime:** count reads open in a layout effect, not during render. Matching
  badges share counted holds. Last unmount, actor changes and mode changes
  release their subscriptions. Retained payload is not authoritative readiness.

Tests cover real SQLite → subscription answers, both project and person readers,
component overlaps, outbound and empty-message-ID mail, opened/archive changes,
retargeting, absence of payload rows in count frames, and ordinary candidate
policy parity. Mounted hook tests exercise pending profile/instruction reads,
shared ownership, aggregate refusal/recovery, watch→mute transitions and reopen.
The Runs/Tasks mounted test asserts their narrow wire queries and cleanup.

## Reproduction and six-open check

Both scratch servers were freshly copied from snapshot SHA-256
`d332205a5a9305888ab10f93c6693022ac2e33da803d7323910fb0ea2c43647a`. Before is
detached `4effd96ab90d7b3ec1327ae6ca8fd3c7a9c07e22`; after is this task's
implementation (landed SHA in the task comment). Each server has its own
HOME/TASKS_HOME/HARNESS_HOME/PROCESS_DIR/TMPDIR and DB. `PROBE=1`,
`TASKS_EFFECTS=daemon`, `TASKS_SYNC=off`, `TASKS_EMBED=0`; only DENO_DIR is
shared. No production endpoint was probed or modified. Ports 35931/35932 are
loopback probe targets. Fresh Chrome profiles, 1440×1000; 15 seconds settling
plus wire quiet and browser-applied addressed readiness. The same six-target
JSON was used by both runs:

```sh
deno run -A bin/probe-client.ts http://127.0.0.1:35931 /scratch/targets.json
deno run -A bin/probe-client.ts http://127.0.0.1:35932 /scratch/targets.json
```

| Scenario             | Before bytes / IDs | After bytes / IDs | Before sub/unsub sends | After sub/unsub sends |
| -------------------- | -----------------: | ----------------: | ---------------------: | --------------------: |
| Cold, 11 cards       |      621,227 / 559 |     467,833 / 268 |               140 / 17 |              149 / 17 |
| Six opens and closes |      171,048 / 369 |       44,991 / 10 |                49 / 49 |               61 / 61 |
| Reopen first         |        22,598 / 56 |         3,873 / 1 |                  6 / 1 |                 8 / 1 |

All six body lengths and SHA-256s match. With incoming JS WebSocket delivery
paused, the first reopened card paints its retained content while all eight
after reads remain **loading**; after release all eight are **ready**. Closing
the six cards returns query/transport ownership to the cold baseline (after: 62
query sets / 132 transports), rather than leaving six sets behind. Both runs
report zero browser runtime exceptions. The smaller six-open traffic is also the
removal of broad reverse-reference reads, not body truncation.

Required repository gates: `deno task check` and
`DB_PATH=:memory: deno task test`; execution results and landed SHA are recorded
on T-37407.
