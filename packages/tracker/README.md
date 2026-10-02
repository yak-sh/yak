# @yaks/tracker

Errors are occurrences, bugs are groups. Intake keeps a reporter's UUID so a
queue or spool resend is the same occurrence. Grouping runs downstream and
atomically links and counts it. All references may name entities in other
stores.

| Export      | Owns                                                        |
| ----------- | ----------------------------------------------------------- |
| `.`         | Fault keys, grouping patches, regression and retention      |
| `./vocab`   | Tracker words, RAM computations and SQL-derived expressions |
| `./report`  | `report`, `caught`, `capture`, `queue`, `spool`, `post`     |
| `./page`    | Classic browser capture script and twenty breadcrumbs       |
| `./effects` | `error_group`, `bug_notify`, `error_trim`                   |
| `./tools`   | `bug_list`, `bug_show`, `bug_resolve`, `bug_archive`        |
| `./service` | Spool record admission and acknowledgement                  |

```ts
import { normalize } from '@yaks/tracker'

normalize('T-42 failed at /srv/app.ts:10:3 after 300 tries')
// '# failed at # after # tries'
```

## Host interface

Load `trackerDoc` with @yaks/kernel, @yaks/tools, @yaks/api, @yaks/doc,
@yaks/mail and @yaks/wake. RAM takes `computed`; SQL storage takes `derived`.
`bug.status` comes from the resolved/archived marks. `bug.people` is distinct
actors among retained occurrences. `bug.hits` is historical and does not shrink
when occurrences are trimmed.

`report(error, context)` never throws. Context supplies `sink`, the failing
work's `actor`, commit/version, global `during` references, and optionally a
request bundle. `caught` excludes refusals. Request bodies, headers and query
strings and console argument arrays are not sent. A failed sink uses the
fallback, or console, without reporting itself recursively.

The queue sink takes a binding with `send`; the spool sink takes an append
function; the post sink takes a URL and an optional fetch implementation. The
box service takes a `source()` yielding `{rows, ack}` records. It calls `ack`
only after graph admission. File opening, checkpoints, units and worker bindings
are the host's, not this package's.

`effects({graph}, options)` accepts an `enrich` function for downstream frame
resolution, a space `notify` stream callback, or a platform/box mail `to`,
`from` and global tracker `store` eid. New bugs and regressions share a letter
per minute, scheduled by a graph wake; bugs become notified only after its
`delivered` mark. Space replies own their own notified mark. Archived bugs still
count but never notify. Retention keeps the newest hundred plus the first
occurrence of each commit (or version without a commit).

## Transition boundaries

The browser script has moved here; the existing platform asset is a symlink and
still speaks its existing intake payload. Switching that door onto the tracker
is later work. Production Sentry remains enabled.

Tools still declares legacy exception fields until T-59080 migrates them. Its
new `type` and `value` coexist with those fields; tracker extends only `frames`
and `mechanism` for now. No legacy exception rows are cleared.

Heal temporarily projects tracker-owned `bug` declarations and reexports fault
grouping until T-59079 turns it into a tracker subscriber. Do not load that
transitional heal vocabulary in a tracker store.
