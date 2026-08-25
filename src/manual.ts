// The shell manual is executable data: root usage, focused help and argument
// validation all read this table. The palette keeps its own command table;
// this module renders it directly, so neither vocabulary can drift.

import { commands } from './commands.ts'
import { providers } from './adapters.ts'
import {
  inflate,
  type Param,
  param,
  separated,
  type Stdin,
  stdin,
} from './client.ts'
import { FILTERS, GRAMMAR } from './grammar.ts'
import { comps, edges, kindOrder, plurals, statuses } from './types.ts'
import {
  type Arg,
  body as bodyKind,
  type Decl,
  enumOf,
  file,
  type Got,
  id,
  num,
  of,
  type Opt,
  path,
  slotsOf,
  text,
  usageOf,
  wordsOf,
} from './verb.ts'

export type Manual = Decl

let arg = (
  name: string,
  kind = text,
  rest = false,
  need = true,
): Arg => ({ name, kind, rest, need })

let flag = (name: string): Opt => ({ name })
let value = (name: string, kind = text, separate = false): Opt => ({
  name,
  kind,
  separate,
})

let json = flag('--json')
let verbose = flag('--verbose')
let quarantined = flag('--quarantined')
let kind = of('kind', () => [...new Set([...kindOrder, ...plurals])])
// `show` already renders comments; --comments affirms that default so the
// warm reach for it never errors (T-18416).
let comments = flag('--comments')
let body = value('--body', bodyKind)
let bodyFile = { ...value('-F', file, true), alias: '--body' }
let bodyText = { ...bodyKind, name: 'text' }
// Retired flags whose habit outlives them, said once each (Manual.retired).
let BRIEF_BODY = "takes no --body — did you mean 'task session brief --body=…'?"
let REMEMBER_TYPE =
  'takes no --type: the memory.type enum is retired (T-12585) — ' +
  '--scope=P-19 says project, --feedback=jeff says who gave it, and ' +
  'saying nothing IS a reference'
let count = value('-n', num, true)
let empty = { name: 'text', test: /.*/ }
let minutes = { name: 'minutes', test: /^\d+$/ }
let timestamp = { name: 'iso', test: /.+/ }
let verdict = enumOf(comps.review.verdict, 'verdict')
let provider = of('provider', () => providers().map((p) => p.name))
let model = of(
  'model',
  () => [...new Set(providers().flatMap((p) => p.models))],
)
let effort = of(
  'effort',
  () => [...new Set(providers().flatMap((p) => p.efforts))],
)

let declare = (
  all: Record<string, Omit<Manual, 'name' | 'door'>>,
): Record<string, Manual> =>
  Object.fromEntries(
    Object.entries(all).map(([name, verb]) => [
      name,
      { name, door: ['cli'], ...verb },
    ]),
  )

export let manuals = declare({
  tui: {
    about: 'open the terminal UI',
    root: true,
    args: [],
  },
  claude: {
    about:
      'interactive claude: graph participant; --operator adds project broadcasts',
    examples: ['task claude', 'task claude --operator --continue'],
    root: true,
    args: [arg('claude args', text, true, false)],
    opts: [flag('--operator')],
    passthrough: true,
  },
  codex: {
    about:
      'interactive codex: graph participant; --operator adds project broadcasts',
    examples: ['task codex', 'task codex --operator resume --last'],
    root: true,
    args: [arg('codex args', text, true, false)],
    opts: [flag('--operator')],
    passthrough: true,
  },
  list: {
    dots: 'filters',
    about: 'list tasks — or any kind (filter grammar)',
    examples: [
      'task list .status=open .priority<=1',
      'task list .project=harness .updated.at>="1 week ago"',
      'task projects',
      'task list boards .title~=fleet',
    ],
    detail: 'A leading KIND word says what to list — `projects`, ' +
      '`--kind=project` and `.kind=project` all name it, and the plural is a ' +
      'verb of its own (`task projects`). Tasks are the default. The second ' +
      "column is the handle you can type: a task's status, everything " +
      `else's alias. Quarantined rows require an explicit ` +
      `'.quarantined!' filter. Kinds: ${kindOrder.join(', ')}.`,
    root: true,
    args: [arg('kind', text, false, false), arg('filters', text, true, false)],
    opts: [value('--kind', kind), value('--limit', num, true), json],
  },
  query: {
    dots: 'filters',
    about: 'query the graph (filter grammar)',
    examples: [
      'task query .kind=persona',
      'task query .project=P-19 .status=open --json',
    ],
    detail: 'The CLI spelling of the same filtered graph read as ' +
      '`graph_query` and `/query`. It renders through `task list`; a ' +
      '`.kind=` filter selects any entity kind, and tasks are the default.',
    root: true,
    args: [arg('filters', text, true, false)],
    opts: [json],
  },
  decided: {
    dots: 'filters',
    about: 'what has been settled here, newest decision first',
    examples: [
      'task decided',
      'task decided .project=P-30',
      'task decided --all',
      'task decided .decided.at>="1 month ago"',
    ],
    detail: 'The `decided` stamp is a facet, not a kind — a task, a memory ' +
      'and a doc can all wear one — so this walks every kind at once. The ' +
      'date leads each line, and it is the DECISION date: record an old one ' +
      'with `task set <id> .decided.at="2026-06-01"`, which is not the same ' +
      'as when the entity was filed. The default scope is the project your ' +
      'cwd puts you in, plus the fleet-wide rulings that bind it — the same ' +
      "scope the digest's `## decided` block uses. `.project=P-30` asks " +
      'about another one; `--all` asks about every project at once.',
    root: true,
    args: [arg('filters', text, true, false)],
    opts: [flag('--all'), json],
  },
  docs: {
    dots: 'filters',
    about: 'the architecture docs — what the system IS, root-first',
    examples: [
      'task docs',
      'task docs .title~=mail',
      'task docs --json',
    ],
    detail: 'The architecture docs are `doc` entities wearing the ' +
      "`architecture` tag: the graph's self-description of what the system " +
      'IS (not what is PROPOSED — that is `task designs`). They are linked ' +
      'root->leaf by `contains` edges, so the root (start here) leads and the ' +
      'leaves follow. `task show <id>` reads one whole; the web canvas hangs ' +
      'the leaves under the root. Filters screen the list with the one ' +
      'grammar, exactly as `task list` takes them.',
    root: true,
    args: [arg('filters', text, true, false)],
    opts: [json],
  },
  stale: {
    dots: 'filters',
    about: 'anchored entities whose code has moved past their sha',
    examples: [
      'task stale',
      'task stale .kind=memory',
      'task stale --all',
      'task stale --json',
    ],
    detail: 'An `anchor {paths, sha}` (set with ' +
      '`task set <id> .anchor.paths=src/db.ts .anchor.sha=<commit>`) records ' +
      'that an entity was verified against a commit. This asks git — in the ' +
      'repo your cwd puts you in — whether anything newer than that sha ' +
      'touched those paths, and reports the anchors that MOVED (stale) or ' +
      "that git can't vouch for (unknown: a sha rebased away, no paths). " +
      'The default hides current anchors; `--all` lists them too. It is the ' +
      'freshness backbone for architecture docs, memories and personas — a ' +
      'stale line means the prose may no longer match the code.',
    root: true,
    args: [arg('filters', text, true, false)],
    opts: [flag('--all'), json],
  },
  new: {
    dots: 'params',
    about: 'create a task (bare words become the title)',
    body: 'body',
    examples: [
      'task new P1 .project=holdco Fix the flux capacitor',
      'task new .title="Write the digest" .body="Details..." .domain=Eng',
      'task new .title="Write the digest" .body=@- <<\'EOF\'',
    ],
    detail: 'Any dot-param value may be `@file` (read from that file) or ' +
      '`-`/`@-` (read from piped stdin) — the safe doors for a long body, ' +
      'since shell substitution fails silently and an empty value CLEARS ' +
      'the column. `@@` escapes a value that genuinely starts with an @. ' +
      'stdin is consumable once: a second `@-` in one command is refused.',
    root: true,
    args: [arg('title', text, true, false)],
    // create() owns the more useful --flag → .param correction.
    passthrough: true,
  },
  set: {
    dots: 'params',
    body: 'body',
    about: 'patch any entity; --comment says why, in the same batch',
    examples: [
      'task set T-3 .status=done --comment="verified end-to-end"',
      'task set T-3 .assignee=jeff .priority=1',
      'task set S-12 --body=@brief.md',
      'task set S-12 .body=@- < brief.md',
    ],
    detail:
      'A dot-param, --body or --comment that IS `@file` is read from that ' +
      'file, and `-`/`@-` from piped stdin. The patch and the reason for ' +
      'it ride one atomic batch, so neither can land without the other.',
    root: true,
    args: [arg('id', id)],
    opts: [body, value('--comment', bodyText)],
  },
  edit: {
    about: 'surgical body edit: replace old with new, refusing a stale write',
    examples: [
      'task edit T-3 "teh plan" "the plan"',
      'task edit D-9 "old paragraph" @new.md',
      'task edit P-19 "typo" "" --all',
    ],
    detail: "The graph's Edit primitive: a targeted old→new replacement on " +
      'a doc body, instead of a full `.body=` rewrite that clobbers a ' +
      'concurrent edit. old must match exactly once (add surrounding text, ' +
      'or --all for every occurrence); an omitted new deletes the match. ' +
      'old/new take @file or -/@- (a long block over the pipe). The write ' +
      'is guarded by the body read here, so a body that moved since is ' +
      'refused with its current text and a fresh token — re-run to pick it ' +
      'up. Works on any doc body: task, design, persona, memory, doc.',
    root: true,
    args: [arg('id', id), arg('old', text), arg('new', text, false, false)],
    opts: [flag('--all')],
  },
  redact: {
    about: 'forget a doc value from live state and journal history',
    examples: [
      'task redact T-3 .body',
      'task redact T-3 @- < secret.txt',
    ],
    detail: '`.title` or `.body` replaces the whole current column with ' +
      '`[redacted]`; a literal replaces that value in the one target doc ' +
      'column where it appears, including historical-only values. Use ' +
      '`@file` or `@-` for a literal so the value never enters shell history ' +
      'or process arguments. The live doc, prior journal payloads, FTS/gram ' +
      'indexes, and target embedding are scrubbed atomically, and a permanent ' +
      'hash-only audit entity records the act. Existing git backup commits ' +
      'are NOT rewritten: the result names the published range that retains ' +
      'the value and tells you when rotation is required. Frozen archives, ' +
      'blobs, session logs, browser caches, recipients, and forensic SQLite ' +
      'free-page/WAL erasure are outside this narrow operation.',
    root: true,
    args: [arg('id', id), arg('selector', bodyKind)],
  },
  show: {
    about: 'one entity as a document (comments render by default)',
    examples: [
      'task show T-3',
      'task show T-3 --comments',
      'task show T-3 --json',
      'task show T-3 --quarantined',
    ],
    root: true,
    args: [arg('id', id)],
    opts: [json, quarantined, comments],
  },
  history: {
    about: "the entity's write history (journal)",
    examples: ['task history T-3 -n 10'],
    detail: '`--verbose` prints the full change payloads as JSON.',
    root: true,
    args: [arg('id', id)],
    opts: [{ ...count, or: '50' }, json, verbose],
  },
  undo: {
    about: "reverse a journaled batch — the graph's guarded undo",
    examples: ['task undo T-5', 'task undo #1287'],
    detail:
      'Reverses a batch by applying its inverse, guarded by Change.was: a ' +
      'column that moved since, or a batch that deleted an entity (a tombstone ' +
      'is permanent), is refused loudly rather than clobbered. A #id (from ' +
      'task history) names a batch; an entity names its LATEST batch. The undo ' +
      'is itself journaled, so undoing it is a redo.',
    root: true,
    args: [arg('id', id)],
  },
  transcript: {
    about: "a session's whole log as a clean, ordered transcript",
    examples: [
      'task transcript S-16872',
      'task transcript S-16872 --prose',
      'task transcript S-16872 --seq 40..80',
      'task transcript S-16872 --after 60 --limit 40',
    ],
    detail:
      'session_peek is a tail; this is the dump. It renders the authoritative ' +
      "entry partition with no raw-JSON noise, sharing session_peek's line " +
      'renderer. --prose keeps only what was said and thought; --seq A..B a ' +
      'seq range; --since/--until an ISO created-at window; --after/--limit ' +
      'page.',
    root: true,
    args: [arg('id', id)],
    opts: [
      flag('--prose'),
      value('--seq', { name: 'range', test: /^\d*\.\.\d*$/ }, true),
      value('--after', num, true),
      value('--limit', num, true),
      value('--since', timestamp, true),
      value('--until', timestamp, true),
      json,
    ],
  },
  search: {
    dots: 'filters',
    about: 'full-text search (trailing * = prefix)',
    examples: [
      'task search flux capac*',
      'task search .project=holdco deploy',
    ],
    root: true,
    // Filters ride words but not positional slots; seek rejects a query with
    // neither, after both forms have reached it.
    args: [arg('words', text, true, false)],
    opts: [json],
  },
  doctor: {
    about: 'run every health check over the live graph; exit 1 on a failure',
    detail:
      'A registry of checks (src/doctor.ts `checks`) that read the live ' +
      'graph and make the impossible states we can already see LOUD — a ' +
      'claim held by a session that ended, a board whose query no longer ' +
      'parses, an arrived letter with no sender, a session stuck starting. ' +
      'One line per finding (✗ hard, ⚠ soft), a ✓ for a clean check, then a ' +
      'tally; exit 1 on any hard finding. `task mail doctor` is the mail ' +
      'check on its own. A new check is one row in the registry.',
    examples: ['task doctor', 'task mail doctor'],
    root: true,
    args: [],
  },
  mail: {
    dots: 'filters',
    about: 'the mail-only slice of your items',
    deprecated: 'superseded by task inbox, where mail is one kind of item',
    examples: [
      'task inbox',
      'task mail send jeff Subject words --body=@draft.md',
    ],
    detail:
      '<to> is an address or graph reference (alias, P-9, eid); the address ' +
      'book resolves it at delivery. Filters speak `task help grammar`.',
    args: [arg('filters', text, true, false)],
    opts: [json, flag('--all'), flag('--sent')],
  },
  'mail show': {
    about: 'show the mail and thread; mark it opened',
    args: [arg('id', id)],
    opts: [json],
  },
  'mail send': {
    // Root because `mail` itself is deprecated: sending a letter is not
    // superseded by the inbox, so it keeps its own door in the usage.
    dots: ['body'],
    body: 'body',
    about: 'send a letter; - and @- read the body from stdin',
    root: true,
    // No --from: a letter is signed by whoever wrote it, derived from the
    // session's actor server-side (T-9511). Naming one is now an error,
    // which is the point — it used to be honoured.
    args: [arg('to', id), arg('subject', text, true)],
    opts: [body],
    some: ['--body'],
  },
  'mail reply': {
    // A lone trailing @file reads the file, exactly as --body=@file does —
    // one @ convention per door, named here so the two spellings can't be
    // read as equal when only one works (T-10461).
    dots: ['body'],
    body: 'text',
    about: 'reply in the existing mail thread; a lone @file is read',
    args: [arg('id', id), arg('text', text, true, false)],
    opts: [body],
    some: ['text', '--body'],
  },
  'mail search': {
    about: 'full-text search, limited to mail',
    args: [arg('words', text, true)],
  },
  'mail files': {
    about: 'download attachments',
    args: [arg('id', id)],
    opts: [value('--out', path, true)],
  },
  'mail doctor': {
    about: 'compare every book address with the Cloudflare routing rules',
    args: [],
  },
  backfill: {
    root: true,
    about: 'run an explicit historical materialization',
    args: [],
  },
  'backfill worked': {
    about: 'materialize historical session work as graph edges',
    detail:
      'Explicit and idempotent. Scans historical claims once on request; ' +
      'normal server boot and Session Tiles never read that history.',
    args: [],
  },
  'backfill referenced': {
    about: 'mint referenced edges for the citations in stored entries',
    detail:
      'Explicit and idempotent. Parses every stored entry once on request, ' +
      'the same way the post-commit effect parses each new one; a rerun ' +
      'lands only what the last run missed.',
    args: [],
  },
  watch: {
    about: 'put an entity in your inbox even when nothing is aimed at you',
    examples: ['task watch T-3', 'task watch T-3 --gone'],
    detail:
      'A standing instruction about ONE entity: its comments, letters and ' +
      'knocks reach your inbox whether or not they were addressed to you. ' +
      '--gone clears it. Per-actor, resolved from your cwd like `task inbox`.',
    root: true,
    args: [arg('id', id)],
    opts: [flag('--gone')],
  },
  mute: {
    about: 'stop an entity reaching your inbox, even direct address',
    examples: ['task mute T-3', 'task mute T-3 --gone'],
    detail:
      'The opposite standing instruction, and it wins over direct address: ' +
      'a thread you have declared finished stays out. Nothing is deleted — ' +
      '`task inbox --all` still shows it. --gone clears it.',
    root: true,
    args: [arg('id', id)],
    opts: [flag('--gone')],
  },
  inbox: {
    dots: 'filters',
    about: 'everything addressed to you, unread first',
    examples: [
      'task inbox',
      'task inbox --all',
      'task inbox .from=jeff@yak.sh',
      'task inbox show E-9',
      'task inbox archive E-9',
    ],
    detail:
      'Archived items are hidden; --all shows them too, marked `\u00d7`, ' +
      'and ignores `task mute`. Closing a task archives the correspondence ' +
      'about it, so --all is where that correspondence went. --sent is the ' +
      'letters you sent. Filters speak `task help grammar` \u2014 the same one ' +
      'parser every list door uses.',
    root: true,
    args: [arg('filters', text, true, false)],
    opts: [json, flag('--all'), flag('--sent')],
  },
  'inbox show': {
    about: 'show the item and mark it opened',
    args: [arg('id', id)],
    opts: [json],
  },
  'inbox archive': {
    about: 'hide the item from your inbox',
    args: [arg('id', id)],
  },
  // Keep the warm root spelling on the same operation as inbox archive. An
  // alias makes it a verb before subject-first can read `archive` as an id.
  archive: {
    about: 'hide an item from your inbox',
    examples: ['task archive K-20995'],
    alias: true,
    args: [arg('id', id)],
  },
  claim: {
    about: 'lease a task (default: your own session id)',
    examples: ['task claim T-3 my-session-id'],
    root: true,
    // An empty shell expansion means "use the ambient session", exactly like
    // omitting this optional slot. Agent briefs commonly carry a session
    // placeholder before the child has a provider id (T-19193).
    args: [arg('id', id), arg('session', empty, false, false)],
  },
  release: {
    about: 'drop the lease',
    examples: ['task release T-3'],
    root: true,
    args: [arg('id', id)],
  },
  block: {
    about: 'mark a task stuck on an EXTERNAL reason (not a task→task dep)',
    detail: 'The reason is free text — the outside thing being waited on ' +
      "(a vendor, an owner decision, a registration). It stamps the task's " +
      '`blocked` facet, which is what reddens the Dot; open `requires` edges ' +
      'stay a calm affordance. Orthogonal to status: a blocked task is still ' +
      'open/wip. `task list .blocked` lists everything externally stuck.',
    examples: ['task block T-3 "Jeff\'s Stripe decision"'],
    root: true,
    args: [arg('id', id), arg('reason', text, true, false)],
  },
  unblock: {
    about: 'clear the block facet (the external reason is resolved)',
    examples: ['task unblock T-3'],
    root: true,
    args: [arg('id', id)],
  },
  delete: {
    about: 'tombstone an entity — the one warm path that REMOVES',
    detail: 'Reuses the entity tombstone every death rides: apply() cascades ' +
      'to the entities that exist ABOUT the target — comments aimed at it, ' +
      'cards and knocks/wakes viewing it — and tombstones them too (a ' +
      'tombstone is permanent; nothing resurrects an eid). A leaf deletes ' +
      'quietly; a target with dependents REFUSES and NAMES them, so the blast ' +
      'radius is never a surprise — pass --cascade to take them too. Human ' +
      'ids resolve (task delete C-17310), never a uuid.',
    examples: ['task delete C-17310', 'task delete T-42 --cascade'],
    root: true,
    args: [arg('id', id)],
    opts: [flag('--cascade'), flag('--force')],
  },
  forget: {
    about:
      'tombstone a memory (delete, said the way a memory wants to hear it)',
    examples: ['task forget M-7'],
    root: true,
    args: [arg('id', id)],
    opts: [flag('--cascade'), flag('--force')],
  },
  subject: {
    syntax: '<id> [show|is|as|edge] …',
    about: 'show or act on a subject',
    examples: [
      'task T-3',
      'task T-3 requires T-9',
      'task T-3 is done',
      'task T-3 as json',
    ],
    root: true,
    args: [arg('words', text, true, false)],
  },
  spawn: {
    dots: ['provider', 'model', 'effort', 'persona'],
    about: 'dispatch a managed agent — the model routes to its provider ' +
      "automatically (defaults to your session's model; --effort defaults " +
      'to high; no --persona wears the project common persona)',
    examples: [
      'task spawn T-3',
      'task spawn T-3 --model=sonnet',
    ],
    root: true,
    args: [arg('id', id)],
    opts: [
      value('--provider', provider),
      value('--model', model),
      { ...value('--effort', effort), or: 'high' },
      value('--persona', id),
    ],
  },
  land: {
    about: 'fast-forward the worktree you stand in into its base branch',
    examples: ['task land'],
    detail: 'A pure git primitive — reads NOTHING from the graph and runs NO ' +
      'gate. The worktree you run it in names what to land; `git worktree ' +
      'list` names the shared checkout and the base branch it holds. It does ' +
      'at most ONE thing: fast-forward the branch into the base (landed — ' +
      'then a best-effort push if the base has a git upstream); or, if the ' +
      'base MOVED, rebase the branch onto it and RETURN WITHOUT MERGING, ' +
      'printing what happened, a `git diff --stat` of what the base pulled ' +
      'in, and any rebase conflict verbatim. Run your gate (deno task check ' +
      '&& deno task test) BEFORE landing, and again after a rebase if the ' +
      'incoming diff could affect you, then `task land` again — it now ' +
      "fast-forwards cleanly. Output is git's own so you can always tell " +
      'what happened. Landing does NOT close the task or release claims — ' +
      'that is your next step (task done <id>; task release <id>). The ' +
      'worktree is unlocked but kept — a later landing (or `task probes ' +
      '--reap`) removes it once nobody is inside.',
    root: true,
    args: [],
    opts: [],
  },
  comment: {
    about: 'comment on any entity; a verdict makes it a review',
    dots: ['body'],
    body: 'text',
    examples: [
      'task comment T-3 "blocked on the schema call"',
      'task comment T-3 .body=@notes.md',
      'task comment T-3 -F notes.md',
      'task comment T-3 "please include the migration"',
      'task comment T-3 --verdict=approved',
      'task set C-13 .body="what it should have said"',
    ],
    detail: 'The body is a DOCUMENT like a task body — `.body=@-` reads a ' +
      'heredoc, `.body=@file` or `-F file` reads a file, and a lone trailing ' +
      '@token does ' +
      'the same (`@@` escapes a comment that genuinely starts with an @). ' +
      'Comments render markdown exactly as bodies do, so author a rich one ' +
      'through the body door rather than as a flat inline string. A comment ' +
      'is something you WROTE, and it reaches whoever the entity concerns. ' +
      'Steering belongs on the task, where the current or next run reads it; ' +
      'commenting on an S-* run is deprecated compatibility.\n\n' +
      "Prints the comment's own id. A comment is an ordinary entity, so " +
      'REVISE a wrong one in place — `task set C-13 .body="…"` — rather ' +
      'than posting a correction beneath it. `task history C-13` keeps every ' +
      'earlier version, so nothing is lost by fixing it; a correction ' +
      'comment only leaves the wrong text as the one read first.',
    root: true,
    args: [arg('id', id), arg('text', text, true, false)],
    opts: [
      body,
      bodyFile,
      value('--verdict', verdict),
    ],
    some: ['text', '--body', '--verdict'],
  },
  meta: {
    about:
      'leave a quiet meta memo in the transcript for the dream (not delivered live)',
    dots: ['body'],
    body: 'text',
    examples: [
      'task meta "the retry path here is a tooling gap"',
      'task meta .body=@note.md',
      'task meta - < observation.txt',
    ],
    detail: 'A meta memo is a comment TAGGED `meta`, anchored at your ' +
      "session's newest message entry, for the dream (T-12800) to harvest " +
      'at consolidation — it is NEVER delivered to the live session, so it ' +
      'never knocks the doer. Use it to leave an observation for later ' +
      '(a tooling gap, a note that belongs in dreams) instead of interrupting ' +
      'the work in progress. The body is a DOCUMENT like a comment: `@file`, ' +
      '`--body=@-`, and a lone trailing @token read a file or piped stdin.',
    root: true,
    args: [arg('text', text, true, false)],
    opts: [body],
    some: ['text', '--body'],
  },
  dep: {
    about: 'link or unlink an edge',
    deprecated: 'superseded by task <id> <type> <child> [--gone]',
    examples: ['task T-3 requires T-9', 'task T-3 requires T-9 --gone'],
    root: true,
    args: [arg('id', id), arg('type'), arg('child', id)],
    opts: [flag('--gone')],
  },
  backup: {
    about: 'snapshot the db + commit/push the data dir',
    root: true,
    args: [],
  },
  sync: {
    about: "materialize personas into each project repo's .tasks/",
    examples: ['task sync', 'task sync --no-commit', 'task sync --check'],
    detail: 'Commits what it wrote in the repos that track it, and pushes ' +
      'in the ventures that permit it — `task set P-34 .push=1` grants it, ' +
      'and absent is no, so a venture whose main branch deploys simply ' +
      'never gets one. Unpushed, every projection commit is one more the ' +
      'next operator has to rebase past. --check writes nothing: it reports ' +
      'any projection that drifts from its render and exits non-zero, the ' +
      "gate's guard against a hand-edit to a generated file.",
    root: true,
    args: [],
    opts: [flag('--no-commit'), flag('--check')],
  },
  design: {
    dots: 'params',
    body: 'body',
    about: 'record a design: the thinking that precedes a build, proposed',
    examples: [
      'task design "Mail is local-first for fleet recipients" .body=@plan.md',
      'task design "One graph, many doors" --body=@plan.md',
      'task design "Local-first mail" .project=P-19 .priority=2',
      'task designs',
      'task designs .decided=',
    ],
    detail: 'A design is a doc wearing the `design` tag and the `proposed` ' +
      'mark — written awaiting acceptance. Accepting one is `task set D-9 ' +
      '.decided.at=now .decided.by=jeff`, the same stamp a task or a memory ' +
      'takes; both marks then stand, proposed on that day and decided on ' +
      'this one. `task designs` lists them, `.decided=` screens the ones ' +
      'still waiting.\n\nThe words are the TITLE; the standard property ' +
      'grammar rides alongside, exactly as `task new` takes it — ' +
      '`.project=P-19 .priority=2` set those props on the design, and it ' +
      'stays a design (never a task) until decided. The writing rides its ' +
      'own door: `.body=@plan.md` or `--body=@plan.md` reads that file, ' +
      '`-`/`@-` reads piped stdin. A dot-param that names no prop is refused ' +
      'rather than joined to the title.',
    root: true,
    args: [arg('title', text, true)],
    opts: [body],
  },
  dream: {
    about: 'start a venture dreaming: the graph-native consolidation cycle',
    examples: [
      'task dream P-19',
    ],
    detail: 'A dream is a per-venture consolidation cursor (T-12800). It ' +
      'mints one `dream` entity scoped to the project and arms a cadence ' +
      'wake; each run combs the sessions the venture finished since a sliding ' +
      'floor, asks a cheap model what META the doer missed — a warm path ' +
      'gone missing, duplicate tickets, a reflex recurring across sessions, ' +
      'complexity outgrowing size, an owner decision taken — and FLAGS it as ' +
      "a 'consider' task or a memory. It also derives duplicate, cold, and " +
      'overlong-memory candidates, persona bloat, and recurring tool-error ' +
      'cohorts; those land as bounded proposed review tasks, never source ' +
      'edits. A sweep notice records each verified pass. Flag, never fix. ' +
      'The dream re-arms itself, so this is a one-time opt-in; a second dream ' +
      'on the same venture is refused.',
    root: true,
    args: [arg('project', text)],
    opts: [],
  },
  remember: {
    dots: ['body', 'scope', 'feedback'],
    body: 'body',
    about: 'save a memory: the title is the index line, the body the lesson',
    examples: [
      'task remember "pipe a gate, lose its exit code" .feedback=jeff',
      'task remember "the sweep runs hourly" .scope=P-19 .body=@lesson.md',
    ],
    detail: 'Every value is said at either spelling — `.scope=P-19` and ' +
      '`--scope=P-19` alike — and the words are the TITLE, so anything ' +
      'else is refused rather than joined to it. `.body=@lesson.md` reads ' +
      'that file, `-`/`@-` piped stdin.\n\nscope names the project it ' +
      'belongs to; omit it for a principle every operator carries. ' +
      'feedback names WHO gave it (an empty value tags it with no ' +
      'source). There is no --type: the enum is retired, and saying ' +
      'nothing IS a reference.',
    root: true,
    args: [arg('title', text, true)],
    opts: [
      body,
      value('--feedback', empty),
      value('--scope', id),
    ],
    retired: { '--type': REMEMBER_TYPE },
  },
  session: {
    about: 'the session lifecycle: boot digest, wrap, self-authored brief',
    examples: [
      'task session context',
      'task session context my-session-id',
      'task session brief --body=@-',
      'task session turn idle',
      'task session wrap',
    ],
    root: true,
    args: [arg('command', text, true, false)],
  },
  'session context': {
    about: 'reify and print the session digest',
    args: [arg('sid', text, false, false)],
    opts: [flag('--hook'), flag('--subagent')],
  },
  'session wrap': {
    about: 'release claims and preserve the session brief',
    args: [arg('sid', text, false, false)],
    opts: [flag('--hook')],
    retired: { '--body': BRIEF_BODY },
  },
  'session brief': {
    dots: ['body'],
    body: 'text',
    about: 'write your own session brief; a lone @file is read',
    args: [arg('text', text, true, false)],
    opts: [body],
    some: ['text', '--body'],
  },
  'session peek': {
    about: "tail a session's rendered entry log",
    args: [arg('id', id)],
    opts: [value('--lines', num, true)],
  },
  'session turn': {
    about: 'announce a native provider turn boundary',
    args: [
      arg('idle|busy', of('state', () => ['idle', 'busy']), false, false),
      arg('sid', text, false, false),
    ],
    opts: [flag('--hook')],
  },
  role: {
    about: 'persistent roles: what should be running, and the off switch',
    examples: [
      'task role',
      'task role stop R-12',
      'task role stop --all',
      'task role start R-12',
      'task role cycle R-12',
      'task role pause R-12',
      'task role resume R-12',
    ],
    detail:
      'A role is DESIRED capacity — the reconciler drives real processes ' +
      'toward it every couple of seconds. Killing a pane or tmux session is ' +
      'therefore not a stop; the next sweep relaunches it. `role stop` patches ' +
      'the desire itself, so it holds across daemon and machine restarts. ' +
      '`role stop --all` is the fleet-wide off switch.',
    root: true,
    args: [arg('command', text, true, false)],
    opts: [json],
  },
  'role stop': {
    about: 'set roles to stopped — the durable off switch',
    examples: ['task role stop R-12', 'task role stop --all'],
    args: [arg('ids', id, true, false)],
    opts: [flag('--all')],
    some: ['ids', '--all'],
  },
  'role start': {
    about: 'set roles to running — the reconciler launches them',
    examples: ['task role start R-12', 'task role start --all'],
    args: [arg('ids', id, true, false)],
    opts: [flag('--all')],
    some: ['ids', '--all'],
  },
  'role cycle': {
    about: 'deliberate clean handoff: stop the live session, then spawn fresh',
    detail:
      'The reconciler ADOPTS any live session for a role, so it refuses to ' +
      'spawn a fresh one while the old lives — a manual `role start` cannot ' +
      'hand off. `role cycle` stops the current session (its brief and ' +
      'final_text are preserved for the successor), waits for it to leave, ' +
      'and starts a fresh one that inherits the handoff.',
    examples: ['task role cycle R-12', 'task role cycle P-19'],
    args: [arg('ids', id, true, false)],
    opts: [flag('--all')],
    some: ['ids', '--all'],
  },
  'role pause': {
    about: 'pause roles until an operator resumes them',
    args: [arg('ids', id, true, false)],
    opts: [flag('--all')],
    some: ['ids', '--all'],
  },
  'role resume': {
    about: 'resume paused roles',
    args: [arg('ids', id, true, false)],
    opts: [flag('--all')],
    some: ['ids', '--all'],
  },
  'role disable': {
    about: 'disable roles until explicitly started',
    args: [arg('ids', id, true, false)],
    opts: [flag('--all')],
    some: ['ids', '--all'],
  },
  'role retire': {
    about: 'retire roles while preserving their history',
    args: [arg('ids', id, true, false)],
    opts: [flag('--all')],
    some: ['ids', '--all'],
  },
  probes: {
    about: 'what dead sessions left running — browsers, servers, worktrees',
    detail:
      'Lists by default; --reap kills the orphans and removes the worktrees.\n' +
      'A process is an orphan only on ephemeral ground (a worktree or a\n' +
      'scratchpad) or as a headless browser holding a debugging port, and\n' +
      'only when no live session owns it. --all shows what was spared and\n' +
      'why. --grace=0 drops the 30-minute head start a young probe gets.\n' +
      'The server sweeps on its own only under TASKS_SWEEP=1; unset, this\n' +
      'verb is the one door and nothing is killed unless you say so.',
    examples: ['task probes', 'task probes --all', 'task probes --reap'],
    root: true,
    args: [],
    opts: [
      flag('--all'),
      flag('--reap'),
      { ...value('--grace', minutes), or: '30' },
    ],
  },
  telemetry: {
    about: 'tool calls + crashes; --stats for latency percentiles',
    examples: ['task telemetry --errors -n 20', 'task telemetry --stats'],
    detail: '--stats reports the latency distribution instead of raw rows: ' +
      'per door and tool, the count of timed calls and the p50/p95/p99 of ' +
      'their duration, computed in SQL. --errors and --since screen it too.',
    root: true,
    args: [],
    opts: [
      flag('--errors'),
      flag('--stats'),
      value('--since', timestamp),
      count,
    ],
  },
  usage: {
    dots: 'filters',
    about: 'what agent work cost and how fast it ran (filter grammar)',
    examples: [
      'task usage',
      'task usage --by=project',
      'task usage .provider=claude .finished_at>="1 week ago"',
    ],
    detail: 'A READ over the token counts already stamped on settled ' +
      'sessions — no new capture. Filters screen the sessions first (the one ' +
      'grammar: .provider=claude, .finished_at>=today). --by picks the ' +
      'breakdown dimension (model, project, persona, task, provider); a TOTAL ' +
      'always leads. Absent beats zero: an unreported facet reads —, never 0, ' +
      'and a model with no list price contributes no cost (the cost line says ' +
      'how many sessions it covered). --json dumps the full rolls with ' +
      'per-facet n.',
    root: true,
    args: [arg('filters', text, true, false)],
    opts: [
      value(
        '--by',
        of('dim', () => ['model', 'project', 'persona', 'task', 'provider']),
      ),
      json,
    ],
  },
  wake: {
    about: 'a knock on a timer',
    examples: [
      'task wake S-31 in 60m',
      'task wake homelab "9am tomorrow" T-42',
      'task wake home "in 900s" --body="mid mail-loop port, T-7018 next"',
      'task wake home --gone',
      'task wake homelab --gone T-42',
    ],
    detail: 'The optional --body (or .body=@-, @file) is a NOTE — what you ' +
      'were mid-doing, why you will return. It rides through to the knock the ' +
      'wake mints, so a resumed session reconstitutes instead of guessing. A ' +
      'cadence return (a wake at your own home board) reads "your pass ' +
      'resumes"; any other target reads "look at <id>".\n' +
      '--gone clears a pending wake, deleting the row so the timer skips it — ' +
      'there is no status to flip, and a `set .status=` would report success ' +
      'while the wake fired anyway. Bare, it clears the untargeted cadence ' +
      'wake (the YELLOW park case); with a target, that one reminder.',
    root: true,
    dots: ['body'],
    body: 'text',
    args: [
      arg('who', id),
      arg('when', text, true, false),
      arg('target', id, false, false),
    ],
    opts: [body, flag('--gone')],
  },
  ':': {
    syntax: ':<command> … | <id> :<command> …',
    about: "the web bar's `:` vocabulary (task help : lists every command)",
    examples: [
      'task :fix T-42',
      'task :new P1 ship the fix',
      'task T-42 :done',
    ],
    root: true,
    args: [arg('words', text, true, false)],
  },
  help: {
    about: 'this manual; grammar = filters + dot-params',
    examples: [
      'task help list',
      'task help mail send',
      'task help grammar',
      'task help :fix',
    ],
    root: true,
    args: [
      arg('verb|grammar|:', text, false, false),
      arg('nested verb', text, false, false),
    ],
  },
  complete: {
    about: 'shell completion candidates for a partial line (used by the ' +
      'bash/zsh scripts, not typed by hand)',
    detail: 'The wrapper passes the words after `task` past a `--` sentinel, ' +
      'the last being the word under the cursor; this prints one candidate ' +
      'per line. Reads the same declaration table as help and validation, so ' +
      'what completes is what runs.',
    // A machine verb: alias keeps it out of root help while marking it a real
    // top-level verb, so subject-first parsing doesn't read it as an entity id.
    alias: true,
    passthrough: true,
    args: [arg('words', text, true, false)],
  },
  ls: {
    dots: 'filters',
    about: 'list tasks (filter grammar)',
    deprecated: 'superseded by task list',
    examples: ['task list .status=open'],
    alias: true,
    args: [arg('filters', text, true, false)],
    opts: [json],
  },
  // context/wrap stay as supported top-level aliases of `session context`/
  // `session wrap` — the ergonomic warm path the persona teaches for
  // reconstitution, and the hook form other repos already carry. They are
  // NOT deprecated: T-16375 made every deprecated verb hard-error, which
  // caught these two as collateral and broke every post-clear operator
  // (T-16484). `alias: true` keeps them out of root help; the canonical
  // spelling lives under `session`.
  context: {
    about: 'reify and print the session digest',
    examples: ['task session context'],
    alias: true,
    args: [arg('sid', text, false, false)],
    opts: [flag('--hook'), flag('--subagent')],
  },
  wrap: {
    about: 'release claims and preserve the session brief',
    examples: ['task session wrap'],
    alias: true,
    args: [arg('sid', text, false, false)],
    opts: [flag('--hook')],
    retired: { '--body': BRIEF_BODY },
  },
  // `create` stays a supported top-level alias of `new` — the CRUD verb a
  // caller reaches for on first guess before learning this vocabulary
  // (T-18334). `alias: true` keeps it out of root help; the canonical
  // spelling is `new`.
  create: {
    dots: 'params',
    about: 'create a task (bare words become the title)',
    body: 'body',
    examples: ['task create P1 .project=holdco Fix the flux capacitor'],
    alias: true,
    args: [arg('title', text, true, false)],
    passthrough: true,
  },
  // `assign` is the plain-language warm path to task.assignee. Keep the
  // general graph patch under `set`; this alias makes the common act
  // discoverable without creating a second assignment model (T-19540).
  assign: {
    about: 'assign a task; shorthand for task set <id> .assignee=<who>',
    examples: ['task assign T-3 jeff'],
    alias: true,
    args: [arg('id', id), arg('who', text)],
  },
  // `rm` stays a supported top-level alias of `delete` — the shell verb a
  // caller reaches for on first guess (T-18345). Without this entry `rm`
  // isn't a cliVerb, so `task rm T-18345` fell through to subject-first
  // parsing (`rm` read as the id) and failed on the second word instead of
  // naming the actual mistake. `alias: true` keeps it out of root help;
  // the canonical spelling is `delete`.
  rm: {
    about: 'tombstone an entity — the one warm path that REMOVES',
    examples: ['task rm C-17310', 'task rm T-42 --cascade'],
    alias: true,
    args: [arg('id', id)],
    opts: [flag('--cascade'), flag('--force')],
  },
  // `require` is the imperative edge verb callers reach for before learning
  // the subject-first sentence. Keep that warm path working, while the
  // canonical `task <parent> requires <child>` stays in root help.
  require: {
    about: 'make one entity require another',
    examples: ['task require T-3 T-9', 'task require T-3 T-9 --gone'],
    alias: true,
    args: [arg('parent', id), arg('child', id)],
    opts: [flag('--gone')],
  },
})

export let cliVerbs = new Set(
  Object.entries(manuals)
    .filter(([name, m]) =>
      !['subject', ':'].includes(name) &&
      !name.includes(' ') && (m.root || m.alias)
    )
    .map(([name]) => name),
)

export let subjectUsage = (id = '<id>') =>
  `task ${id} — subject-first verbs

  task ${id} [show] [--json]        show the entity
  task ${id} as markdown|json       choose the show format
  task ${id} is ${statuses.join('|')}  set task status
  task ${id} ${edges.join('|')} <id> [--gone]
                                      link or unlink an edge
  task ${id} knock [to] [words…]      knock about this entity
  task ${id} :<command> …            run a focused ':' command`

let linkHelp = () =>
  `task <parent> ${edges.join('|')} <child> [--gone]
  link or unlink an edge

  task T-3 requires T-9
  task T-3 requires T-9 --gone`

let roots = () => Object.values(manuals).filter((m) => m.root && !m.deprecated)

export let usage = () =>
  `task — the entity graph, from a shell

${
    roots().map((m) =>
      usageOf(m).length > 29
        ? `  task ${usageOf(m)}\n${' '.repeat(38)}${m.about}`
        : `  task ${usageOf(m).padEnd(29)}  ${m.about}`
    ).join('\n')
  }

dot-params route by prop (.title= → doc.title); collisions use the
explicit .comp.prop spelling. 'task help grammar' spells the whole
filter grammar; 'task help <verb>' shows examples.`

let children = (name: string) =>
  Object.entries(manuals)
    .filter(([key, manual]) =>
      !manual.deprecated &&
      key.startsWith(`${name} `) && !key.slice(name.length + 1)
        .includes(' ')
    )
    .map(([, m]) => m)

let reference = (m: Manual) => {
  let opts = (m.opts ?? []).filter((opt) => opt.kind?.of || opt.or)
  if (!opts.length) return ''
  let width = Math.max(...opts.map((opt) => opt.name.length))
  return opts.map((opt) => {
    let values = opt.kind?.of?.()
    let accepts = values?.length
      ? `one of ${values.join(', ')}`
      : opt.kind?.name ?? ''
    let fallback = opt.or ? ` — default ${opt.or}` : ''
    return `  ${opt.name.padEnd(width)}  ${accepts}${fallback}`
  }).join('\n')
}

let render = (name: string, m: Manual) => {
  let out = `task ${usageOf(m)}\n  ${m.about}`
  if (m.deprecated) out += `\n\nDeprecated: ${m.deprecated}`
  let subs = children(name)
  if (subs.length) {
    out += '\n\n' +
      subs.map((s) => `  task ${usageOf(s).padEnd(58)} ${s.about}`).join('\n')
  }
  let refs = reference(m)
  if (refs) out += `\n\n${refs}`
  if (m.detail) out += `\n\n${m.detail}`
  if (m.examples?.length) {
    out += `\n\n${m.examples.map((e) => `  ${e}`).join('\n')}`
  }
  return out
}

let commandHelp = (name = '') => {
  let show = name ? { [name]: commands[name] } : commands
  if (name && !commands[name]) {
    throw new UsageError(`not a command: ${name} (task help : lists them)`)
  }
  return Object.entries(show)
    .map(([n, c]) =>
      `task :${`${n} ${slotsOf(c.args)}`.trim().padEnd(34)} ${c.about}`
    )
    .join('\n')
}

export let help = (args: string[]) => {
  if (!args.length) return usage()
  if (args[0] == '<id>' && args.length == 1) return subjectUsage()
  if (args[0] == 'subject' && args.length <= 2) return subjectUsage(args[1])
  if (args[0] == 'link' && args.length == 1) return linkHelp()
  if (args[0] == 'grammar' && args.length == 1) {
    return `${GRAMMAR}\n\n${FILTERS}`
  }
  if (args[0].startsWith(':') && args.length == 1) {
    return commandHelp(args[0].slice(1))
  }
  let name = args.join(' ')
  let manual = manuals[name]
  if (manual) return render(name, manual)
  if (args.length == 1 && commands[args[0]]) return commandHelp(args[0])
  throw new UsageError(`no such help topic: ${name} (task help lists them)`)
}

let helpAt = (args: string[]) => {
  if (!args.length) return usage()
  if (args[0] == 'help') return help(args.slice(1))
  // A plural kind IS the list verb (cli.ts `listing`), so its help is
  // list's — otherwise `task projects --help` reads as a subject.
  if (plurals.has(args[0])) return render('list', manuals.list)
  let colon = args.find((a) => a.startsWith(':'))
  if (colon) return commandHelp(colon.slice(1))
  let root = manuals[args[0]]
  if (root) {
    let nested = manuals[`${args[0]} ${args[1]}`]
    return nested
      ? render(`${args[0]} ${args[1]}`, nested)
      : render(args[0], root)
  }
  if (commands[args[0]]) return commandHelp(args[0])
  if (args[0].startsWith('-')) {
    throw new UsageError(`no such verb: ${args[0]} (task --help lists them)`)
  }
  return subjectUsage(args[0])
}

export let requestedHelp = (argv: string[]) => {
  let end = argv.indexOf('--')
  let head = end < 0 ? argv : argv.slice(0, end)
  if (head.some((a) => a == '--help' || a == '-h')) {
    return helpAt(head.filter((a) => a != '--help' && a != '-h'))
  }
  // A named door with nothing to act on is the shell's warm help path. This
  // is how agents inspect a command after a tool is unavailable; treating the
  // probe as invalid usage stamped their Session with an exception and filed
  // a bug even though the CLI successfully printed the requested usage
  // (T-19695). Optional/listing doors still run with no arguments.
  let selected = route(head[0], head.slice(1))
  if (
    selected && !selected.args.length &&
    (wordsOf(selected.manual)[0] || selected.manual.some?.length)
  ) return render(selected.name, selected.manual)
}

// Nested verbs are canonical, but a few action-shaped flags are the spelling
// callers reach for before they know the family vocabulary. Keep those warm
// paths at the router so validation and execution still use one declaration.
let routeAliases: Record<string, string> = {
  'inbox --archive': 'inbox archive',
}

export let route = <V extends Manual = Manual>(
  cmd: string | undefined,
  args: string[],
  all: Record<string, V> = manuals as Record<string, V>,
) => {
  if (!cmd) return
  let asked = `${cmd} ${args[0]}`
  let nestedName = routeAliases[asked] ?? asked
  let nested = all[nestedName]
  let familyHelp = args[0] == 'help' &&
    Object.keys(all).some((name) => name.startsWith(`${cmd} `))
  return nested
    ? { name: nestedName, manual: nested, args: args.slice(1) }
    : familyHelp
    ? { name: 'help', manual: all.help, args: [cmd] }
    : all[cmd]
    ? { name: cmd, manual: all[cmd], args }
    : undefined
}

let option = (arg: string) =>
  arg != '--' && (arg.startsWith('--') || /^-[A-Za-z]/.test(arg))

let match = (opt: Opt, arg: string) => {
  if (!opt.kind) return arg == opt.name
  if (arg == opt.name) return opt.separate
  if (opt.name.startsWith('--')) return arg.startsWith(`${opt.name}=`)
  return arg.startsWith(opt.name)
}

let optionName = (arg: string) =>
  arg.startsWith('--') ? arg.split('=')[0] : arg.slice(0, 2)

// The dot-param SHAPE — client.ts param()'s, narrowed to the leading name.
// An `=` is required, so a title word that merely opens with a dot (a
// `.gitignore`, a leading ellipsis) is prose and stays prose.
let dotted = (arg: string) =>
  /^\.([A-Za-z_][\w-]*)(?:\.[A-Za-z_][\w-]*)?=/
    .exec(arg)?.[1]

// What a verb that takes SOME dot-params should be told it takes.
let takes = (manual: Manual) =>
  Array.isArray(manual.dots) && manual.dots.length
    ? ` — it takes ${manual.dots.map((d) => `.${d}=`).join(' ')}`
    : ''

export class UsageError extends Error {}

let usageError = (name: string, manual: Manual, message: string) =>
  new UsageError(
    `${name} ${message}\nusage: task ${usageOf(manual)}` +
      (manual.deprecated ? `\ndeprecated: ${manual.deprecated}` : ''),
  )

let accepts = (kind: NonNullable<Opt['kind']>, value: string) => {
  let values = kind.of?.()
  if (values) return values.includes(value)
  if (!kind.test) return true
  kind.test.lastIndex = 0
  return kind.test.test(value)
}

let wanted = (kind: NonNullable<Opt['kind']>) =>
  kind == num
    ? 'a positive number'
    : kind == path
    ? 'a directory'
    : kind == bodyKind
    ? 'text, @file, - or @-'
    : kind == timestamp
    ? 'an ISO timestamp'
    : kind.name

let some = (manual: Manual, present: Set<string>) => {
  let missing = manual.some?.filter((name) => !present.has(name))
  if (!missing || missing.length != manual.some?.length) return
  let shape = (name: string) => {
    let positional = manual.args?.find((arg) => arg.name == name)
    if (positional) return `<${name}>`
    let opt = manual.opts?.find((opt) => opt.name == name)
    return `${name}${opt?.kind ? `=<${wanted(opt.kind)}>` : ''}`
  }
  return `needs ${missing.map(shape).join(' or ')}`
}

let parsed = (
  name: string,
  manual: Manual,
  argv: string[],
  io: Stdin,
  read: boolean,
): Got => {
  let words: string[] = []
  let slots: string[] = []
  let opts: Record<string, string> = Object.fromEntries(
    (manual.opts ?? []).flatMap((opt) =>
      opt.or == null ? [] : [[opt.name, opt.or]]
    ),
  )
  let flags = new Set<string>()
  let provided = new Set<string>()
  let params: Param[] = []
  let paramAs: string[] = []
  let reads: Record<string, { raw: string; as: string }> = {}
  let present = new Set<string>()
  let literal = false
  let value = (opt: Opt, raw: string, as: string) => {
    if (!accepts(opt.kind!, raw)) {
      throw usageError(name, manual, `${opt.name} needs ${wanted(opt.kind!)}`)
    }
    let key = opt.alias ?? opt.name
    if (provided.has(key)) return
    opts[key] = raw
    if (opt.kind!.read) {
      reads[key] = {
        raw: opt.kind!.read == 'file' ? `@${raw}` : raw,
        as,
      }
    }
    provided.add(key)
  }
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i]
    if (literal) {
      words.push(arg)
      slots.push(arg)
      continue
    }
    if (arg == '--') {
      literal = true
      if (manual.passthrough) {
        words.push(arg)
        slots.push(arg)
      }
      continue
    }
    if (!option(arg)) {
      let dot = dotted(arg)
      if (manual.dots == 'filters' && arg.startsWith('.')) {
        words.push(arg)
        continue
      }
      if (manual.dots == 'params' && arg.startsWith('.')) {
        let p = param(arg)
        if (p) {
          params.push(p)
          paramAs.push(arg)
          continue
        }
      }
      if (dot) {
        // A param the verb declares is a VALUE, so it never counts as one of
        // the words; anything else is refused by name rather than swallowed.
        if (Array.isArray(manual.dots) && manual.dots.includes(dot)) {
          let raw = arg.slice(arg.indexOf('=') + 1)
          let key = `--${dot}`
          if (!provided.has(key)) {
            opts[key] = raw
            if (dot == 'body') reads[key] = { raw, as: arg }
          }
          provided.add(key)
          present.add(key)
          continue
        }
        // A retired flag is retired at BOTH spellings: the habit that
        // outlives the mechanism reaches for whichever one it learned.
        let gone = manual.retired?.[`--${dot}`]
        if (gone) throw usageError(name, manual, gone)
        throw usageError(
          name,
          manual,
          `does not take .${dot}=: its bare words are TEXT, and an ` +
            `argument it does not know would be swallowed by them` +
            takes(manual),
        )
      }
      words.push(arg)
      slots.push(arg)
      continue
    }
    let opt = manual.opts?.find((o) => match(o, arg))
    if (!opt) {
      if (manual.passthrough) {
        words.push(arg)
        slots.push(arg)
        continue
      }
      let gone = manual.retired?.[optionName(arg)]
      if (gone) throw usageError(name, manual, gone)
      // A KNOWN value option given bare (`--body foo`, not `--body=foo`):
      // match() only accepts the `=` spelling for a non-separate value, so it
      // falls through here.
      let bare = manual.opts?.find((o) => o.kind && o.name == optionName(arg))
      if (bare) {
        // Warm path: a body option in its SPACE form, as the LAST option on the
        // line, binds the trailing words as the body — exactly as `--body=…`
        // would (T-18566/T-18481: agents keep reaching for `--body …` and won't
        // change habits from an error, so make the habit WORK). Unambiguous only
        // when body is genuinely trailing: every remaining token must be a plain
        // word, so nothing after it (an option, a `--` fold, a dot-param) is
        // swallowed. Body-type only (kind.read); other value options keep the
        // `=` requirement, since their value is a single token, not trailing.
        let trailing = argv.slice(i + 1)
        if (
          bare.kind!.read && trailing.length &&
          trailing.every((a) => a != '--' && !option(a) && !dotted(a))
        ) {
          let raw = trailing.join(' ')
          present.add(bare.name)
          value(bare, raw, `${bare.name}=${raw}`)
          break
        }
        // Name the real fault — it needs a value at the `=` spelling — rather
        // than "does not take", which reads as unknown flag and sends authors
        // in circles (T-18396: agents kept reaching for `--body …`).
        throw usageError(
          name,
          manual,
          `${bare.name} needs ${wanted(bare.kind!)} — use ${bare.name}=…`,
        )
      }
      throw usageError(name, manual, `does not take ${optionName(arg)}`)
    }
    present.add(opt.alias ?? opt.name)
    if (!opt.kind) {
      flags.add(opt.name)
      continue
    }
    let got = opt.name.startsWith('--')
      ? arg.slice(opt.name.length + 1)
      : arg.slice(opt.name.length)
    if (arg == opt.name) {
      let next = argv[i + 1]
      if (!opt.separate || !next || option(next)) {
        throw usageError(name, manual, `${opt.name} needs ${wanted(opt.kind)}`)
      }
      got = next
      i++
    }
    value(opt, got, arg == opt.name ? `${opt.name}=${got}` : arg)
  }
  let named: Record<string, string> = {}
  let many: Record<string, string[]> = {}
  let at = 0
  for (let arg of manual.args ?? []) {
    let values = arg.rest
      ? slots.slice(at)
      : slots[at] == null
      ? []
      : [slots[at]]
    if (values.length) {
      let raw = values.join(' ')
      if (!arg.rest && !accepts(arg.kind, raw)) {
        throw usageError(name, manual, `${arg.name} needs ${wanted(arg.kind)}`)
      }
      present.add(arg.name)
      named[arg.name] = raw
      many[arg.name] = values
    }
    at += arg.rest ? values.length : values.length ? 1 : 0
  }
  let issue = some(manual, present)
  if (issue) throw usageError(name, manual, issue)
  let [min, max] = wordsOf(manual)
  if (
    !manual.passthrough &&
    (slots.length < min || (max != null && slots.length > max))
  ) {
    let want = max == null
      ? `at least ${min}`
      : min == max
      ? `${min}`
      : `${min}–${max}`
    throw usageError(
      name,
      manual,
      `expected ${want} argument${want == '1' ? '' : 's'}, got ${slots.length}`,
    )
  }
  if (read) {
    for (let [key, value] of Object.entries(reads)) {
      opts[key] = String(
        inflate(
          { comp: 'doc', prop: 'body', value: value.raw },
          io,
          value.as,
        ).value,
      )
    }
    params = params.map((p, i) => inflate(p, io, paramAs[i]))
  }
  let body: string | undefined
  if (manual.body == 'body') {
    let value = params.find((p) => p.prop == 'body')?.value
    body = opts['--body'] ?? (value == null ? undefined : String(value))
  } else if (manual.body == 'text') {
    body = opts['--body']
    let text = many.text ?? []
    if (body == null && text.length) {
      if (read) separated(text)
      let raw = text.join(' ')
      body = read && text.length == 1 && /^\S+$/.test(raw)
        ? String(
          inflate({ comp: 'doc', prop: 'body', value: raw }, io, raw).value,
        )
        : raw
    }
  }
  return { args: named, many, opts, flags, params, words, body }
}

export let parse = (
  name: string,
  manual: Manual,
  argv: string[],
  io = stdin,
) => parsed(name, manual, argv, io, true)

export let validate = (
  name: string,
  manual: Manual,
  argv: string[],
) => {
  parsed(name, manual, argv, stdin, false)
}

export let validateCommand = (name: string, args: string[]) => {
  let command = commands[name]
  if (!command) {
    throw new UsageError(`not a command: :${name} (task help : lists them)`)
  }
  let end = args.indexOf('--')
  let head = end < 0 ? args : args.slice(0, end)
  let bad = head.find(option)
  if (bad) {
    let hint = ['new', 'fix', 'set'].includes(name)
      ? ` — writes use .prop=value (task help grammar)`
      : ''
    throw new UsageError(
      `:${name} does not take ${optionName(bad)}${hint}\n` +
        `usage: task :${`${name} ${slotsOf(command.args)}`.trim()}`,
    )
  }
  // A verb that does not read dot-params must refuse an unknown one by name,
  // not swallow it into its text — the same guard the CLI verbs got in T-14187,
  // now at the shared palette so a colon verb can't quietly absorb `.staus=done`
  // as prose (T-14291). The write/spec verbs declare `dots` and are exempt; a
  // `-- note` fold is prose, so only the head is screened.
  let dot = command.dots ? undefined : head.map(dotted).find(Boolean)
  if (dot) {
    throw new UsageError(
      `:${name} does not take .${dot}= — it takes positional arguments\n` +
        `usage: task :${`${name} ${slotsOf(command.args)}`.trim()}`,
    )
  }
  if (
    command.words &&
    (args.length < command.words[0] || args.length > command.words[1])
  ) {
    // A colon verb reads its entity from the FOCUS, not the argument list, so
    // an entity-shaped stray argument means the caller inverted the spelling —
    // name the one that works instead of a bare count (T-10331).
    let ent = head.find((a) => /^[A-Za-z]+-\d+$/.test(a))
    if (ent) {
      throw new UsageError(
        `:${name} ${
          command.words[1] == 0
            ? 'takes no arguments'
            : `expected ${command.words[0]}–${command.words[1]} arguments, ` +
              `got ${args.length}`
        } — did you mean 'task ${ent} :${name}'?`,
      )
    }
    throw new UsageError(
      `:${name} expected ${command.words[0]}–${command.words[1]} arguments, ` +
        `got ${args.length}\nusage: task :${
          `${name} ${slotsOf(command.args)}`.trim()
        }`,
    )
  }
}
