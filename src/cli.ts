// The task CLI. Install once, run anywhere the server is reachable:
//   deno task install       (deno install -g — puts `task` on PATH)
//   task tui                 the terminal UI
//   task list [.status=open .priority<=1 .domain=Ops,Eng]  filter grammar
//   task new .title="Hi" [.body=... .status=wip]   (bare words = title)
//   task set T-3 .status=done                       patch any entity
//   task show T-3                                   one entity, whole
// Dot-params route by prop through the shared vocabulary (.title → doc);
// collisions use the explicit .comp.prop spelling. TASKS_HOST points at a
// non-default server.
import {
  addressed,
  around,
  authoringLine,
  belongs,
  bornAt,
  bus,
  byBoard,
  byList,
  checkedRefs,
  claimant,
  claimChanges,
  commentChanges,
  contextDigest,
  contextSnapshot,
  decidedAt,
  dependents,
  derefedChanges,
  derefedParams,
  designChanges,
  dreamChanges,
  edgesOf,
  fetched,
  find,
  got,
  history,
  historyBy,
  historyLine,
  hookClaim,
  host,
  idOf,
  inboxItem,
  inboxRows,
  inflate,
  isFile,
  isUnread,
  journalRows,
  jsonAuthored,
  jsonOf,
  latestMessage,
  mailChanges,
  mailLine,
  mailThread,
  me,
  memoryChanges,
  minted,
  needed,
  neighborhoods,
  noticeBlock,
  param,
  patches,
  projectionSnapshot,
  query,
  readerFor,
  readerRows,
  redact as redactValue,
  refsIn,
  replyChanges,
  repoAt,
  rootFirst,
  type Row,
  rows,
  scopeFor,
  search,
  send,
  serverCaps,
  sessionFor,
  sessionMeta,
  sessionRow,
  showMd,
  similarHint,
  spawnChanges,
  spawnPlan,
  subChanges,
  taskBlock,
  taskChanges,
  undo,
  unreadPipe,
  wrapChanges,
} from './client.ts'
import { editChanges } from './edit.ts'
import { entityUrl } from './url.ts'
import { prune, reap, sweep } from './probes.ts'
import {
  EDGE_DOOR,
  edgeish,
  noFilter,
  type Pred,
  pred,
  resolution,
} from './query.ts'
import { checks, mailCheck, type Result, run as runChecks } from './doctor.ts'
import {
  awake,
  type Change,
  type Edge,
  edges,
  kindWord,
  plural,
  plurals,
  type Session,
  sessionOf,
  type Snapshot,
  statuses,
} from './types.ts'
import { cost, type Dim, group, report, roll, type Use, use } from './usage.ts'
// `import type` (not the repo's usual inline `{ type X }`): telemetry.ts
// reaches for the SQLite driver, and the CLI has no business loading a db.
import type { Log, Stat } from './telemetry.ts'
import type { JournalEntry } from './client.ts'
import { local } from './time.ts'
import { wakeList, wakeTitle } from './title.ts'
import {
  agentPid,
  bornAt as processBornAt,
  claudePid,
  descends,
} from './proc.ts'
import { projection, syncFiles } from './persona.ts'
import { anchorPaths, type Freshness, freshness } from './anchor.ts'
import { commit } from './git.ts'
import { land as landTree } from './land.ts'
import { request } from './http.ts'
import { commands, focusOf, run as runCommand } from './commands.ts'
import { renderEntry, seqRange, type Sift, transcribe } from './log_text.ts'
import { type EntryRow, graphLog, pageEntries } from './entry_log.ts'
import {
  cliVerbs,
  help,
  manuals,
  parse,
  requestedHelp,
  route,
  usage,
  UsageError,
  validate,
  validateCommand,
} from './manual.ts'
import { type Got, type Run, usageOf, type Verb } from './verb.ts'
import { complete } from './tabcomplete.ts'
import { loadPlugins, pluginSpecifiers } from './plugins.ts'
import { safe } from './terminal.ts'
import { VERSION } from './version.ts'
import { sha } from './sha.ts'
export { subjectUsage } from './manual.ts'

let formats = ['markdown', 'json']

// Graph content may not speak to the terminal. Every CLI line crosses this
// seam; styling belongs to the CLI and wraps only the sanitized content.
export let printer =
  (write: (line: string) => void) => (text: string, bold = false) => {
    let line = safe(text)
    write(bold ? `\x1b[1m${line}\x1b[0m` : line)
  }

let print = printer((line) => console.log(line))
let warn = printer((line) => console.error(line))

// A refusal must not disappear with the shell that saw it. Reporting is
// best-effort because a broken or absent server cannot replace the original
// diagnostic, but a live server gets the argv and session needed to improve
// the grammar, manual, or prompt that led the caller astray.
export let reportUsage = async (
  args: string[],
  error: string,
  call = request,
) => {
  try {
    await call(`http://${host()}/usage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args, error, session: me() ?? null }),
    })
  } catch { /* telemetry can never replace the refusal it observes */ }
}

// JSON.stringify already escapes C0, but writes DEL and C1 as terminal bytes.
// Spell those as JSON escapes so the parsed value and machine shape stay whole.
let jsonCtrl = /[\x7f-\x9f]/g
export let jsonText = (value: unknown) =>
  (JSON.stringify(value, null, 2) ?? '').replace(
    jsonCtrl,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )

export let claimedDigest = (mine: Row[]) =>
  mine
    .slice(0, 4)
    .flatMap((r) => taskBlock(mine, [], r))
    .join('\n')

let bare = async () => {
  print(usage())
  let session = me()
  if (!session) return
  let [sess] = await query(['.kind=session', `.session.id=${session}`])
  if (!sess) return
  let mine = await query(['.kind=task', `.claim.session=${sess.eid}`])
  let digest = claimedDigest(mine)
  if (digest) print(`\n${digest}`)
}

// `task projects` is `task list projects` — the plural IS the listing
// verb, because it is what a cold caller types before reading any help.
// Only the plural: the singular stays a subject (`task board`, `task
// home`), so no alias is shadowed by a word that names a kind. And a
// registered verb wins over the plural fallback — `task docs` lists the
// architecture docs, not every `doc` entity — so a curated verb is never
// shadowed by the kind whose plural it happens to spell (`task list docs`
// still dumps them all).
export let listing = (cmd: string | undefined, args: string[]) =>
  cmd && plurals.has(cmd) && !cliVerbs.has(cmd)
    ? { cmd: 'list', args: [cmd, ...args] }
    : undefined

// Subject-first show options enter the executable manual too, so this syntax
// cannot drift from canonical `task show`.
let isShowOption = (x: string) =>
  manuals.show.opts?.some((opt) => opt.name == x.split('=')[0]) ?? false

let showAs = (id: string, objects: string[]) => {
  if (objects.length != 1 || !formats.includes(objects[0])) {
    throw new UsageError(`format is one of: ${formats.join(', ')}`)
  }
  return {
    cmd: 'show',
    args: [id, ...(objects[0] == 'json' ? ['--json'] : [])],
  }
}

// The subject-first format phrase is also unambiguous after explicit `show`.
// Normalize both spellings before manual validation so rendering still has one
// handler and the warm `task show T-3 as json` reach cannot become extra argv.
export let showing = (cmd: string | undefined, args: string[]) =>
  cmd == 'show' && args[1] == 'as' ? showAs(args[0], args.slice(2)) : undefined

// Subject-first is syntax sugar only. The returned route enters the same
// handlers as the canonical subcommands, so graph behavior has one owner.
export let subject = (id: string | undefined, args: string[]) => {
  if (
    !id || id == '--help' || cliVerbs.has(id) || commands[id] ||
    id.startsWith(':') || id.startsWith('-')
  ) return
  let [typed, ...objects] = args
  // An edge is a subject verb even when the caller carries the palette's
  // explicit colon into the entity-first form. Both spellings enter `dep`;
  // other colon verbs still need the focused palette command path below.
  let verb = typed?.startsWith(':') &&
      (edges as readonly string[]).includes(typed.slice(1))
    ? typed.slice(1)
    : typed
  if (!verb) return { cmd: 'show', args: [id] }
  if (args.includes('--help') || args.includes('-h')) {
    return { cmd: 'help', args: ['subject', id] }
  }
  if (isShowOption(verb)) {
    let args = [id, verb, ...objects]
    validate('show', manuals.show, args)
    return { cmd: 'show', args }
  }
  if (verb == 'show') {
    if (objects[0] == 'as') {
      let [, format, ...flags] = objects
      validate('show', manuals.show, [id, '--format', format, ...flags])
      return {
        cmd: 'show',
        args: [id, ...(format == 'json' ? ['--json'] : []), ...flags],
      }
    }
    let args = [id, ...objects]
    validate('show', manuals.show, args)
    return { cmd: 'show', args }
  }
  // The subject manual names `edge` as the family door. A bare family word
  // teaches its concrete verbs; it is not itself an edge mutation.
  if (verb == 'edge' && !objects.length) {
    return { cmd: 'help', args: ['subject', id] }
  }
  if ((edges as readonly string[]).includes(verb)) {
    // Repeating the relation is a common merge of the sentence form and the
    // old typed form: `T-3 requires requires T-9`. It has only one reading,
    // so keep the warm path successful while every other surplus word stays
    // a refusal.
    if (objects[0] == verb) objects = objects.slice(1)
    let children = objects.filter((x) => x != '--gone')
    let flags = objects.filter((x) => x == '--gone')
    if (
      children.length != 1 || flags.length > 1 ||
      flags.length != objects.length - 1
    ) {
      throw new UsageError(`task ${id} ${verb} <id> [--gone]`)
    }
    return { cmd: 'dep', args: [id, verb, ...objects] }
  }
  if (verb == 'is') {
    if (objects.length != 1 || !statuses.some((s) => s == objects[0])) {
      throw new UsageError(`status is one of: ${statuses.join(', ')}`)
    }
    return { cmd: 'set', args: [id, `.status=${objects[0]}`] }
  }
  if (verb == 'as') {
    return showAs(id, objects)
  }
  // Knock already names its subject as the focused entity. Requiring the
  // palette's colon here contradicts `task help knock`'s "on the focused
  // entity" contract and makes the natural subject-first spelling fail.
  if (verb == 'knock') {
    return { cmd: id, args: [':knock', ...objects] }
  }
  // Focused palette commands keep their explicit colon: several accept
  // optional objects whose subject-first reading would be ambiguous.
  if (verb.startsWith(':')) return
  throw new UsageError(`no subject verb: ${verb} (task ${id} --help)`)
}

// Every argument at a listing door must BE a filter — the query grammar's
// operators, lists and ranges ('.priority<=1', '.domain=Ops,Eng') — so a word
// that isn't teaches instead of silently listing everything. `hint` says what
// ELSE the word could have named at that particular door.
// Parse each listing arg to a pred, teaching on a word that is no filter.
// A narrow door leaves the ref VALUES raw so the server's own resolveRefs
// (and checkedRefs) reads the human id, rather than pre-resolving against a
// whole snapshot it no longer holds.
let predicates = (args: string[], hint: (a: string) => string = () => '') =>
  args.map((a) => {
    let p = pred(a)
    if (!p) throw new Error(`${noFilter(a)} (task help grammar)${hint(a)}`)
    return p
  })

export let listArgs = (got: Pick<Got, 'opts' | 'words'>) => {
  let selected = got.opts['--kind']
  return selected ? [`.kind=${kindWord(selected)}`, ...got.words] : got.words
}

let list = async (got: Got) => {
  let json = got.flags.has('--json')
  let limit = got.opts['--limit'] ? Number(got.opts['--limit']) : undefined
  // --kind is syntax sugar at this boundary. From here on it is the same
  // ordinary `.kind=` filter as every other spelling, so query behavior keeps
  // one owner (T-18549).
  let args = listArgs(got)
  // A bare word names the KIND to list (`task list projects`); `.kind=` rides
  // `line` like any other filter.
  let words = args.map((a) => [a, kindWord(a)] as const)
  let bare = words.find(([, k]) => k)?.[1]
  // Here a bare word is also a KIND, so one that is neither names both
  // doors rather than only the filter one.
  let line = words.filter(([, k]) => !k).map(([a]) => a)
  let preds = predicates(
    line,
    (a) =>
      a.startsWith('.')
        ? ''
        : '; a bare word may name a KIND, as in task list projects',
  )
  // A handle that names nothing is a typo, not an empty result: the caller
  // typed it a moment ago and can act on the correction. The server's own
  // resolveRefs is forgiving (a saved board must not throw), so the strict
  // reading rides a keyed check here (client.ts checkedRefs).
  await checkedRefs(preds)
  // The kind this listing walks: a bare word, else the `.kind=` a filter
  // already names, else task. It rides the filter line as `.kind=` —
  // prepended for the bare word and the default, already present when the
  // caller wrote it dotted (so `task list .kind=project` is not re-scoped to
  // tasks). Derived titles and the ⚑ column resolve through one bounded read.
  let named = line.map((a) => a.match(/^\.kind=(.+)$/)?.[1]).find(Boolean)
  let kind = bare ?? (named ? kindWord(named) ?? 'task' : 'task')
  let filters = named ? line : [`.kind=${kind}`, ...line]
  let sort = got.opts['--sort']
  let hits = (await query(filters, { limit: sort ? undefined : limit })).sort(
    sort ? byList(sort) : byBoard,
  )
  if (sort && limit) hits = hits.slice(0, limit)
  let refs = await fetched(
    hits.flatMap((r) => [
      String(r.comps.claim?.session ?? ''),
      String(r.comps.deliver?.to ?? ''),
      String(r.comps.created?.by ?? ''),
      String(r.comps.created?.via ?? ''),
      String(r.comps.updated?.by ?? ''),
      String(r.comps.updated?.via ?? ''),
      String(r.comps.proposed?.by ?? ''),
      String(r.comps.proposed?.via ?? ''),
      String(r.comps.decided?.by ?? ''),
      String(r.comps.decided?.via ?? ''),
    ]).filter((s) => s),
  )
  let authors = await fetched(refs.flatMap(refsIn))
  let context = [...refs, ...authors]
  if (json) {
    return print(jsonText(hits.map((r) => jsonAuthored(context, r))))
  }
  // Ids alone do not disambiguate — two projects are both titled `holdco`
  // — so the second column carries the handle a caller can TYPE: a task's
  // status, everything else's alias.
  let lines = hits.map((r) =>
    [
      r,
      String(
        r.comps.task ? r.comps.task.status ?? '' : r.comps.alias?.slug ?? '',
      ),
    ] as const
  )
  let wide = Math.max(5, ...lines.map(([, handle]) => handle.length))
  for (let [r, handle] of lines) {
    let who = claimant(refs, r)
    let flag = who ? `  \u2691 ${who}` : ''
    let title = r.comps.wake
      ? wakeTitle(r.comps, (eid) => refs.find((x) => x.eid == eid))
      : String(r.comps.doc?.title ?? '')
    let authoring = authoringLine(context, r)
    print(
      `${idOf(r).padEnd(6)} ${handle.padEnd(wide)} ${title}${flag}${
        authoring ? ` · ${authoring}` : ''
      }`,
    )
  }
  if (!hits.length) {
    let why = resolution(preds, kind)
    warn(
      why
        ? `(no matches) · filters resolved to ${why} — list returns ${
          plural(kind)
        }`
        : '(no matches)',
    )
  }
}

// ---- task decided: what has been SETTLED where you stand, newest decision
// first. The stamp is a FACET, not a kind — a task, a memory and a doc can all
// wear one — so this walks every kind at once instead of joining `task list`'s
// kind selector. Scope comes from the cwd like `task inbox`'s reader, and is
// tested with the digest's own `belongs`, so `## decided` and this door cannot
// answer one question two ways — unscoped memories included, since a ruling
// that binds every project binds this one hardest. `--all` drops the scope.
// Filters are the one grammar ('.decided.at>="1 month ago"'), and the date
// leads each line because WHEN a thing was settled is the question the door
// answers; `created.at` would misreport a decision written up from an old
// letter.
// The project a filter NAMES, when it names exactly one — the plain
// `.project=P-30`. A list or a `!=` predicates the task column instead, and
// there is no one place in it to stand.
export let place = (preds: Pred[]) =>
  preds.find((p) =>
    p.comp == 'task' && p.prop == 'project' && p.op == '' && p.value &&
    !p.value.includes(',')
  )

// The scope decided() stands in, resolved narrowly — scopeFor otherwise
// reads a whole snapshot. A named project is the value place() lifted: a
// human ref scopeFor returns verbatim, so resolve it to the eid belongs()
// compares. Otherwise scopeFor touches only the caller's session, every repo
// row, and the persona/actor it wears — fetched as a small set that stands in
// for the corpus, since scopeFor reads nothing else.
let scopeOf = async (named?: string): Promise<string | undefined> => {
  if (named) return (await got(named))?.eid
  let sid = me()
  let sess = sid
    ? (await query(['.kind=session', `.session.id=${sid}`]))[0]
    : undefined
  let people = await fetched(
    [
      String(sess?.comps.session?.persona ?? ''),
      String(sess?.comps.session?.actor ?? ''),
    ].filter((e) => e),
  )
  let worn = people.find((r) => r.eid == sess?.comps.session?.persona)
  let home = String(worn?.comps.persona?.home ?? '')
  let all = [
    ...(sess ? [sess] : []),
    ...await query(['.repo.path!']),
    ...people,
    ...(home ? await fetched([home]) : []),
  ]
  return scopeFor(all, sess, Deno.cwd(), undefined)
}

let decided = async (got: Got) => {
  let json = got.flags.has('--json')
  let words = got.words
  let preds = predicates(words)
  await checkedRefs(preds)
  // A named project is lifted OUT of the query and stands in for the cwd:
  // asking about P-30 must mean what standing in P-30 means, and the task
  // column alone would hide that project's own memories.
  let named = place(preds)
  let scope = got.flags.has('--all') ? undefined : await scopeOf(named?.value)
  // The lifted project's own arg drops from what the server screens on; the
  // rest ride the query line beside the `.decided!` presence filter. belongs()
  // stays a JS screen — a 4-way component switch no one filter expresses.
  let screen = words.filter((_, i) => preds[i] != named)
  let hits = (await query(['.decided!', ...screen]))
    .filter((r) => belongs(r, scope))
    .sort((a, b) => decidedAt(b).localeCompare(decidedAt(a)))
  if (json) return print(jsonText(hits.map((r) => jsonOf(r))))
  // Three columns, not four: the id's PREFIX is the kind (M- is a memory,
  // T- a task), so a kind column spells the id twice and costs every title
  // a fixed indent it then truncates into. `--json` keeps the whole row.
  for (let r of hits) {
    print(
      `${decidedAt(r).slice(0, 10)} ${idOf(r).padEnd(6)} ${
        String(r.comps.doc?.title ?? '')
      }`,
    )
  }
  if (!hits.length) warn('(nothing decided)')
}

// ---- task docs: the architecture docs, root-first. These are `doc` entities
// wearing the `architecture` tag (D-18378) — the graph's self-description of
// what the system IS, linked root->leaf by `contains` edges. The root
// (D-18438) contains the leaves, so it leads; a doc no other architecture doc
// contains is a root. Filters screen it like any listing door
// (`task docs .title~=mail`), a thin query over the one tag.
let docs = async (got: Got) => {
  let json = got.flags.has('--json')
  let preds = predicates(got.words)
  await checkedRefs(preds)
  let hits = await query(['.architecture!', ...got.words])
  // The `contains` edges among the docs name the leaves, so the root leads.
  let { deps } = await neighborhoods(hits.map((r) => r.eid))
  hits = rootFirst(hits, deps)
  if (json) return print(jsonText(hits.map((r) => jsonOf(r))))
  for (let r of hits) {
    print(`${idOf(r).padEnd(6)} ${String(r.comps.doc?.title ?? '')}`)
  }
  if (!hits.length) warn('(no architecture docs)')
}

// ---- task stale: which anchored entities describe code that has MOVED. Each
// `anchor {paths, sha}` (types.ts) names the paths an entity's prose covers and
// the sha it was verified against; this asks git — in the repo the caller
// stands in — whether anything newer than that sha touched those paths
// (src/anchor.ts). A doc, memory or persona reads STALE when its code moved out
// from under it, UNKNOWN when git can't vouch (a sha rebased away, no paths, no
// repo). Surfaced, never silent: this is the freshness backbone (D-18378) that
// keeps architecture docs, memories and personas true as the code moves.
// Filters screen it like any listing door (`task stale .kind=memory`); `--all`
// keeps the current anchors in the report too. Runs one git query per anchor,
// so the report is O(anchors) — a maintenance sweep, not a hot path.
let staleLine = (r: Row, f: Freshness) => {
  let head = `${f.state.padEnd(7)} ${idOf(r).padEnd(6)} ${
    String(r.comps.doc?.title ?? '')
  }`
  let paths = anchorPaths(r.comps.anchor?.paths as string | null | undefined)
  let tail = f.state == 'stale'
    ? `${f.moved.length} commit${f.moved.length == 1 ? '' : 's'} since ${
      String(r.comps.anchor?.sha ?? '').slice(0, 8)
    } · ${paths.join(', ')}`
    : f.state == 'unknown'
    ? f.why
    : paths.join(', ')
  return tail ? `${head}\n        ${tail}` : head
}

let stale = async (got: Got) => {
  let json = got.flags.has('--json')
  await checkedRefs(predicates(got.words))
  let rows = await query(['.anchor!', ...got.words])
  let cwd = Deno.cwd()
  let graded = []
  for (let r of rows) {
    graded.push({
      r,
      f: await freshness(cwd, {
        sha: r.comps.anchor?.sha as string | null | undefined,
        paths: r.comps.anchor?.paths as string | null | undefined,
      }),
    })
  }
  // The default answers "what needs a look" — clean anchors are noise here;
  // `--all` keeps them, current-first hidden behind the moved and the unvouched.
  let order = { stale: 0, unknown: 1, clean: 2 }
  let shown =
    (got.flags.has('--all')
      ? graded
      : graded.filter((g) => g.f.state != 'clean')).sort((a, b) =>
        order[a.f.state] - order[b.f.state]
      )
  if (json) {
    return print(
      jsonText(shown.map((g) => ({ ...jsonOf(g.r), freshness: g.f }))),
    )
  }
  for (let g of shown) print(staleLine(g.r, g.f))
  if (!shown.length) {
    warn(rows.length ? '(all anchors current)' : '(no anchored entities)')
  }
}

// task new uses dot-params, not --flags. A stray --flag in the title is the
// #1 filing mistake — agents type `task new "Title --project P-30 --body ..."`,
// the whole string lands in the title, and the task files unrouted. Catch both
// the glued `--project=P-30` and the space-separated `--project P-30` (whose
// value sits in the *next* token, so no single token holds an `=`), and suggest
// the dot form with that value.
// The `task new` priority shorthand (T-6741): a LEADING P<n> is the
// priority the help advertises, pulled off the title words — P-prefixed
// only (a bare leading digit stays a title word) and only while it LEADS,
// so 'Fix the P2 bug' keeps every word. Returns the remaining title words
// and the priority when one led.
export let leadPrio = (
  words: string[],
): { words: string[]; priority?: number } =>
  words[0]?.match(/^[Pp][+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i)
    ? {
      words: words.slice(1),
      priority: Number(param(`.priority=${words[0]}`)!.value),
    }
    : { words }

// A stray --flag, and the dot-param it MEANT — if one exists. The
// suggestion is checked against the grammar before it is offered:
// suggesting `.blocked-by=T-1` for `--blocked-by` sent agents to a
// spelling that routes nowhere, and (until the param pattern admitted
// hyphens) landed in the task's title instead of erroring.
export let strayFlag = (
  words: string[],
): { got: string; suggest?: string } | null => {
  let i = words.findIndex((w) => /^--[\w-]+(=|$)/.test(w))
  if (i < 0) return null
  let raw = words[i]
  let eq = raw.indexOf('=')
  let [flag, val] = eq >= 0
    ? [raw.slice(0, eq), raw.slice(eq + 1)]
    : [raw, words[i + 1]]
  let dot = `${flag.replace(/^--/, '.')}=${val ?? '…'}`
  try {
    // param() throws for a name that routes nowhere and for an ambiguous
    // one; either way there is no single spelling to recommend.
    return { got: raw, ...(param(dot) ? { suggest: dot } : {}) }
  } catch {
    return { got: raw }
  }
}

// A bare `@file` among the title words. `task new`'s trailing words ARE
// the title, so an @-token lands in it verbatim and the task mints with an
// empty body — silently, because the caller's next read is the "T-… created"
// line and not the row. The sibling of client.ts's `dropped()`, narrowed
// the same three ways: one whitespace-free token, `@`-led, and naming a
// file that exists. `@@` escapes, prose survives, a path that isn't there
// stays storable as text.
export let strayFile = (words: string[]) =>
  words.find((w) => /^@[^@\s]\S*$/.test(w) && isFile(w.slice(1)))

let create = async (got: Got) => {
  let { params, words } = got
  let at = strayFile(words)
  if (at) {
    throw new Error(
      `${at} names a file, and \`task new\`'s words are the TITLE — ` +
        `the body rides its own door: task new "…" .body=${at}`,
    )
  }
  let stray = strayFlag(words)
  if (stray) {
    throw new Error(
      stray.suggest
        ? `task new uses dot-params, not --flags — did you mean ${stray.suggest}? (got ${stray.got})`
        : `no such prop for ${stray.got}${
          edgeish.test(stray.got)
            ? ` — ${EDGE_DOOR}`
            : ` — ${help(['grammar'])}`
        }`,
    )
  }
  // Reference values (.project=bindery, .assignee=jeff) resolve at the
  // door — same rule as the MCP tools.
  let grouped = patches(await derefedParams(params))
  // A leading P<n> sets priority (the documented shorthand); an explicit
  // .priority= wins the value, but the leading token still leaves the title.
  let { words: title, priority } = leadPrio(words)
  if (priority != null) grouped.task = { priority, ...grouped.task }
  grouped.doc = { title: title.join(' '), ...grouped.doc }
  if (!grouped.doc.title) throw new Error('a task needs a .title')
  // Default the project to the one this cwd/session stands in — an orphaned
  // task is off every board and can't land (T-16496). An explicit .project=
  // wins; scopeOf is undefined only when nothing places the caller.
  if (!grouped.task?.project) {
    let scope = await scopeOf()
    if (scope) grouped.task = { ...grouped.task, project: scope }
  }
  let eid = crypto.randomUUID()
  await send(taskChanges(eid, grouped))
  print(`${await minted(eid)} created`)
  let hint = await similarHint(
    `${grouped.doc.title}\n${grouped.doc.body ?? ''}`,
    eid,
  )
  if (hint) print(hint)
}

let set = async (got: Got) => {
  // --comment=... rides the same atomic batch as plain commentary — the
  // change itself is the journal's to record, never a comment's.
  // @file is the fleet's door for a long value (M-4415) and inflate()
  // implements it whole — @- and - for the pipe, the @@ escape for prose
  // that starts with an @, a loud `no such file` otherwise. Dot-params
  // route through it; this one didn't, so `--comment=@plan.md` stored the
  // PATH as the comment and reported success. A recorded design was lost
  // that way. EVERY value goes over, prose included: deciding here which
  // ones are worth reading is the second vocabulary that caused it.
  let say = got.opts['--comment']
  let id = got.args.id
  // --body is the warm spelling of .body for every prose-writing door. Keep
  // it in the dot-param pipeline so routing, patch grouping and atomic
  // commentary remain one mechanism; when both are said, the explicit option
  // is last and therefore wins like a repeated dot-param does.
  let params = [...got.params]
  if (got.opts['--body'] != null) {
    params.push({ comp: 'doc', prop: 'body', value: got.opts['--body'] })
  }
  if (!id || !params.length) {
    throw new Error('task set <id> .prop=value ...')
  }
  let sid = me()
  let [row, resolved, sess] = await Promise.all([
    needed(id),
    derefedParams(params),
    say && sid ? sessionRow(sid) : undefined,
  ])
  let all = [row, ...(sess ? [sess] : [])]
  await send([
    ...Object.entries(patches(resolved))
      .map(([name, comp]) => ({ eid: row.eid, name, comp })),
    ...(say ? commentChanges(all, row.eid, say, me()) : []),
  ])
  print(`${idOf(row)} updated`)
}

let assign = (got: Got) =>
  set({ ...got, params: [param(`.assignee=${got.args.who}`)!] })

// `task edit <id> <old> [new]` — the graph's Edit primitive (T-16357): a
// surgical old→new replacement on a doc body, in place of a full rewrite that
// silently clobbers a concurrent edit. editChanges() guards the write with the
// body it read (Change.was), so a body that moved since is refused with its
// current text and a fresh token below — re-run and the fetch is fresh again.
// old/new ride the @file / stdin door (M-4415) for a long block; an omitted
// new deletes the matched text. --all replaces every occurrence (else old must
// be unique). Works on ANY doc body — task, design, persona, memory, doc.
let edit = async (got: Got) => {
  let { id, old } = got.args
  if (!id || old == null) throw new Error('task edit <id> <old> [new]')
  let row = await needed(id)
  let read = (v: string) =>
    String(inflate({ comp: 'doc', prop: 'body', value: v }).value)
  let oldV = read(old)
  let newV = got.args.new == null ? '' : read(got.args.new)
  await send(editChanges(row, oldV, newV, got.flags.has('--all')))
  print(`${idOf(row)} edited`)
}

let redact = async (got: Got) => {
  let { id, selector: raw } = got.args
  if (!id || raw == null) throw new Error('task redact <id> <selector>')
  let selector = String(
    inflate({ comp: 'doc', prop: 'body', value: raw }, undefined, raw).value,
  )
  warn(`redacting ${id} — live doc, journal, search indexes, and embedding`)
  let out = await redactValue(id, selector)
  print(
    `${out.audit} recorded: ${out.target}.doc.${out.column}; ` +
      `${out.journalRows} journal batch${out.journalRows == 1 ? '' : 'es'}, ` +
      `${out.replacements} value${out.replacements == 1 ? '' : 's'} scrubbed`,
  )
  let backup = out.backup
  if (backup.error) {
    warn(
      `published backup: inspection failed — ${backup.error}; rotate the value`,
    )
  } else if (!backup.ref) {
    warn(
      'published backup: no upstream is configured; exposure is unknown; ' +
        'rotate the value',
    )
  } else if (backup.count == null) {
    warn(
      `published backup: ${backup.ref} exposure is unknown because its exact ` +
        'journal boundary could not be established; rotate the value',
    )
  } else if (!backup.count) {
    print(`published backup: ${backup.ref} has no affected commits`)
  } else {
    let first = backup.first!
    let last = backup.last!
    warn(
      `published backup: ${backup.ref} retains the value in ${backup.count} ` +
        `commit${backup.count == 1 ? '' : 's'} (${first.sha.slice(0, 8)} ` +
        `${local(first.at)} → ${last.sha.slice(0, 8)} ${local(last.at)}); ` +
        'rotate the value',
    )
  }
  print('the next backup dump will be clean; prior commits were not rewritten')
  warn(
    'SQLite free pages/WAL, frozen archives, blobs, session logs, browser ' +
      'caches, and recipients are outside this operation',
  )
}

// Explicit-target status moves are sugar over a task patch plus an optional
// closing comment, one atomic batch like `task set`. They fire only when the
// FIRST word is id-shaped: the same words are palette verbs (commands.ts) that
// otherwise operate on the session's FOCUSED task, and bare cancel prose is a
// legitimate reason for that focused task. T-14573 found `task cancel T-123`
// silently cancelling the wrong task; T-20976 found the sibling asymmetry where
// `task wip T-123` was refused despite being the predictable shell spelling.
let idLike = (s?: string) => !!s && /^[A-Za-z]+-\d+$/.test(s)

let finish =
  (status: 'wip' | 'done' | 'cancelled') => async (args: string[]) => {
    let [id, ...words] = args
    let comment = words.join(' ')
    let sid = me()
    let [row, sess] = await Promise.all([
      needed(id),
      comment && sid ? sessionRow(sid) : undefined,
    ])
    let all = [row, ...(sess ? [sess] : [])]
    await send([
      { eid: row.eid, name: 'task', comp: { status } },
      ...(comment ? commentChanges(all, row.eid, comment, me()) : []),
    ])
    print(`${idOf(row)} → ${status}${comment ? ` — ${comment}` : ''}`)
  }
let wip = finish('wip')
let done = finish('done')
let cancel = finish('cancelled')

let finishes = { wip, done, cancel }

// External block: a task stuck on something with no entity (a vendor, an
// owner decision). Writes the `blocked` facet's free-text `on`; apply()
// stamps `since`. This is what reddens the Dot — status is untouched.
let block = async (got: Got) => {
  let id = got.args.id
  let reason = (got.args.reason ?? '').trim()
  if (!id) throw new Error('task block <id> "<reason>"')
  if (!reason) throw new Error('task block <id> "<reason>" (reason required)')
  let row = await needed(id)
  await send([{ eid: row.eid, name: 'blocked', comp: { on: reason } }])
  print(`${idOf(row)} blocked — ${reason}`)
}

// Clear the block facet: the external reason is resolved. Deleting the
// component (comp null) drops the whole facet, `since` with it.
let unblock = async (got: Got) => {
  let id = got.args.id
  if (!id) throw new Error('task unblock <id>')
  let row = await needed(id)
  await send([{ eid: row.eid, name: 'blocked', comp: null }])
  print(`${idOf(row)} unblocked`)
}

// The one warm path that REMOVES: tombstone an entity through the same
// {entity: null} death every reaper rides, so apply() cascades to the
// dependents that exist ABOUT it (comments aimed at it, cards and knocks/wakes
// viewing it). The guard is authoritative — dependents() QUERIES the live
// graph, not the bounded reader diet — so a target that would take collateral
// REFUSES and names it; --cascade (or --force) takes them too. `forget` is the
// same verb, said for a memory. A leaf goes quietly.
let del = async (got: Got) => {
  let id = got.args.id
  if (!id) throw new Error('task delete <id>')
  let ok = got.flags.has('--cascade') || got.flags.has('--force')
  let row = await needed(id)
  let victims = await dependents(row.eid)
  if (victims.length && !ok) {
    throw new Error(
      `${idOf(row)} has ${victims.length} dependent${
        victims.length == 1 ? '' : 's'
      } the cascade would delete too:\n${
        victims.map((v) =>
          `  ${idOf(v)}  ${v.comps.doc?.title ?? ''}`.trimEnd()
        )
          .join('\n')
      }\nadd --cascade to delete them all, or detach them first`,
    )
  }
  await send([{ eid: row.eid, name: 'entity', comp: null }])
  print(
    `deleted ${idOf(row)}${
      victims.length
        ? ` (+${victims.length} dependent${victims.length == 1 ? '' : 's'})`
        : ''
    }`,
  )
}

// Full-text search — every doc in the graph, ranked, matches bracketed.
let seek = async (got: Got) => {
  let json = got.flags.has('--json')
  let q = got.words.join(' ')
  if (!q) throw new Error('task search <words...> (trailing * = prefix)')
  let hits = await search(q)
  if (json) return print(jsonText(hits))
  if (!hits.length) return print('(no hits)')
  for (let h of hits) {
    let aim = h.open != h.eid ? ` → on ${h.open_id ?? h.open}` : ''
    let snip = h.snip.replaceAll('\x01', '[').replaceAll('\x02', ']')
    let sunk = h.retired ? ' · retired' : ''
    print(
      `${idOf(h)} ${h.kind}: ${h.title || '(untitled)'}${aim} — ${snip}${sunk}`,
    )
  }
}

// ---- task mail: the mail door (letters only — mail-comp wearers; hooks
// and event comments never surface here) ----

// A writing verb's arguments as its door reads them: the VALUES it takes,
// each said at either spelling — `--body=x` and `.body=x`, since the dot form
// is what every other writing door speaks and the agent who just filed a task
// types it here too — and the bare WORDS, which are its title, subject or
// text. A param can therefore never reach the words, which is the whole
// point: these doors build their text by SUBTRACTION, so `task design "…"
// .body=@plan.md` used to store the flag IN the title and mint an empty body
// (T-14187). A param the verb does NOT take never gets this far — manual.ts
// `dots` refuses it by name.

// The bare `task mail` list form is retired (T-10847): `task inbox` speaks the
// same filter grammar, --all and --sent, so the mail-only listing logic is
// gone — its reasoning already lives on in inboxList's comments. `mail` stays
// deprecated, so bare `task mail` hard-errors with a one-line pointer at
// `task inbox` (T-16375), and this handler only ever prints help if that mark
// is ever lifted; the real doors are the `mail send`/`reply`/`show` subverbs.

// One mail whole, its thread beneath — and reading IS the mark: the
// `opened` stamp (T-7006) lands by a normal wire patch. Nothing else
// auto-reads.
let mailShow = async (got: Got) => {
  let json = got.flags.has('--json')
  let id = got.args.id
  if (!id) throw new Error(help(['mail', 'show']))
  let found = await around(id)
  if (!found?.row.comps.mail) throw new Error(`not a mail: ${id}`)
  let row = found.row
  let thread = await mailThread(row)
  if (json) {
    print(jsonText({
      ...jsonOf(row),
      thread: thread.map((t) => idOf(t)),
    }))
  } else {
    print(showMd({ deps: found.deps }, found.all, row))
    if (thread.length > 1) {
      print('\n## Thread')
      for (let t of thread) {
        print(`${t.eid == row.eid ? '▶' : ' '} ${mailLine(t)}`)
      }
    }
  }
  if (!row.comps.opened) {
    await send([{ eid: row.eid, name: 'opened', comp: {} }])
  }
}

// Minting doc+mail IS the send request — the server's effect delivers
// and stamps the receipt; task show <E-id> reads it back.
let mailSend = async (got: Got) => {
  let to = got.args.to, subject = got.args.subject
  if (!to || !subject) {
    throw new Error(help(['mail', 'send']))
  }
  let body = got.body
  if (!body) {
    throw new Error(
      'a mail needs a body: --body=@file, or --body=- with piped stdin',
    )
  }
  let made = mailChanges({ to, subject, body })
  await send(made.changes)
  let eid = await minted(made.eid)
  print(`${eid} → ${to} — task show ${eid} for the delivery receipt`)
}

let mailReply = async (input: Got) => {
  let id = input.args.id
  if (!id) throw new Error(help(['mail', 'reply']))
  let row = await got(id)
  if (!row?.comps.mail) throw new Error(`not a mail: ${id}`)
  let body = input.body
  if (!body) {
    throw new Error(
      'a reply needs words: text, @file, or --body=@file|-|@-',
    )
  }
  let made = replyChanges(row, body)
  await send(made.changes)
  let eid = await minted(made.eid)
  print(
    `${eid} → ${made.changes[1].comp?.to} (re: ${
      idOf(row)
    }) — task show ${eid} for the receipt`,
  )
}

// Attachments, through the server's proxy (the worker's token lives
// there, never here — the CLI only ever talks to its own server).
// Default DIR: ./mail-attachments/<message-id>/.
let mailFiles = async (got: Got) => {
  let out = got.opts['--out']
  let id = got.args.id
  if (!id) throw new Error(help(['mail', 'files']))
  let door = `http://${host()}/mail/${encodeURIComponent(id)}/files`
  let res = await request(door)
  if (!res.ok) throw new Error(await res.text())
  let { message_id, files } = await res.json() as {
    message_id: string
    files: { name: string; size: number }[]
  }
  if (!files.length) return print(`no attachments for ${id}`)
  out ??= `mail-attachments/${message_id.replace(/[^\w.-]/g, '_')}`
  Deno.mkdirSync(out, { recursive: true })
  for (let f of files) {
    let r = await request(`${door}/${encodeURIComponent(f.name)}`)
    if (!r.ok) throw new Error(`${f.name}: ${await r.text()}`)
    // R2 keys can't hide a directory in a NAME — but never trust one.
    let path = `${Deno.realPathSync(out)}/${f.name.replaceAll('/', '_')}`
    await Deno.writeFile(path, new Uint8Array(await r.arrayBuffer()))
    print(path)
  }
}

// Render a check run: one line per finding (✗ hard, ⚠ soft), a ✓ for a check
// that found nothing, then a one-line tally. Exit 1 on any hard finding — the
// disease is a system that is wrong and looks fine, so a red line must move
// the exit code, not just the eye.
let printChecks = (results: Result[]) => {
  let fails = 0
  let warns = 0
  for (let { name, reports } of results) {
    if (!reports.length) {
      print(`✓ ${name}`)
      continue
    }
    for (let r of reports) {
      if (r.level == 'fail') fails++
      else warns++
      print(`${r.level == 'fail' ? '✗' : '⚠'} ${name}: ${r.text}`)
    }
  }
  print(
    `${results.length} check${results.length == 1 ? '' : 's'} — ` +
      `${fails} failing, ${warns} warning${warns == 1 ? '' : 's'}`,
  )
  if (fails) Deno.exit(1)
}

// The doctor: run every check over the live graph. `task mail doctor` keeps
// its own door but is now just the mail check, so the two share one renderer.
let doctor = async () => printChecks(await runChecks(checks, query))
let mailDoctor = async () => printChecks(await runChecks([mailCheck], query))

// FTS, screened to mail — the one search surface, one more door.
let mailSeek = async (got: Got) => {
  let q = got.args.words
  if (!q) throw new Error(help(['mail', 'search']))
  let hits = (await search(q)).filter((h) => h.kind == 'mail')
  if (!hits.length) return print('(no hits)')
  for (let h of hits) {
    let snip = h.snip.replaceAll('\x01', '[').replaceAll('\x02', ']')
    print(`${idOf(h)} ${h.title || '(no subject)'} — ${snip}`)
  }
}

// ---- task inbox: everything addressed to you — comments on your session
// and claimed tasks, knocks at your door, project mail — filtered to what
// you haven't archived (T-7006). `show` marks an item opened (reading IS
// the mark); `archive` is the ONE act that hides. Generalizes `task mail`.
let inboxLine = (r: Row) => {
  let dot = r.comps.archived ? '×' : isUnread(r) ? '●' : '·'
  let body = String(r.comps.doc?.body ?? r.comps.doc?.title ?? '')
    .split('\n')[0].slice(0, 80)
  return `${dot} ${idOf(r)} ${r.kind}${body ? ` — ${body}` : ''}`
}

// The inbox list: addressed to me, NOT archived, oldest→newest so the
// freshest sits at the bottom, like mail. Reading a line never moves it.
// --all keeps the archived (`×`), which is what makes archiving safe to
// automate: closing a task hides its correspondence, and this is the way
// back to it.
let inboxList = async (got: Got) => {
  let json = got.flags.has('--json')
  let every = got.flags.has('--all')
  let sent = got.flags.has('--sent')
  // The one filter grammar, same as every other list door. Deprecating
  // `task mail` must not NARROW the surface: it took filters and --sent, so
  // the door that supersedes it takes them too, or the warm path stays the
  // deprecated one (T-10767).
  let preds = got.words.map((a) => {
    let p = pred(a)
    if (!p) throw new Error(`not an inbox filter: ${a}\n\n${help(['inbox'])}`)
    return p
  })
  await checkedRefs(preds)
  let filters = got.words
  let gathered = sent
    ? {
      rows: await query(
        ['.kind=mail', '.mail.to!', '.mail.message_id=', ...filters],
      ),
      who: undefined,
    }
    : await inboxRows(
      me(),
      Deno.cwd(),
      filters,
      every ? 'all' : 'inbox',
    )
  // Outbound is the mail door's own test — no message_id means it never
  // arrived from the edge — so the two verbs cannot disagree about "sent".
  let mine = sent
    ? (r: Row) => !!r.comps.mail && !r.comps.mail.message_id
    : every
    ? addressed(gathered.who!)
    : inboxItem(gathered.who!)
  let items = gathered.rows.filter(mine)
    .sort((a, b) => bornAt(a).localeCompare(bornAt(b)))
  if (json) return print(jsonText(items.map((r) => jsonOf(r))))
  if (!items.length) {
    return warn(
      sent
        ? '(nothing sent)'
        : every
        ? '(nothing addressed to you)'
        : '(inbox empty)',
    )
  }
  let bold = Deno.stdout.isTerminal()
  for (let r of items) {
    let line = inboxLine(r)
    print(line, bold && isUnread(r))
  }
}

// Reading IS the mark: render the item whole, then stamp `opened` (a bare
// wire write; the server freezes the clock) — the way mailShow stamps.
let inboxShow = async (got: Got) => {
  let json = got.flags.has('--json')
  let id = got.args.id
  if (!id) throw new Error(help(['inbox', 'show']))
  let found = await around(id)
  if (!found) throw new Error(`no such entity: ${id}`)
  let { deps, all, row } = found
  if (json) print(jsonText(jsonOf(row)))
  else print(showMd({ deps }, all, row))
  if (!row.comps.opened) {
    await send([{ eid: row.eid, name: 'opened', comp: {} }])
  }
}

// The one verb that hides: stamp `archived`, removing the item from the
// inbox predicate. Deliberate — no sweep or subagent can do this for you.
let inboxArchive = async (input: Got) => {
  let id = input.args.id
  if (!id) throw new Error(help(['inbox', 'archive']))
  let row = await got(id)
  if (!row) throw new Error(`no such entity: ${id}`)
  await send([{ eid: row.eid, name: 'archived', comp: {} }])
  print(`archived ${idOf(row)}`)
}

// The standing instruction, as two verbs — because a component nobody
// has a verb for is a component nobody writes. Read for whoever the cwd
// makes you, the same actor `task inbox` reads for, so what you watch
// here is what shows up there.
let subscribe = (mode: 'watch' | 'mute') => async (input: Got) => {
  let gone = input.flags.has('--gone')
  let id = input.args.id
  if (!id) throw new Error(help([mode]))
  let row = await got(id)
  if (!row) throw new Error(`no such entity: ${id}`)
  let all = await readerRows(me())
  let who = readerFor(all, me(), Deno.cwd())
  let actor = who.actor ?? who.scope
  if (!actor) {
    throw new Error(
      `no actor here: ${mode} is per-actor, and this cwd resolves to none`,
    )
  }
  if (actor != who.actor) {
    all.push(...await query([`.subscription.actor=${actor}`]))
  }
  let changes = subChanges(all, actor, row.eid, gone ? null : mode)
  let said = mode == 'watch' ? 'watching' : 'muting'
  if (!changes.length) return warn(`not ${said} ${idOf(row)}`)
  await send(changes)
  print(`${gone ? `no longer ${said}` : said} ${idOf(row)}`)
}

// The session arg accepts a human S-id like every other reference
// (CLAUDE.md invariant), not only the raw external session.id. An idLike arg
// resolves to its session entity and yields that entity's external id; a
// missing or non-session id ERRORS rather than minting a phantom session
// named after the literal string — two builders passed `S-16450` and claimed
// under a garbage session whose id was the string "S-16450", so `task land`
// then found "no task" (T-16487). A raw external id (a uuid, never idLike)
// passes straight through to claimChanges' find-or-mint, which reifies a
// hook/spawn's session on first sight.
let sessionArg = async (arg: string): Promise<string> => {
  if (!idLike(arg)) return arg
  let row = await needed(arg)
  let sid = row.comps.session?.id
  if (!sid) throw new Error(`${idOf(row)} is not a session`)
  return String(sid)
}

// A claim is a session's lease on a task — other agents see who holds
// it, and the server refuses to hand a held lease to someone else.
let claim = async (got: Got) => {
  let id = got.args.id, sess = got.args.session
  if (!id) throw new Error('task claim <id> [session]')
  let session = sess ? await sessionArg(sess) : me()
  if (!session) {
    throw new Error('task claim <id> <session> (or run under a session)')
  }
  // The task by address, and the claiming session by its unique id — the
  // two rows claimChanges reads. sessionFor mints the session only on a
  // genuinely-absent sessionRow (query throws on a fetch miss, never []),
  // so a claim reifies exactly one session on first sight, as the whole
  // snapshot did.
  let row = await needed(id)
  let srow = await sessionRow(session)
  await send(
    claimChanges([row, ...(srow ? [srow] : [])], row.eid, session, Deno.cwd()),
  )
  print(`${idOf(row)} claimed by ${session}`)
}

// Dispatch a managed agent onto a task — one wire write; the server's
// created(session) effect does the rest, and any failure is a failed
// Session on the board (task show <S-id> reads it back). Reads the graph
// fresh so a task the caller just filed (:fix) is visible.
let launch = async (
  id: string | undefined,
  flags: {
    provider?: string
    model?: string
    effort?: string
    persona?: string
    prompt?: string
  },
) => {
  let by = me()
  let [task, caller, table, caps] = await Promise.all([
    id ? needed(id) : undefined,
    by ? sessionRow(by) : undefined,
    (await request(`http://${host()}/providers`)).json(),
    serverCaps(),
  ])
  let base = [...(task ? [task] : []), ...(caller ? [caller] : [])]
  // One precedence: explicit flags > the task's spawn hint > the calling
  // session's own spec > the provider-table default.
  let plan = spawnPlan(base, table, {
    task: id,
    session: by,
    ask: {
      provider: flags.provider,
      model: flags.model,
      effort: flags.effort,
      persona: flags.persona,
    },
  })
  if (!plan.provider || !plan.model) {
    throw new Error('no provider to default to')
  }
  // The chosen persona's neighborhood carries the ownership edges spawnChanges
  // reads for the actor — fetch it whether it came from a flag or the hint.
  let persona = plan.persona ? await around(plan.persona) : undefined
  let all = [...base, ...(persona?.all ?? [])]
  let made = spawnChanges(all, {
    task: id,
    prompt: flags.prompt,
    provider: plan.provider,
    model: plan.model,
    effort: plan.effort,
    persona: plan.persona,
    by,
    deps: persona?.deps,
  }, caps)
  await send(made.changes)
  let onto = id ? find(all, id) : undefined
  print(`${await minted(made.eid)} spawned${onto ? ` onto ${idOf(onto)}` : ''}`)
}

let spawn = async (got: Got) => {
  let id = got.args.id
  if (!id) {
    throw new Error(
      'task spawn <id> [--provider=X] [--model=Y] [--effort=Z] [--persona=P-9]',
    )
  }
  await launch(id, {
    provider: got.opts['--provider'],
    model: got.opts['--model'],
    effort: got.opts['--effort'],
    persona: got.opts['--persona'],
  })
}

// All the sweep wants from the graph: the id a probe carries, the ground a
// session worked in, the pid it ran as. /proc decides the rest.
let sessionsOf = (all: Row[]) =>
  all.filter((r) => r.comps.session).map((r) => ({
    id: String(r.comps.session!.id ?? ''),
    cwd: r.comps.session!.cwd as string | null,
    pid: r.comps.session!.pid as number | null,
    // A graph-native session has an ordered log but no provider pid. The CLI
    // holds no entry log to tell a settled one from an open one, so it spares
    // every such checkout and leaves trimming the settled ones to the server
    // sweep, which does hold the log. Half 2 regrows any it collects (T-16761).
    active: !!r.comps.session!.latest_seq,
  }))

// The one landing door — a pure git primitive. The worktree you stand in names
// what to land; `git worktree list` names the shared checkout and its base
// branch (land.ts). No graph read, no gate, no task or claim required — running
// the gate and closing the task are YOUR steps around this one. Land either
// fast-forwards the branch into the base (landed) or, if the base moved,
// rebases and returns for you to re-gate and re-land; land.ts prints git's own
// account either way.
//
// On a landing the caller keeps its worktree (land.ts), so each landing
// collects what EARLIER ones left: whoever comes next is, reliably, the next
// lander. Checkouts only — killing processes stays behind `task probes --reap`,
// where an operator reads the reasons first. This tree is never a candidate
// while the verb runs in it: judgeTree spares a worktree with a process
// inside, and that process is us.
let land = async () => {
  let outcome = await landTree()
  // The base moved: land.ts already rebased and told the agent what to do.
  if (!('landed' in outcome)) return
  console.log(
    `landed ${outcome.landed} — now close the task and release your claims ` +
      '(task done <id>; task release <id>)',
  )
  let sessions = await query(['.kind=session'])
  for (let t of sweep(sessionsOf(sessions), outcome.root).trees) {
    if (t.prune && prune(outcome.root, t.tree)) warn(`swept ${t.tree.path}`)
  }
}

// The palette's `:` line, spoken from the shell — the same commands.ts
// table the web bar and the TUI run, so the owner and every agent share
// one vocabulary. "Where you stand" translates: lead with an id
// (`task T-42 :done`), or your session's single claim is the focus
// (`task :done`). The intent is spent the CLI way: changes ride send(),
// a spawn launches exactly like `task spawn`, go prints the URL.
let colon = async (focus: string | undefined, argv: string[]) => {
  let line = argv.join(' ').replace(/^:/, '')
  // Teach at the point of failure — an agent that guesses a verb gets
  // the menu, not a shrug.
  let name = line.trim().split(/\s/)[0]
  if (name && !commands[name]) {
    throw new Error(`not a command: :${name} — 'task help :' lists them all`)
  }
  let session = me()
  let all = await readerRows(session)
  let eid: string | undefined
  if (focus) {
    let r = await needed(focus)
    all.push(r)
    eid = r.eid
  } else eid = focusOf(all, session)
  let rest = line.trim().split(/\s+/).slice(1)
  let one = async (id?: string) => {
    if (!id) return
    let row = await got(id)
    if (row) all.push(row)
  }
  if (name == 'open' || name == 'reply') await one(rest[0])
  if (name == 'fix') {
    if (/^[A-Za-z]+-\d+$/.test(line.slice(name.length).trim())) {
      await one(line.slice(name.length).trim())
    } else {
      all.push(...await query(['.kind=project', '.repo!']))
      await one('tasks')
    }
  }
  if (name == 'meta' && session) {
    // The anchor the memo lands on: the caller session and its newest message
    // entry (client.ts pages to the tail). The verb picks the max-seq message
    // entry among these, or falls back to the session row.
    let sess = await sessionRow(session)
    if (sess) {
      all.push(sess)
      let latest = await latestMessage(sess.eid)
      if (latest) all.push(latest)
    }
  }
  if (name == 'knock') await one(rest[0])
  if (name == 'wake') {
    // Pre-fetch who + target from the head only — a `-- note` fold must not
    // let the note's last word masquerade as the target reference. The who
    // (first word) MUST resolve, so surface the near-match error the way `show`
    // does (needed()), not the command's generic usage (T-13972); the last word
    // is only MAYBE a target (a when-word or note), so it stays lenient.
    let head = line.split(/\s+--\s+/)[0].trim().split(/\s+/).slice(1)
    await Promise.all([
      head[0] ? needed(head[0]).then((r) => void all.push(r)) : undefined,
      one(head.at(-1)),
    ])
  }
  if (name == 'claim' && rest[0]) {
    let sess = await sessionRow(rest[0])
    if (sess) all.push(sess)
  }
  if (name == 'park' && session) {
    // :park reads the caller's own session and the single task it claims
    // (focusFor). Pre-fetch both so the local reader resolves them without a
    // whole-graph snapshot — the session row (for g.session) and the claimed
    // task rows (which carry the `.claim.session` the focus is read from).
    let sess = await sessionRow(session)
    if (sess) {
      all.push(sess)
      all.push(...await query([`.claim.session=${sess.eid}`]))
    }
  }
  if (name == 'scribe') {
    await Promise.all([one(rest[0]), one('scribe-desk'), one('scribe')])
    let desk = find(all, 'scribe-desk')
    if (desk) {
      all.push(...await query([`.session.requested_task=${desk.eid}`]))
    }
  }
  all = [...new Map(all.map((r) => [r.eid, r])).values()]
  // A shell has a filesystem, so a dot-param value here reads @file and
  // @- exactly as `task set` does — one convention across the CLI's doors.
  let out = runCommand(line, { eid, rows: all, session, read: inflate })
  let changes = out.changes?.length
    ? await derefedChanges(out.changes)
    : undefined
  if (changes) await send(changes)
  if (out.msg) print(out.msg)
  if (name == 'wake' && changes) {
    let to = String(changes.find((c) => c.name == 'deliver')?.comp?.to ?? '')
    let wakes = await query([
      '.wake!',
      `.deliver.to=${to}`,
      '.delivered=',
      '.error=',
    ])
    let refs = [
      ...all,
      ...await fetched(
        wakes.map((r) => String(r.comps.wake?.target ?? '')).filter(Boolean),
      ),
    ]
    let recipient = refs.find((r) => r.eid == to) ?? {
      eid: to,
      kind: 'entity',
      num: 0,
      comps: {},
    }
    print(wakeList(wakes, recipient, (id) => refs.find((r) => r.eid == id)))
  }
  if (out.spawn) {
    if (typeof out.spawn == 'string') await launch(out.spawn, {})
    else await launch(undefined, out.spawn)
  }
  if (out.go) {
    let r = all.find((x) => x.eid == out.go)
    print(entityUrl(r ? idOf(r) : out.go))
  }
}

// Release the lease this read observed, never a successor that won the gap
// between needed() and apply(). The expected-holder spelling below adds a
// human check; this precondition is the atomic half shared by every spelling.
export let releaseChange = (row: Row): Change | undefined => {
  let held = String(row.comps.claim?.session ?? '')
  return held
    ? {
      eid: row.eid,
      name: 'claim',
      comp: null,
      was: { session: sha(held) },
    }
    : undefined
}

let release = async (got: Got) => {
  let id = got.args.id
  if (!id) throw new Error('task release <id>')
  let positional = got.args.session
  let option = got.opts['--claim']
  if (positional && option && positional != option) {
    throw new UsageError(
      `release names two different sessions: ${positional} and ${option}\n` +
        `usage: task ${usageOf(manuals.release)}`,
    )
  }
  let row = await needed(id)
  let change = releaseChange(row)
  if (!change) return warn(`${idOf(row)} is not claimed`)
  let expected = positional ?? option
  if (expected) {
    let sid = await sessionArg(expected)
    let session = await sessionRow(sid)
    if (!session) throw new Error(`no session: ${expected}`)
    if (session.eid != row.comps.claim?.session) {
      let holder = await needed(String(row.comps.claim?.session))
      let name = String(holder.comps.session?.id ?? idOf(holder))
      throw new Error(`${idOf(row)} claimed by ${name}, not ${expected}`)
    }
  }
  await send([change])
  print(`${idOf(row)} released`)
}

// `task wake <who> --gone [target]` clears a pending wake. A wake has no
// status to flip — it is unacted while it wears neither delivered nor error,
// and firing reads exactly that (wake.ts pending()), never a status column, so
// a `set .status=cancelled` reports success while the wake fires anyway
// (T-12471). Deleting the row is the honest stop: it is gone, so the timer's
// next re-arm never sees it. Bare, it clears the untargeted CADENCE wake — the
// YELLOW-park case in M-7323; with a target, only that one reminder, the same
// cadence-vs-reminder split apply()'s replaceWakes already draws on the mint
// side.
let wakeCancel = async (rest: string[]) => {
  let words = rest.filter((w) => w != '--gone')
  if (!words[0] || words.length > 2) {
    throw new UsageError(
      'task wake <who> --gone [target] — name whose wake to clear',
    )
  }
  let who = await needed(words[0])
  let target = words[1] ? await needed(words[1]) : undefined
  let pending = await query([
    '.wake!',
    `.deliver.to=${who.eid}`,
    '.delivered=',
    '.error=',
    target ? `.wake.target=${target.eid}` : '.wake.target=',
  ])
  let where = target ? ` → ${idOf(target)}` : ''
  if (!pending.length) return print(`no pending wake for ${idOf(who)}${where}`)
  await send(
    pending.map((r): Change => ({ eid: r.eid, name: 'entity', comp: null })),
  )
  print(
    `cleared ${pending.length} wake${pending.length == 1 ? '' : 's'} for ${
      idOf(who)
    }${where}`,
  )
}

// A role is DESIRED capacity, so the only honest stop is a state patch. The
// reconciler drives processes toward this row every couple of seconds, which
// means killing a pane or a tmux session is not a stop — it is a relaunch with
// extra steps. `task role stop` is therefore the whole off switch, and it is
// durable: it survives a daemon restart because the desire, not the process,
// is what got written down.
let neededRole = async (id: string) => {
  let row = await needed(id)
  if (!row.comps.role) throw new Error(`not a role: ${id}`)
  return row
}

let roleSession = (all: Row[], eid: string) =>
  all.filter((r) => r.comps.session?.role == eid)
    .sort((a, b) => a.num - b.num).at(-1)

let roleLine = (all: Row[], r: Row) => {
  let role = r.comps.role, spawn = r.comps.spawn ?? {}
  let scope = all.find((x) => x.eid == role.scope)
  let live = roleSession(all, r.eid)
  let cells = [
    idOf(r).padEnd(7),
    String(role.state ?? '').padEnd(8),
    String(role.surface ?? '').padEnd(8),
    `${spawn.provider ?? '?'}/${spawn.model ?? '?'}`.padEnd(16),
    (scope ? String(scope.comps.doc?.title ?? idOf(scope)) : '—').padEnd(14),
    live ? `${idOf(live)} ${live.comps.session?.turn ?? ''}`.trim() : '—',
  ]
  return cells.join('  ').trimEnd() +
    (r.comps.error?.message
      ? `\n${' '.repeat(9)}error: ${r.comps.error.message}`
      : '')
}

let wantState = (sub: string) =>
  sub == 'start' || sub == 'resume' || sub == 'cycle'
    ? 'running'
    : sub == 'stop'
    ? 'stopped'
    : sub == 'pause'
    ? 'paused'
    : sub == 'disable'
    ? 'disabled'
    : 'retired'

// The roles a state verb aims at: named ids, or every role under `--all`.
// `.role.state!`, not `.role!` — bare `.role` is session.role, which would
// list sessions. state is NOT NULL on every role, so its presence IS the
// component's.
let roleTargets = async (sub: string, got: Got) => {
  let ids = got.many.ids ?? []
  let targets = got.flags.has('--all')
    ? (await query(['.role.state!'])).sort((a, b) => a.num - b.num)
    : await Promise.all(ids.map(neededRole))
  if (!targets.length) {
    throw new Error(got.flags.has('--all') ? 'no roles' : help(['role', sub]))
  }
  return targets
}

// Patch the desired state onto a set of roles and report each. Shared by the
// simple state verbs and by `cycle`, which drives stopped→running itself.
let moveRoles = async (targets: Row[], want: string) => {
  let moved = targets.filter((r) => r.comps.role.state != want)
  // Start is the owner's "try again now": it also fences the crash-loop
  // breaker (retry_at) so deaths before this instant no longer count. The
  // reconciler clears the shared error only after the retry succeeds.
  let comp = want == 'running'
    ? { state: want, retry_at: new Date().toISOString() }
    : { state: want }
  await send(moved.map((r) => ({ eid: r.eid, name: 'role', comp })))
  for (let r of targets) {
    let already = !moved.includes(r) ? ' (already)' : ''
    print(`${idOf(r)} ${want}${already}  ${r.comps.doc?.title ?? ''}`)
  }
}

let roleState = async (sub: string, got: Got) =>
  moveRoles(await roleTargets(sub, got), wantState(sub))

// A role's sessions still holding a live process. The reconciler ADOPTS any
// live session for a role (dedup), so it refuses to spawn a fresh one while one
// lives. Reads wire-visible liveness (awake): a session we spawned says it in
// its status, an external one while it holds a process the server hasn't watched
// shut. Pure, so cli_test drives the decision without a server.
export let liveRoleSessions = (sessions: Row[]) =>
  sessions.filter((r) => r.comps.session && awake(r.comps.session as Session))

// A role's stop is FULLY reconciled — safe to restart — when its live session
// is gone AND the reconciler has cleared the role's applied_hash. That hash is
// the respawn idempotency key (roles.ts reconcileManaged): while it still
// matches, a settled session is adopted, not replaced. reconcileStopped clears
// it only once the session is inactive, so waiting on the dead session alone
// races that bookkeeping — a restart that wins the race finds a matching hash
// and declines to spawn. `role stop; role start` works by hand only because
// seconds pass between them; cycle closes that window. Pure and exported so the
// whole restart decision is tested without a server.
export let restartReady = (role: Row | undefined, sessions: Row[]) =>
  !!role && role.comps.role?.applied_hash == null &&
  !liveRoleSessions(sessions).length

// Wait for a role's stop to fully settle before the restart. A managed role has
// no periodic reconcile (only native roles get the liveness poller), so once its
// session dies asynchronously nothing re-drives the role to clear applied_hash
// on its own. Re-asserting the stop is that trigger: reconcileStopped, run again
// with the session now inactive, nulls the hash — idiomatic desired-state
// convergence, the same patch `role stop` casts. Bounded: a wedged stop reports
// rather than hanging the verb forever.
let settledDown = async (eid: string, timeoutMs = 60_000) => {
  let start = Date.now()
  while (true) {
    let [role] = await fetched([eid])
    let sessions = await query([`.session.role=${eid}`])
    if (restartReady(role, sessions)) return
    if (role && !liveRoleSessions(sessions).length) {
      // Session gone, hash still set — nudge the reconciler to settle it.
      await send([{ eid, name: 'role', comp: { state: 'stopped' } }])
    }
    if (Date.now() - start > timeoutMs) {
      let live = liveRoleSessions(sessions)[0]
      throw new Error(
        live
          ? `${idOf(live)} did not stop within ${timeoutMs / 1000}s`
          : `${role ? idOf(role) : eid} stop did not settle within ${
            timeoutMs / 1000
          }s`,
      )
    }
    await new Promise((ok) => setTimeout(ok, 250))
  }
}

// `task role cycle <entity>` — a deliberate clean handoff PAST the adopt/dedup
// guard. Stop reuses `role stop`'s state patch, so the reconciler kills the live
// session and its wrapper stamps final_text; the predecessor's brief (T-19460)
// or that final_text is what briefOf hands the successor. Then wait for the stop
// to fully settle, and reuse `role start` to spawn fresh. This authors no brief
// — a session writes its own during its life; cycle only preserves and hands it
// off.
let roleCycle = async (got: Got) => {
  let targets = await roleTargets('cycle', got)
  await moveRoles(targets, 'stopped')
  for (let r of targets) await settledDown(r.eid)
  // Re-resolve before starting: the first targets carry their PRE-stop state,
  // and moveRoles skips a role already in the wanted state — so a stale
  // 'running' would make the restart a no-op. A fresh read sees 'stopped'.
  await moveRoles(await roleTargets('cycle', got), 'running')
}

let role = async (got: Got) => {
  let sub = got.args.command
  if (sub) {
    throw new Error(`not a role verb: ${sub}\n\n${help(['role'])}`)
  }
  // Three keyed queries stand in for the corpus: the roles, the entities
  // they scope, and every session carrying a role (roleSession picks
  // the newest per role). roleLine/roleSession read them as one set.
  // `.role.state!` (state is NOT NULL on every role), not `.role!` — bare
  // `.role` is session.role and would list sessions.
  let roles = (await query(['.role.state!'])).sort((a, b) => a.num - b.num)
  let scopes = await fetched(
    roles.map((r) => String(r.comps.role.scope ?? '')).filter(Boolean),
  )
  let all = [...roles, ...scopes, ...await query(['.session.role!'])]
  if (got.flags.has('--json')) {
    return print(jsonText(
      roles.map((r) => ({
        id: idOf(r),
        title: r.comps.doc?.title ?? null,
        ...r.comps.role,
        error: r.comps.error?.message ?? null,
        spawn: r.comps.spawn ?? null,
        session: roleSession(all, r.eid)?.comps.session?.id ?? null,
      })),
    ))
  }
  if (!roles.length) return print('no roles')
  for (let r of roles) print(roleLine(all, r))
}

// An edge is a sentence — "<id> requires <child>" — and the comp names the
// whole triple, so link and unlink are the same Change with gone flipped.
let dep = async (got: Got) => {
  let gone = got.flags.has('--gone')
  let id = got.args.id, type = got.args.type, childId = got.args.child
  if (!id || !type || !childId) {
    throw new Error('task dep <id> <type> <child> [--gone]')
  }
  if (!edges.includes(type as Edge)) {
    throw new Error(`edge type is one of: ${edges.join(', ')}`)
  }
  let row = await needed(id)
  let child = await needed(childId)
  await send([{
    eid: row.eid,
    name: 'dependency',
    comp: { type, child: child.eid, ...(gone ? { gone: true } : {}) },
  }])
  print(`${idOf(row)} ${type} ${idOf(child)}${gone ? ' — unlinked' : ''}`)
}

let requireEdge = (got: Got) =>
  dep({
    ...got,
    args: {
      id: got.args.parent,
      type: 'requires',
      child: got.args.child,
    },
  })

// Comments attach to anything; attribution rides the session env (me()).
// A comment is something you WROTE — there is no door here for marking it
// as machinery, because a caller who has one uses it to stay off the mail
// relay and files their own letter as emitted (T-7018).
let comment = async (got: Got) => {
  let verdict = got.opts['--verdict']
  // A comment body is a DOCUMENT, exactly like a task body — so it rides the
  // The parser reads the body by preference (.body=/--body= through inflate —
  // @- heredoc, @file — else trailing words, keeping the bare single-@token
  // back-compat). One reader keeps every body spelling on the same door.
  let id = got.args.id, body = got.body
  if (!id || (!body && !verdict)) {
    throw new Error('task comment <id> [text...] [--verdict=...]')
  }
  // The target by address, and the caller's own session row by its unique
  // id — the two rows commentChanges reads (taskActor off the target,
  // sessionFor off the session). sessionFor mints the session only when
  // sessionRow returns undefined, which is genuine absence and never a
  // dropped read, so first-sight reification stays exact off a keyed pair.
  let row = await needed(id)
  let sid = me()
  let sess = sid ? await sessionRow(sid) : undefined
  let made = commentChanges(
    [row, ...(sess ? [sess] : [])],
    row.eid,
    body ?? '',
    sid,
    { verdict },
  )
  await send(made)
  // Hand back the comment's OWN id, like every other mint door. Without it a
  // writer has no reference to what it just wrote, so the only reachable way
  // to fix a wrong comment is another comment — which is why the board fills
  // with corrections instead of corrected text (`task set C-13 .body=…`).
  let mine = made.find((c) => c.name == 'comment')!.eid
  let said = verdict ? `${verdict} review` : 'comment'
  print(
    `${await minted(mine)} — ${said} on ${idOf(row)}`,
  )
}

let show = async (got: Got) => {
  let json = got.flags.has('--json') || got.opts['--format'] == 'json'
  let quarantined = got.flags.has('--quarantined')
  let id = got.args.id
  if (!id) throw new Error('task show <id> [--json]')
  // The reading neighborhood, not the whole graph: `show` names one entity's
  // edges and comments, so it fetches one entity's set (client.ts around) —
  // keyed reads, not a 31 MB /snapshot. A miss falls to needed(), whose error
  // path is the only place the graph is worth pulling (for "did you mean?").
  let found = await around(id, quarantined)
  if (!found) return void await needed(id)
  let { deps, all, row } = found
  let snap = { deps }
  if (json) {
    // Edges and comments surround the same entity shape every list door uses.
    let comments = all.filter((r) => r.comps.comment?.target == row.eid)
    let edges = edgesOf(snap, all, row.eid)
    print(jsonText({
      ...jsonAuthored(all, row),
      ...edges,
      comments: comments.map((r) => jsonOf(r)),
    }))
  } else print(showMd(snap, all, row))
}

// The entity's write history — the journal, one line per touching batch:
// when · who · what changed. Blame without a version table.
let past = async (got: Got) => {
  let json = got.flags.has('--json') || got.flags.has('--verbose')
  let n = Number(got.opts['-n'])
  let id = got.args.id
  if (!id) throw new Error('task history <id> [-n N]')
  let row = await needed(id)
  let entries = await history(row.eid, n)
  if (json) return print(jsonText(entries))
  if (!entries.length) return print(`${idOf(row)}: no history`)
  for (let e of entries) print(historyLine(e))
}

// Reverse a journaled batch — the graph's --ff-only undo. `task undo #123`
// names a batch (the #id from `task history`); `task undo T-5` reverses that
// entity's latest batch. The server builds the guarded inverse and refuses
// loudly — a moved column, or a deleted entity that can't be resurrected —
// rather than clobbering. The undo is itself journaled, so undoing it is a redo.
let unwind = async (got: Got) => {
  let id = got.args.id
  if (!id) throw new Error('task undo <#batch | entity>')
  let m = id.match(/^#?(\d+)$/)
  let ref = m ? { id: Number(m[1]) } : { eid: (await needed(id)).eid }
  let changes = await undo(ref)
  // The user-facing effect, minus the provenance the server re-derives.
  let noise = new Set(['created', 'updated', 'resume', 'imported'])
  let what = changes.filter((c) => !noise.has(c.name)).map((c) =>
    c.comp == null
      ? c.name == 'entity' ? '†' : `-${c.name}`
      : `${c.name}{${Object.keys(c.comp).filter((k) => k != 'eid').join(' ')}}`
  ).join(' · ')
  print(`undid ${m ? `#${m[1]}` : id}${what ? ` · ${what}` : ''}`)
}

// A session's WHOLE log as a clean, ordered transcript — the dump you want
// first when debugging one. Reads the session's graph entry partition through
// the graph query door (T-16798 — the /logs door is gone), renders through the
// shared log_text formatter, and screens with --prose / --seq / since / until.
// Pages by --after (a seq cursor) + --limit; default is the whole log.
let sessionLog = async (id: string) => {
  if (!id) {
    throw new Error('session id required')
  }
  let row = await needed(id)
  if (!row.comps.session) throw new Error(`not a session: ${idOf(row)}`)
  // graphLog must see the WHOLE partition to resolve call↔result and derive
  // busy/latest/model; each reader bounds only the rendered output.
  let hits = await query([`.entry.session=${row.eid}`], { limit: 1_000_000 })
  let log = graphLog(hits.flatMap((r) => {
    let seq = Number(r.comps.entry?.seq ?? 0)
    return seq ? [{ eid: r.eid, seq, comps: r.comps as EntryRow['comps'] }] : []
  }))
  return { row, log }
}

let transcript = async (got: Got) => {
  let json = got.flags.has('--json')
  let id = got.args.id
  if (!id) {
    throw new Error(
      'task transcript <S> [--prose] [--seq A..B] [--after N] [--limit N]',
    )
  }
  let { row, log } = await sessionLog(id)
  let after = got.opts['--after'] ? Number(got.opts['--after']) : undefined
  let limit = got.opts['--limit'] ? Number(got.opts['--limit']) : undefined
  let entries = pageEntries(log.entries, { after, limit })
  let sift: Sift = {
    ...(got.flags.has('--prose') ? { prose: true } : {}),
    ...(got.opts['--seq'] ? seqRange(got.opts['--seq']) : {}),
    ...(got.opts['--since'] ? { since: got.opts['--since'] } : {}),
    ...(got.opts['--until'] ? { until: got.opts['--until'] } : {}),
  }
  let s = row.comps.session
  if (json) {
    return print(jsonText({
      latest: log.latest,
      model: log.model,
      busy: log.busy,
      lines: transcribe(entries, sift),
    }))
  }
  print(
    [
      `${idOf(row)} ${log.busy ? 'running' : s.status ?? 'idle'}`,
      `${s.provider ?? '?'} ${log.model ?? s.serving_model ?? s.model ?? ''}`
        .trim(),
      `seq ${log.latest || s.latest_seq || 0}`,
    ].join(' · '),
  )
  for (let line of transcribe(entries, sift)) print(line)
}

// The shell spelling of session_peek: a bounded glance, not a second log
// source. --lines survives as compatibility with the established CLI reach.
let sessionPeek = async (got: Got) => {
  let id = got.args.id
  if (!id) throw new Error('task session peek <S> [--lines N]')
  let { row, log } = await sessionLog(id)
  let n = Math.min(Math.max(Number(got.opts['--lines'] ?? 20), 1), 500)
  let s = row.comps.session!
  print(
    [
      `${idOf(row)} ${log.busy ? 'running' : s.status ?? 'idle'}`,
      `${s.provider ?? '?'} ${log.model ?? s.serving_model ?? s.model ?? ''}`
        .trim(),
      `seq ${log.latest || s.latest_seq || 0}`,
    ].join(' · '),
  )
  for (let entry of pageEntries(log.entries, { tail: n })) {
    let line = renderEntry(entry, 200)
    if (line != null) print(line)
  }
  if (s.stderr) print(`stderr:\n${s.stderr}`)
}

// The injection loop's front door. Plain: print the digest for a session
// id. --hook: SessionStart mode — session_id arrives as hook JSON on
// stdin, and NOTHING may fail loudly (a hook must never wedge a session;
// no server just means no context today).
// The serving model, read from a Claude Code transcript's tail — the
// newest assistant event names it. Absent file, empty file, or foreign
// shape all mean "don't know": announce nothing.
let modelOf = (path: string) => {
  try {
    if (!path) return
    let lines = Deno.readTextFileSync(path).trim().split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"model"')) continue
      let m = (JSON.parse(lines[i]) as {
        message?: { model?: unknown }
      }).message?.model
      if (typeof m == 'string' && m) return m
    }
  } catch { /* no transcript is no announcement */ }
}

// The launcher names the hook dialect; payload fields are provider-owned and
// may converge over time (Claude 2.1.220 started carrying `model`, which used
// to distinguish Codex). Older invocation configs can still recover from the
// live process ancestry, with the payload spelling only a final compatibility
// fallback.
export let hookDialect = (
  body: Record<string, unknown>,
  bound?: Provider,
) => {
  let announced = String(body.model ?? '')
  let transcript = String(body.transcript_path ?? '') || undefined
  let transcriptModel = modelOf(transcript ?? '')
  let hint = announced || transcriptModel || ''
  let provider = bound ??
    (!hint || /^claude(?:-|$)/i.test(hint) ? 'claude' : 'codex')
  return {
    provider,
    model: provider == 'claude'
      ? transcriptModel || announced || undefined
      : announced || transcriptModel,
    transcript,
  }
}

// Invocation config is authoritative. Old configs did not set it, so choose
// the nearest provider in this hook process's ancestry. If one provider is
// nested under another (a Codex tool inside Claude, for example), the inner
// process owns the hook.
export let hookProvider = (
  named = Deno.env.get('TASKS_PROVIDER'),
  find = agentPid,
  under = descends,
): Provider | undefined => {
  if (named == 'claude' || named == 'codex') return named
  let claude = find('claude')
  let codex = find('codex')
  if (claude && codex) return under(codex, claude) ? 'codex' : 'claude'
  return codex ? 'codex' : claude ? 'claude' : undefined
}

// The session's closing words from either provider's transcript. The
// operator already wrote its own summary — wrap captures it as the
// session brief instead of asking anyone to retell.
export let finalText = (path: string) => {
  try {
    if (!path) return
    let lines = Deno.readTextFileSync(path).trim().split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes('"agent_message"')) {
        let e = JSON.parse(lines[i]) as {
          type?: unknown
          payload?: { type?: unknown; message?: unknown; phase?: unknown }
        }
        if (
          e.type == 'event_msg' && e.payload?.type == 'agent_message' &&
          e.payload.phase == 'final_answer' &&
          typeof e.payload.message == 'string'
        ) {
          return e.payload.message
        }
      }
      if (!lines[i].includes('"assistant"')) continue
      let m = JSON.parse(lines[i]) as {
        type?: unknown
        message?: { content?: { type?: unknown; text?: unknown }[] }
      }
      if (m.type != 'assistant') continue
      let text = (m.message?.content ?? [])
        .filter((c) => c.type == 'text' && typeof c.text == 'string')
        .map((c) => String(c.text).trim())
        .filter(Boolean)
        .join('\n\n')
      if (text) return text
    }
  } catch { /* no transcript is no brief */ }
}

// Subagent mode's output: a delegated Task-tool child is NOT the operator
// loop, so it triages nothing — no mail, no pulse, no fleet, no bus sweep.
// It sees ONLY its own task (the managed TASKS_TASK, else whatever its
// reified session already claims), rendered by the shared taskBlock so the
// door reads identically to the operator digest's "claimed by you". No task
// = a one-line identity note, nothing else.
export let subagentDigest = (
  snap: Snapshot,
  sid: string,
  agentType?: string,
) => {
  let all = rows(snap)
  let sess = all.find((r) =>
    r.comps.session && String(r.comps.session.id) == sid
  )
  let want = Deno.env.get('TASKS_TASK')
  let task = want ? find(all, want) : undefined
  if (!task && sess) {
    task = all.find((r) => r.comps.claim?.session == sess.eid)
  }
  let head = `# subagent${agentType ? ` ${agentType}` : ''} · ${sid}`
  return task ? taskBlock(all, snap.deps, task).join('\n') : head
}

// Operator capability belongs to the provider tree launched by `task
// <provider> --operator`, not every terminal on the box. A provider shim may
// sit between the launcher and agent, so the marker names an ancestor.
export let operatorHook = (
  pid = agentPid('claude'),
  get = (name: string) => Deno.env.get(name),
  under = descends,
) => {
  let marker = Number(get('TASKS_OPERATOR'))
  return !!marker && !!pid && under(pid, marker)
}

export let hookTurn = (body: Record<string, unknown>) =>
  body.hook_event_name == 'UserPromptSubmit'
    ? 'busy'
    : body.hook_event_name == 'Stop'
    ? 'idle'
    : undefined

// TASKS_ROLE is an invocation coordinate, not an authority claim. Bind it
// only when the referenced entity still carries the role component; stale or
// hand-written values leave an ordinary graph session.
export let roleEid = (all: Row[], id?: string) => {
  let role = id ? find(all, id) : undefined
  return role?.comps.role ? role.eid : undefined
}

// Agent attention has one explicit door: context. Ordinary CLI verbs do not
// append an implicit inbox sidecar or mutate human read-state.
let heard = (_hook = false) => Promise.resolve()

// A graph-declared role already names the capability the daemon launched;
// the ancestry marker is the equivalent opt-in for an ad-hoc terminal.
export let hookOperator = (role?: string, pid?: number) =>
  !!role || operatorHook(pid)

// A provider pid has one current conversation. clear/compact/resume are the
// provider's explicit handoff signals; they transfer the seat in one batch.
// Anything else trying to add a different sid is a second writer, so the hook
// refuses it before sessionFor can mint an operator row. Process birth screens
// old rows left behind by numeric pid reuse.
export let hookSession = (
  all: Row[],
  sid: string,
  cwd: string | undefined,
  pid: number | undefined,
  self: NonNullable<Parameters<typeof sessionFor>[4]>,
  born = pid ? processBornAt(pid) : undefined,
) => {
  let worn = pid
    ? all.filter((r) => {
      let s = r.comps.session
      if (!s || s.pid != pid || String(s.id) == sid) return false
      let made = Date.parse(String(r.comps.created?.at ?? ''))
      return !born || Number.isNaN(made) || made >= born
    })
    : []
  let rotate = ['clear', 'compact', 'resume'].includes(self.source ?? '')
  if (worn.length && !rotate) return
  let session = sessionFor(all, sid, cwd, pid, self)
  return {
    eid: session.eid,
    changes: [
      ...worn.map((r): Change => ({
        eid: r.eid,
        name: 'session',
        comp: { pid: null },
      })),
      ...session.changes,
    ],
  }
}

let context = async (input: Got) => {
  let hook = input.flags.has('--hook')
  // Subagent mode is DECLARED, never sniffed: explicit --subagent, or the
  // payload's SubagentStart event (which carries the child's own agent_id).
  // The hook branch confirms the event from stdin below; SessionStart
  // reifies a normal graph participant.
  let sub = input.flags.has('--subagent')
  let sid = input.args.sid ?? me()
  let read = (
    session?: string,
    cwd = Deno.cwd(),
    named: string[] = [],
  ) =>
    contextSnapshot(
      session,
      cwd,
      undefined,
      [
        ...named,
        Deno.env.get('TASKS_TASK'),
        Deno.env.get('TASKS_ROLE'),
      ].filter(Boolean) as string[],
    )
  // The digest plus the agent's current addressed work. Reading it records no
  // human inbox state; the resulting entry is the durable attention trace. A
  // reified session's own meta leads as frontmatter (T-4554) — the S-num is
  // how the agent addresses its own session doc.
  let tell = async (snap: Snapshot, sid: string, scope?: string) => {
    let fm = sessionMeta(rows(snap), sid)
    let out = contextDigest(snap, sid, Date.now(), scope)
    if (fm) out = `${fm}\n${out}`
    let n = await bus(sid)
    if (n.lines.length) out += noticeBlock(n.lines)
    print(out)
  }
  if (hook) {
    try {
      let body = JSON.parse(await new Response(Deno.stdin.readable).text())
      // A DELEGATED agent shares the operator's inherited session id but is
      // its own context in its own worktree, so me() yielded that worktree id
      // (client.ts). When it differs from the id this hook was told about,
      // reify a CHILD of the operator rather than a second writer on the
      // operator's row: its own cwd and claims, a parent edge for lineage, no
      // operator capability, and no pid — it rides the operator's process, so
      // the graph comms bus is its channel, not a native push. Its digest is
      // the lone task block; a delegated agent triages nothing. This runs
      // ahead of the SubagentStart branch so the reified id always equals the
      // one me() returns for every later claim, wrap and land.
      let inherited = String(body.session_id ?? '') ||
        Deno.env.get('CLAUDE_CODE_SESSION_ID') || ''
      if (
        sid && sid != inherited &&
        Deno.env.get('CLAUDE_CODE_CHILD_SESSION') == '1'
      ) {
        let cwd = String(body.cwd ?? '') || Deno.cwd()
        let snap = await read(sid, cwd, [inherited])
        let all = rows(snap)
        let parent = await sessionRow(inherited)
        if (parent) all.push(parent)
        let agentType = String(body.agent_type ?? '') || undefined
        let s = sessionFor(all, sid, cwd, undefined, {
          agent_type: agentType,
          source: String(body.source ?? '') || undefined,
          parent: parent?.eid,
          operator: false,
        })
        if (s.changes.length) {
          await send(s.changes)
          snap = await read(sid, cwd, [inherited])
        }
        let hc = hookClaim(rows(snap), Deno.env.get('TASKS_TASK'), sid, cwd)
        if (hc.length) {
          await send(hc)
          snap = await read(sid, cwd, [inherited])
        }
        print(subagentDigest(snap, sid, agentType))
        return
      }
      // The payload disambiguates the two hooks wired to this one line:
      // SubagentStart → subagent mode; SessionStart (anything else) →
      // the external-session gate below.
      if (sub || body.hook_event_name == 'SubagentStart') {
        // Reify the CHILD under its OWN id — `agent_id`, the subagent's
        // unique key (its `session_id` is the PARENT operator's). Its own
        // id means its own bus cursor, so a subagent can never drain the
        // operator's unseen comments. Then emit its lone task block, if any.
        let subId = String(body.agent_id ?? body.session_id ?? '')
        if (!subId) return
        let cwd = String(body.cwd ?? '') || undefined
        let snap = await read(subId, cwd)
        let agentType = String(body.agent_type ?? '') || undefined
        let s = sessionFor(rows(snap), subId, cwd, undefined, {
          agent_type: agentType,
          source: String(body.source ?? '') || undefined,
        })
        if (s.changes.length) {
          await send(s.changes)
          snap = await read(subId, cwd) // the block should see the reify
        }
        print(subagentDigest(snap, subId, agentType))
        return
      }
      sid ??= String(body.session_id ?? '')
      if (!sid) return
      // The generated hook names its provider; old configs recover it from
      // process ancestry. Payload model fields are metadata, never identity.
      let { model, provider, transcript } = hookDialect(body, hookProvider())
      let cwd = String(body.cwd ?? '') || undefined
      let snap = await read(sid, cwd)
      let all = rows(snap)
      let prior = all.find((r) =>
        r.comps.session && String(r.comps.session.id) == sid
      )
      let role = roleEid(all, Deno.env.get('TASKS_ROLE'))
      let pid = agentPid(provider)
      // The digest snapshot is intentionally bounded and owes no complete
      // session roster. PID ownership is its own indexed question; without
      // this read the guard sees an arbitrary subset and a collision can mint.
      if (pid) {
        all.push(...await query(['.kind=session', `.session.pid=${pid}`]))
      }
      let external = prior?.comps.session?.origin != 'managed'
      let operator = external && hookOperator(role, pid)
      let source = String(body.source ?? '') || undefined
      // The provider's transcript is the external session's durable log.
      // `provider` stays out of this CREATE: a new session carrying one is
      // a managed spawn request. It lands as a patch below.
      let s = hookSession(
        all,
        sid,
        cwd,
        pid,
        {
          agent_type: String(body.agent_type ?? '') || undefined,
          source,
          transcript,
          pane: external
            ? Deno.env.get('TMUX_PANE')?.trim() || null
            : undefined,
          // Project-wide attention is the one positive capability. Every
          // session gets the normal graph digest and direct notifications.
          operator: external ? operator : undefined,
          role: role,
        },
      )
      if (!s) return
      if (s.changes.length) await send(s.changes)
      // Announce the provider after the create so this external session
      // cannot be mistaken for a spawn request.
      if (model) {
        await send([{
          eid: s.eid,
          name: 'session',
          comp: { provider, model },
        }])
      }
      // The session's actor is no longer announced here: apply() stamps it
      // from the reify batch's cwd (cwd → repo → project, falling back to
      // the box owner) — for a SESSION that means the OPERATOR, never a
      // watching person, and never blank (T-6669). One home, every door.
      // A managed spawn boots already holding its lease: the launcher
      // passes TASKS_TASK, and an unclaimed task claims quietly here —
      // no prompt discipline required. A held lease stays held (the
      // server would bounce a steal anyway); the digest names the holder.
      let hc = hookClaim(rows(snap), Deno.env.get('TASKS_TASK'), sid, cwd)
      if (hc.length) await send(hc)
      // One fresh read after the writes: the digest — and its frontmatter,
      // which needs the row a first boot just reified — sees this very boot.
      if (s.changes.length || model || hc.length) snap = await read(sid, cwd)
      // The cwd names the scope directly — the reified session row may
      // not have landed in this snap yet.
      await tell(snap, sid, repoAt(rows(snap), cwd)?.eid)
    } catch (e) {
      // Never fail LOUDLY (offline server or malformed stdin must not break
      // the session — stdout stays clean, exit stays 0), but never fail
      // INVISIBLY either: a real defect like a 400 boot-bricked every wake
      // unseen (T-19393). Warn to stderr so --debug and wrapper logs show it.
      warn(`task context (hook): ${(e as Error).message}`)
    }
    return
  }
  // `task context --subagent`: the task block only, no reify (no payload
  // here) and no digest. This used to fire on CLAUDE_CODE_CHILD_SESSION too,
  // but that variable is set in an OPERATOR's own Bash — so the branch caught
  // every shelled `task context` and returned before the bus was ever served,
  // which is why a comment on a claimed task never reached its holder
  // (T-9394). A subagent is told what it is; it is not guessed from the
  // environment.
  if (sub && sid) {
    let snap = await read(sid)
    let sess = rows(snap).find((r) =>
      r.comps.session && String(r.comps.session.id) == sid
    )
    let agentType = sess?.comps.session?.agent_type
    return print(
      subagentDigest(snap, sid, agentType ? String(agentType) : undefined),
    )
  }
  // Bare = the preview: what a fresh session would boot with, scoped to
  // the repo you stand in — or to a named project (task context P-20).
  // Read-only — no session is reified, no bus cursor moves.
  let named = sid ? await got(sid) : undefined
  if (named?.comps.project) {
    let snap = await contextSnapshot(undefined, Deno.cwd(), named.eid, [
      named.eid,
    ])
    return print(contextDigest(snap, undefined, Date.now(), named.eid))
  }
  if (!sid) {
    let snap = await read()
    let all = rows(snap)
    let at = repoAt(all, Deno.cwd())
    return print(contextDigest(snap, undefined, Date.now(), at?.eid))
  }
  // S-12 (or its eid) names the session ENTITY; the id string inside it
  // is the identity every tool speaks. Anything else that resolves is a
  // mistake — and a ref-shaped miss (T-99) is a typo, never a new
  // session's name.
  if (named?.comps.session) {
    let snap = await read(String(named.comps.session.id))
    return await tell(snap, String(named.comps.session.id))
  }
  if (named) throw new Error(`${sid} is a ${named.kind}, not a session`)
  if (/^[A-Za-z]+-\d+$/.test(sid)) throw new Error(`no entity: ${sid}`)
  let snap = await read(sid)
  let all = rows(snap)
  // A raw sid REIFIES (T-4554): a hand-made session — codex, a foreign
  // harness — gets its entity and digest without simulating the hook's
  // JSON. An existing session stays a pure read: refreshing cwd/pid from
  // whoever happens to preview it would corrupt the row.
  if (!all.some((r) => r.comps.session && String(r.comps.session.id) == sid)) {
    // The pid is THIS process's claude, so it may only be stamped when the
    // sid names THIS process's conversation — and that equality is the whole
    // test. A child minting its own id fails it (its CLAUDE_CODE_SESSION_ID
    // is the operator's), so it can never hang a second row on the operator's
    // process, and a pid with two rows stays impossible (T-7279, T-7288).
    let own = Deno.env.get('CLAUDE_CODE_SESSION_ID') == sid
    let role = roleEid(all, Deno.env.get('TASKS_ROLE'))
    let s = sessionFor(
      all,
      sid,
      Deno.cwd(),
      own ? claudePid() : undefined,
      { role: role },
    )
    await send(s.changes)
    snap = await read(sid)
  }
  await tell(snap, sid)
}

// Turn hooks say when a native composer is safe to address. The state is a
// hint about this session's own terminal, so a hook may write it like pid and
// pane; the delivery adapter still revalidates all three before touching tmux.
let sessionTurn = async (got: Got) => {
  let hook = got.flags.has('--hook')
  try {
    let body: Record<string, unknown> = {}
    if (hook) {
      body = JSON.parse(await new Response(Deno.stdin.readable).text())
    }
    let turn = hook ? hookTurn(body) : got.args['idle|busy']
    let sid = String(body.session_id ?? '') ||
      got.args.sid ||
      me()
    if (!sid || !turn) {
      if (hook) return
      throw new Error('task session turn <idle|busy> [sid]')
    }
    // The narrowest read in the CLI, because this is its hottest caller: one
    // hook per prompt and per stop of every session in the fleet, inside a 3 s
    // timeout. `session.id` is uniquely indexed, so asking the index costs 3ms
    // where the whole-graph snapshot this used to open with cost 28 MB and
    // ~0.6s to answer the same one-row question.
    // The predicate that used to screen every row still decides: a filter
    // grammar reading the id as a list or a range would hand back somebody
    // else's session, and this verb WRITES. And a refused query throws
    // (client.ts query()) rather than answering empty, so a narrow miss is a
    // skipped update — the one thing this path may safely do.
    let sess = (await query([`.session.id=${sid}`]))
      .find((r) => r.comps.session && String(r.comps.session.id) == sid)
    if (!sess || sess.comps.session.turn == turn) return
    await send([{
      eid: sess.eid,
      name: 'session',
      comp: { turn },
    }])
    if (!hook) print(`${idOf(sess)} turn ${turn}`)
  } catch (e) {
    if (!hook) throw e
  }
}

// Record a design: doc + design tag + the `proposed` mark, stamped via the
// calling session. The one door that mints a plain doc — `task new` is
// doc + task and always was, so before this the only way to write a design
// into the graph was a raw batch, and the file stayed the warm path.
let design = async (got: Got) => {
  let title = got.args.title?.trim()
  if (!title) throw new Error('task design <title...> (what it proposes)')
  let session = me()
  if (!session) throw new Error('design: no session identity (attribution)')
  let body = got.body
  // The standard property grammar, same path `task new` routes through
  // (M-15635): `.project=`/`.priority=` and friends set props on the design.
  let props = patches(await derefedParams(got.params))
  let sess = await sessionRow(session)
  let made = designChanges(sess ? [sess] : [], { title, body, session, props })
  await send(made.changes)
  print(`${await minted(made.eid)} proposed`)
  let hint = await similarHint(`${title}\n${body ?? ''}`, made.eid)
  if (hint) print(hint)
}

// Mint a venture's dream: the consolidation cursor and its first cadence wake
// (client.ts dreamChanges). This is how a venture opts into the graph-native
// dream cycle — the wake fires shortly, its knock hooks dreamComb, and the
// dream self-arms from there. Idempotent per venture (a second is refused).
let dream = async (input: Got) => {
  let ref = input.args.project
  if (!ref) {
    throw new Error('task dream <project> (the venture to consolidate)')
  }
  let project = await got(ref)
  if (!project?.comps.project) throw new Error(`not a project: ${ref}`)
  let made = dreamChanges([project, ...await query(['.kind=dream'])], {
    project: project.eid,
  })
  await send(made.changes)
  print(
    `${await minted(made.eid)} dreaming ${idOf(project)} — first comb shortly`,
  )
}

// Save a memory: doc + memory comp, stamped via the calling session — the
// CLI face of MCP memory_save, so headless agents (the scribe first) have
// the door too.
let remember = async (got: Got) => {
  let title = got.args.title?.trim()
  if (!title) throw new Error('task remember <title...> (the index line)')
  let session = me()
  if (!session) throw new Error('remember: no session identity (attribution)')
  let body = got.body
  // A heredoc piped without the `.body=@-` door used to vanish, minting a
  // title-only memory with exit 0 (M-14370). We cannot read it here — an
  // implicit slurp of an inherited open pipe is the T-5854 hang — so refuse
  // the unread pipe and name the door. `body == null` is "no body door at
  // all"; an explicit `.body=` (empty string) is a deliberate title-only
  // memory from a non-tty context and passes through.
  if (body == null && unreadPipe()) {
    throw new Error(
      'task remember: stdin is a pipe no body door read — pass the lesson ' +
        'with .body=@- (a heredoc/file), or .body= for a title-only memory',
    )
  }
  let [sess, refs] = await Promise.all([
    sessionRow(session),
    fetched(
      [got.opts['--scope'], got.opts['--feedback']].filter(Boolean),
    ),
  ])
  let all = [...(sess ? [sess] : []), ...refs]
  // --type is retired (T-12585); manual.ts `retired` refuses it upstream of
  // here with the replacement named, so nothing silently drops it.
  let made = memoryChanges(all, {
    title,
    body,
    scope: got.opts['--scope'],
    feedback: got.opts['--feedback'],
    session,
  })
  await send(made.changes)
  print(`${await minted(made.eid)} remembered`)
  let hint = await similarHint(`${title}\n${body ?? ''}`, made.eid)
  if (hint) print(hint)
}

// SessionEnd's mirror of context: drop everything the session holds.
// --hook mode (stdin JSON, silent failure) wires it to the lifecycle.
let wrap = async (got: Got) => {
  let hook = got.flags.has('--hook')
  let sid = got.args.sid ?? me()
  try {
    // Hook stdin always gets read: even when the env names the session,
    // the payload carries the transcript whose last assistant turn IS the
    // brief (continuity is self-authored — T-4469).
    let final: string | undefined
    if (hook) {
      try {
        let body = JSON.parse(await new Response(Deno.stdin.readable).text())
        sid ??= String(body.session_id ?? '')
        final = finalText(String(body.transcript_path ?? ''))
      } catch { /* a bad payload costs the brief, never the wrap */ }
    }
    if (!sid) {
      if (hook) return
      throw new Error('task wrap <session> (or run under a session)')
    }
    // The ledger is a bonus, never a blocker: a journal fetch that fails
    // still wraps the session cleanly, just without its day retold.
    let entries: JournalEntry[] = []
    try {
      entries = await historyBy(sid)
    } catch { /* no journal, no ledger */ }
    let sess = await sessionRow(sid)
    let all = sess
      ? [
        sess,
        ...await query([`.claim.session=${sess.eid}`]),
        ...await query(['.comment!', `.created.via=${sess.eid}`]),
        ...await journalRows(entries),
      ]
      : []
    let changes = wrapChanges(
      all,
      sid,
      Date.now(),
      entries,
      final,
    )
    if (changes.length) await send(changes)
    if (!hook) {
      print(
        `released ${changes.filter((c) => c.name == 'claim').length} claim(s)`,
      )
    }
  } catch (e) {
    if (!hook) throw e
    // hooks never fail loudly — a dead server just means no wrap today
  }
}

// The self-authored brief (T-4554, D-19459): show or write YOUR session's
// `brief` component — the first-class handoff the next digest quotes IN FULL
// as `## previously`. It is NOT the session doc: doc.body stays free for the
// scribe's narrative. Body doors match mail's: trailing words, --body=@file,
// --body=- or @- (piped stdin); no body is the read door.
let sessionBrief = async (got: Got) => {
  let sid = me()
  if (!sid) throw new Error('session brief: run under a session (no identity)')
  let sess = await sessionRow(sid)
  if (!sess) {
    throw new Error(`no session entity for ${sid} — task session context first`)
  }
  let body = got.body
  if (body == null) {
    let current = String(sess.comps.brief?.text ?? '')
    return print(current || `${idOf(sess)} has no brief`)
  }
  if (!body) {
    throw new Error(
      'a brief needs words: text, @file, or --body=@file|-|@-',
    )
  }
  await send([{ eid: sess.eid, name: 'brief', comp: { text: body } }])
  print(`${idOf(sess)} brief written`)
}

// Session-lifecycle verbs live here — root `task context` / `task wrap`
// stay as quiet aliases: hook lines in the wild call them (T-4554).
let session = (got: Got) => {
  let sub = got.args.command
  if (!sub) {
    return print(help(['session']))
  }
  throw new Error(`not a session verb: ${sub}\n\n${help(['session'])}`)
}

// The main checkout behind whatever worktree we stand in: removing a
// worktree and deleting its branch are the repo's acts, not the copy's.
let repoRoot = () => {
  let out = new Deno.Command('git', {
    args: ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    stderr: 'null',
  }).outputSync()
  if (!out.success) return undefined
  return new TextDecoder().decode(out.stdout).trim().replace(/\/\.git\/?$/, '')
}

// What the fleet left running: probes whose session is gone, and worktrees
// with nothing left in them. Listing is the default because the acting form
// is destructive — read the reasons, THEN pass --reap.
let probes = async (got: Got) => {
  let mins = Number(got.opts['--grace'])
  let repo = repoRoot()
  let all = await query(['.kind=session'])
  let seen = sweep(
    sessionsOf(all),
    repo,
    Number.isFinite(mins) ? mins * 60_000 : undefined,
  )
  let age = (born: number) =>
    `${Math.round((Date.now() - born) / 60_000)}m`.padStart(6)
  let doomed = seen.verdicts.filter((v) => v.reap)
  let stale = seen.trees.filter((t) => t.prune)
  for (let v of doomed) {
    print(
      `orphan  ${String(v.proc.pid).padStart(8)} ${age(v.proc.born)}  ${v.why}`,
    )
  }
  for (let t of stale) print(`tree    ${t.tree.path}  ${t.why}`)
  if (got.flags.has('--all')) {
    for (let v of seen.verdicts.filter((v) => !v.reap && v.proc.cwd)) {
      print(
        `spared  ${String(v.proc.pid).padStart(8)} ${
          age(v.proc.born)
        }  ${v.proc.comm}: ${v.why}`,
      )
    }
    for (let t of seen.trees.filter((t) => !t.prune)) {
      print(`kept    ${t.tree.path}  ${t.why}`)
    }
  }
  if (!got.flags.has('--reap')) {
    warn(
      `${doomed.length} orphan(s), ${stale.length} stale worktree(s)`,
    )
    return
  }
  let { killed, leaked } = await reap(seen.verdicts)
  let pruned = repo ? stale.filter((t) => prune(repo, t.tree)) : []
  for (let dir of leaked) warn(`profile not removed — ${dir}`)
  warn(
    `reaped ${killed.length} process(es), ${pruned.length} worktree(s)` +
      (leaked.length ? `, ${leaked.length} profile(s) leaked` : ''),
  )
}

// What the tools have been doing: MCP calls, HTTP writes and browser
// crashes, newest first. --errors is the view you want most days.
let telemetry = async (got: Got) => {
  let q = new URLSearchParams()
  if (got.flags.has('--errors')) q.set('only', 'errors')
  if (got.opts['--since']) q.set('since', got.opts['--since'])
  if (got.flags.has('--stats')) {
    return telemetryStats(q, got.flags.has('--json'))
  }
  if (got.opts['-n']) q.set('limit', got.opts['-n'])
  let res = await request(`http://${host()}/telemetry?${q}`)
  if (!res.ok) throw new Error(`server said ${res.status}`)
  let rows = await res.json() as Log[]
  if (got.flags.has('--json')) return print(jsonText(rows))
  if (!rows.length) return warn('(nothing recorded)')
  for (let r of rows) {
    // A collapsed crash cohort (telemetry.ts recent()): the row IS the newest
    // occurrence, so the leading ts is `last` — name the frequency and how far
    // back the run reaches. Absent on a lone row, so an uncollapsed log reads
    // exactly as before.
    let cohort = r.count && r.count > 1
      ? `  ${r.count}× since ${local(r.first ?? r.ts)}`
      : ''
    print(
      `${local(r.ts)}  ${r.source.padEnd(4)} ${r.name.padEnd(14)} ${
        r.ok ? 'ok ' : 'ERR'
      } ${(r.ms == null ? '' : `${r.ms}ms`).padStart(6)}  ${
        (r.session_id ?? '-').padEnd(10)
      }  ${(r.error ?? '').slice(0, 80)}${cohort}`,
    )
  }
}

// The latency view: p50/p95/p99 per door+tool, computed in SQL server-side
// (telemetry.ts stats()). Busiest group first, milliseconds right-aligned.
let telemetryStats = async (q: URLSearchParams, json: boolean) => {
  q.set('stats', '1')
  let res = await request(`http://${host()}/telemetry?${q}`)
  if (!res.ok) throw new Error(`server said ${res.status}`)
  let rows = await res.json() as Stat[]
  if (json) return print(jsonText(rows))
  if (!rows.length) return warn('(nothing timed)')
  let ms = (n: number) => `${n}ms`.padStart(9)
  print(
    `${'door'.padEnd(4)} ${'tool'.padEnd(14)} ${'n'.padStart(6)} ${
      'p50'.padStart(9)
    } ${'p95'.padStart(9)} ${'p99'.padStart(9)}`,
  )
  for (let r of rows) {
    print(
      `${r.source.padEnd(4)} ${r.name.padEnd(14)} ${String(r.n).padStart(6)} ${
        ms(r.p50)
      } ${ms(r.p95)} ${ms(r.p99)}`,
    )
  }
}

// What agent work cost, and how fast it ran — a READ over usage.ts, which
// projects the token counts already stamped on settled sessions. Filters are
// the one grammar (`.persona=…`, `.finished_at>=today`), screening the sessions
// before the rollup. `--by model|project|persona|task|provider` picks the
// breakdown dimension (model by default); a total always leads. Absent beats
// zero throughout: an unreported facet reads `—`, never 0, and a model with no
// price contributes no cost (the `$` covers `n/total` sessions, and says so).
let usageDims: Dim[] = ['model', 'project', 'persona', 'task', 'provider']

// Project every settled session's usage, attach the project one edge out
// (session → requested_task → task.project), and collect human labels for the
// eids we group by. Shared by the CLI verb and, in spirit, the MCP tool.
let usesFrom = async (hits: Row[]) => {
  let uses: Use[] = []
  for (let r of hits) {
    let s = sessionOf(r.comps)
    let u = s && use(s)
    if (u) uses.push(u)
  }
  let refs = await fetched([
    ...new Set(uses.flatMap((u) => [u.task, u.persona].filter(Boolean))),
  ] as string[])
  let taskRows = refs.filter((r) => r.comps.task)
  let projs = await fetched([
    ...new Set(
      taskRows.map((r) => String(r.comps.task?.project ?? '')).filter(Boolean),
    ),
  ])
  let taskProj = new Map(
    taskRows.map((r) => [r.eid, String(r.comps.task?.project ?? '')]),
  )
  let name = new Map([...refs, ...projs].map((r) => [r.eid, idOf(r)]))
  for (let u of uses) if (u.task) u.project = taskProj.get(u.task) || undefined
  return { uses, label: (k: string) => name.get(k) ?? k }
}

let usageReport = async (got: Got) => {
  let by = (got.opts['--by'] ?? 'model') as Dim
  if (!usageDims.includes(by)) {
    throw new UsageError(`--by must be one of ${usageDims.join(', ')}`)
  }
  await checkedRefs(predicates(got.words))
  let { uses, label } = await usesFrom(
    await query(['.kind=session', ...got.words]),
  )
  if (got.flags.has('--json')) {
    let groups = [...group(uses, (u) => u[by]).entries()].map(([k, us]) => ({
      [by]: label(k),
      roll: roll(us),
      cost: cost(us),
    }))
    return print(jsonText({ total: roll(uses), cost: cost(uses), by, groups }))
  }
  print(report(uses, by, label))
}

// Backup is bin/backup (a data-dir git commit) — the CLI is its front
// door so 'task backup' works wherever the CLI is installed.
// Materialize every persona into its project repo's .tasks/ — write what
// changed, DELETE what the render no longer produces (a deleted or renamed
// persona's stale file), then commit the paths git already tracks (git.ts
// keeps that safe; --no-commit stops at the write, for a look before
// anything lands). --check writes nothing: it reports drift and exits
// non-zero, the gate's guard against a hand-edit to a generated file. The
// server's effect keeps files fresh on graph changes; this verb is the
// explicit door — the first sync of a new repo, or the committed story until
// the permission-gated actuator (T-3926) owns it.
let sync = async (got: Got) => {
  let check = got.flags.has('--check')
  let snap
  try {
    snap = await projectionSnapshot()
  } catch (e) {
    // A dead server can't answer, and a check that can't run must not wedge
    // the gate — skip rather than fail. The normal verb still surfaces it.
    if (check) return print(`sync --check skipped: ${(e as Error).message}`)
    throw e
  }
  let files = projection(rows(snap), snap.deps, Date.now())
  if (check) {
    let drift: string[] = []
    for (let f of files) {
      if (f.body == null) {
        drift.push(`orphan ${f.path}`)
        continue
      }
      let had: string | undefined
      try {
        had = Deno.readTextFileSync(f.path)
      } catch { /* missing */ }
      if (had != f.body) {
        drift.push(`${had == null ? 'missing' : 'stale'} ${f.path}`)
      }
    }
    if (!drift.length) return print('projections in sync')
    for (let d of drift) warn(d)
    warn(`${drift.length} projection(s) drifted — run: task sync`)
    Deno.exit(1)
  }
  if (!files.length) {
    return print('no personas with a homed repo — nothing to write')
  }
  let { written, removed, failed } = syncFiles(files)
  for (let p of written) print(`wrote ${p}`)
  for (let p of removed) print(`removed ${p}`)
  for (let f of failed) warn(`failed ${f}`)
  if (!written.length && !removed.length && !failed.length) print('all fresh')
  if (got.flags.has('--no-commit')) return
  // Every path, not just this run's writes: a file left dirty by an
  // earlier sync (or adopted with `git add` since) lands here too.
  let done = await commit(files, 'personas: materialize')
  for (let root of done.committed) print(`committed ${root}`)
  for (let root of done.pushed) print(`pushed ${root}`)
  for (let p of done.untracked) print(`untracked ${p} — git add to adopt`)
  for (let f of done.failed) warn(`sync failed ${f}`)
}

let backup = async () => {
  let script = new URL('../bin/backup', import.meta.url).pathname
  let { code } = await new Deno.Command(script, {
    stdin: 'null',
    stdout: 'inherit',
    stderr: 'inherit',
  }).output()
  if (code) Deno.exit(code)
}

// An interactive session, fleet-wired: permissions skipped and the tasks
// channel active, so comments on its claimed work and knocks at its door drop
// straight into the running transcript. Direct session comments stay as
// compatibility. Identity is Claude's own session id
// (CLAUDE_CODE_SESSION_ID — /clear rotates it, and the rotation IS the point:
// one S-* per life). The SessionStart hook reifies the entity under it and
// stamps the claude process pid; the channel plugin binds by that pid, so
// service follows each rotation.
let terminal = async (
  command: string,
  args: string[],
  env: Record<string, string> = {},
) => {
  let { code } = await new Deno.Command(command, {
    args,
    env: { TASKS_HOST: host(), ...env },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).output()
  Deno.exit(code)
}

let CHANNEL = 'plugin:tasks@tasks-fleet'

type Provider = 'claude' | 'codex'
type Hook = {
  hooks: {
    type: 'command'
    command: string
    timeout?: number
  }[]
}

let commandHook = (command: string, timeout?: number): Hook => ({
  hooks: [{
    type: 'command',
    command,
    ...(timeout == null ? {} : { timeout }),
  }],
})

let hookCommand = (provider: Provider, verb: string) =>
  `PATH="$HOME/.deno/bin:$PATH" TASKS_PROVIDER=${provider} ` +
  `${verb == 'turn' ? 'task-turn' : `task session ${verb} --hook`} || true`

// TODO(T-3906): replace this compatibility call with Tasks-owned self-clear
// state and gates. Until then, task-launched Claude preserves a project's
// explicit self-clear hook without making bare Claude load it.
let selfClear =
  'if [ -x "${CLAUDE_PROJECT_DIR}/.claude/hooks/self-clear-stop.sh" ]; then ' +
  '"${CLAUDE_PROJECT_DIR}/.claude/hooks/self-clear-stop.sh"; ' +
  'else cat >/dev/null; fi || true'

// Launcher-owned lifecycle config: a bare provider launch remains untouched,
// while `task claude` / `task codex` opt this invocation into graph identity.
export let lifecycleHooks = (provider: Provider): Record<string, Hook[]> => ({
  SessionStart: [commandHook(hookCommand(provider, 'context'))],
  SubagentStart: [commandHook(hookCommand(provider, 'context'))],
  // Turn boundaries are provider-neutral — every adapter owes the graph a
  // busy/idle fact, and "is this session mid-turn?" is what decides whether a
  // parked operator needs waking. The turn stamp leads the Stop array so the
  // cheap fact lands before Claude's self-clear gate spends its 20s; both
  // receive the same payload on their own stdin.
  UserPromptSubmit: [commandHook(hookCommand(provider, 'turn'), 3)],
  Stop: [
    commandHook(hookCommand(provider, 'turn'), 3),
    ...(provider == 'claude' ? [commandHook(selfClear, 20)] : []),
  ],
  SessionEnd: [commandHook(hookCommand(provider, 'wrap'), 3)],
})

let toml = (value: unknown): string => {
  if (
    typeof value == 'string' || typeof value == 'number' ||
    typeof value == 'boolean'
  ) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(toml).join(',')}]`
  if (value && typeof value == 'object') {
    return `{ ${
      Object.entries(value).map(([key, item]) => `${key}=${toml(item)}`)
        .join(',')
    } }`
  }
  throw new Error('unsupported hook config')
}

export let codexHookArgs = () =>
  Object.entries(lifecycleHooks('codex')).flatMap(([event, config]) => [
    '-c',
    `hooks.${event}=${toml(config)}`,
  ])

let claudeSettings = (cwd: string): Record<string, unknown> => {
  let path = `${cwd}/.tasks/claude-settings.json`
  try {
    let settings = JSON.parse(Deno.readTextFileSync(path))
    if (!settings || typeof settings != 'object' || Array.isArray(settings)) {
      throw new Error('settings must be an object')
    }
    return settings
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return {}
    throw new Error(`${path}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// A project may add provider settings under `.tasks/`, where they affect only
// `task claude`. Lifecycle arrays append after Tasks' identity hooks.
export let claudeHookSettings = (cwd = Deno.cwd()) => {
  let settings = claudeSettings(cwd)
  let custom = settings.hooks
  if (
    custom != null &&
    (typeof custom != 'object' || Array.isArray(custom))
  ) {
    throw new Error(
      `${cwd}/.tasks/claude-settings.json: hooks must be an object`,
    )
  }
  let hooks: Record<string, unknown[]> = Object.fromEntries(
    Object.entries(lifecycleHooks('claude')).map(([event, entries]) => [
      event,
      [...entries],
    ]),
  )
  for (
    let [event, entries] of Object.entries(
      custom as Record<string, unknown> ?? {},
    )
  ) {
    if (!Array.isArray(entries)) {
      throw new Error(
        `${cwd}/.tasks/claude-settings.json: hooks.${event} must be an array`,
      )
    }
    hooks[event] = [...(hooks[event] ?? []), ...entries]
  }
  return JSON.stringify({ ...settings, hooks })
}

let terminalScope = (got: Got, pid: number) => {
  let operator = got.flags.has('--operator')
  return {
    args: got.words,
    env: {
      TASKS_OPERATOR: operator ? String(pid) : '',
      TASKS_TASK: '',
      CLAUDE_CODE_CHILD_SESSION: '',
    },
  }
}

let claudeLaunchGot = (
  got: Got,
  listed: boolean,
  pid = Deno.pid,
  cwd = Deno.cwd(),
) => {
  let scope = terminalScope(got, pid)
  return {
    args: [
      '--dangerously-skip-permissions',
      '--settings',
      claudeHookSettings(cwd),
      '--channels',
      CHANNEL,
      ...(listed ? [] : ['--dangerously-load-development-channels', CHANNEL]),
      ...scope.args,
    ],
    // A nested interactive launch is a new session, never the caller's managed
    // task or Task-tool child. Empty values actively clear inherited hints.
    env: scope.env,
  }
}

export let claudeLaunch = (
  args: string[],
  listed: boolean,
  pid = Deno.pid,
  cwd = Deno.cwd(),
) => claudeLaunchGot(parse('claude', manuals.claude, args), listed, pid, cwd)

let claude = async (got: Got) => {
  // Allowlisted in root's managed settings → clean launch; otherwise the
  // dev-load flag activates the channel behind a press-Enter dialog —
  // fine at a keyboard, which is the only place this verb runs.
  let listed = false
  try {
    listed = Deno.readTextFileSync('/etc/claude-code/managed-settings.json')
      .includes('"tasks-fleet"')
  } catch { /* no managed settings — dev-load below */ }
  let launch = claudeLaunchGot(got, listed)
  await terminal('claude', launch.args, launch.env)
}

// Full access matches the interactive Claude posture; lifecycle hooks bind
// the provider thread to the graph. An operator also wears the repo's stable
// persona door; every other Codex argument keeps order.
let codexLaunchGot = (
  got: Got,
  pid = Deno.pid,
  cwd = Deno.cwd(),
) => {
  let scope = terminalScope(got, pid)
  return {
    args: [
      '--dangerously-bypass-approvals-and-sandbox',
      '--dangerously-bypass-hook-trust',
      ...codexHookArgs(),
      ...(scope.env.TASKS_OPERATOR
        ? [
          '-c',
          `model_instructions_file=${
            JSON.stringify(`${cwd}/.claude/agents/operator.md`)
          }`,
        ]
        : []),
      ...scope.args,
    ],
    env: scope.env,
  }
}

export let codexLaunch = (
  args: string[],
  pid = Deno.pid,
  cwd = Deno.cwd(),
) => codexLaunchGot(parse('codex', manuals.codex, args), pid, cwd)

export let codexArgs = (args: string[]) => codexLaunch(args).args

let codex = async (got: Got) => {
  let launch = codexLaunchGot(got)
  await terminal('codex', launch.args, launch.env)
}

let tui = async () => {
  // The same be-reborn loop as `deno task tui`, so a global install hot
  // reloads too. The TUI source lives next to this module.
  let main = new URL('./tui/main.tsx', import.meta.url).pathname
  while (true) {
    let { code } = await new Deno.Command(Deno.execPath(), {
      args: ['run', '-A', main],
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    }).output()
    if (code != 42) Deno.exit(code)
  }
}

// Tab-completion for the shell wrappers (bash/zsh). The words after `task`
// arrive past a `--` sentinel the wrapper inserts, so a `--help` mid-line never
// trips the help intercept. The one graph-fed slot — an id positional — is
// filled from a bounded snapshot of the work most likely to be named (open and
// in-progress tasks); a down server just drops the ids, leaving verb, option
// and enum completion offline. One candidate per line, for `compgen -W`.
let openTaskIds = async (): Promise<string[]> => {
  try {
    let hits = await query(['.kind=task', '.status=open,wip'], { limit: 200 })
    return hits.map(idOf)
  } catch {
    return []
  }
}

let completeCmd = async (got: Got) => {
  let words = got.words[0] == '--' ? got.words.slice(1) : got.words
  let ids = await openTaskIds()
  let out = complete(words, () => ids)
  if (out.length) print(out.join('\n'))
}

// The declaration and its handler become one table before anything can route
// to it. Router-only syntax (`subject` and `:`) stays in front of this table;
// every ordinary declaration must have a run or module loading fails loudly.
let bind = (runs: Record<string, Run>): Record<string, Verb> => {
  let routed = Object.keys(manuals).filter((name) =>
    !['subject', ':'].includes(name)
  )
  let missing = routed.filter((name) => !runs[name])
  let unknown = Object.keys(runs).filter((name) => !routed.includes(name))
  if (missing.length || unknown.length) {
    throw new Error(
      `CLI verbs: ${
        [
          missing.length ? `no run: ${missing.join(', ')}` : '',
          unknown.length ? `no declaration: ${unknown.join(', ')}` : '',
        ].filter(Boolean).join('; ')
      }`,
    )
  }
  return Object.fromEntries(
    routed.map((name) => [name, { ...manuals[name], run: runs[name] }]),
  )
}

let backfillRun = (kind: string) => async () => {
  let via = me()
  let res = await request(`http://${host()}/backfill/${kind}`, {
    method: 'POST',
    headers: via ? { 'x-via': via } : undefined,
  })
  if (!res.ok) throw new Error(`backfill failed: ${await res.text()}`)
  let out = await res.json() as { found: number; landed: number }
  console.log(`${kind}: ${out.landed}/${out.found} historical edges landed`)
}

export let verbs = bind({
  tui: () => tui(),
  claude,
  codex,
  list,
  query: list,
  graph_query: list,
  decided,
  docs,
  stale,
  new: create,
  set,
  edit,
  redact,
  show,
  history: past,
  undo: unwind,
  transcript,
  search: seek,
  doctor: () => doctor(),
  mail: () => print(help(['mail'])),
  'mail show': mailShow,
  'mail send': mailSend,
  'mail reply': mailReply,
  'mail search': mailSeek,
  'mail files': mailFiles,
  'mail doctor': () => mailDoctor(),
  backfill: () => print(help(['backfill'])),
  'backfill worked': backfillRun('worked'),
  'backfill referenced': backfillRun('referenced'),
  watch: subscribe('watch'),
  mute: subscribe('mute'),
  inbox: inboxList,
  'inbox show': inboxShow,
  'inbox archive': inboxArchive,
  archive: inboxArchive,
  claim,
  release,
  block,
  unblock,
  delete: del,
  forget: del,
  spawn,
  land: () => land(),
  comment,
  meta: (got) => colon(undefined, ['meta', got.body ?? '']),
  dep,
  backup: () => backup(),
  sync,
  design,
  dream,
  remember,
  session,
  'session context': context,
  'session wrap': wrap,
  'session brief': sessionBrief,
  'session peek': sessionPeek,
  'session turn': sessionTurn,
  role,
  'role stop': (got) => roleState('stop', got),
  'role start': (got) => roleState('start', got),
  'role cycle': roleCycle,
  'role pause': (got) => roleState('pause', got),
  'role resume': (got) => roleState('resume', got),
  'role disable': (got) => roleState('disable', got),
  'role retire': (got) => roleState('retire', got),
  probes,
  telemetry,
  usage: usageReport,
  // The note (what you were mid-doing) rides the body door and folds onto the
  // colon line as `-- <note>`, the same `--` :mail uses for its body.
  wake: (got) =>
    got.flags.has('--gone') ? wakeCancel(got.words) : colon(undefined, [
      'wake',
      ...got.words,
      ...(got.body != null ? ['--', got.body] : []),
    ]),
  help: (got) => print(help(got.words)),
  complete: completeCmd,
  ls: list,
  context,
  wrap,
  create,
  assign,
  add: create,
  rm: del,
  require: requireEdge,
  recall: show,
})

// Only run the CLI when invoked as the program — importing this module (e.g.
// from tests) must not dispatch a command or call Deno.exit.
if (import.meta.main) {
  // Version probes must stay offline: they are commonly used to discover an
  // executable before either the Tasks server or configured plugins exist.
  if (Deno.args[0] == '--version') {
    print(`task ${VERSION}`)
    Deno.exit(0)
  }
  // Load any configured plugins before dispatch, so a plugin's CLI-facing
  // registrars are in place when a verb runs (D-18663 seam 1). Inert by
  // default: no TASKS_PLUGINS means an empty list and no imports.
  await loadPlugins(pluginSpecifiers())
  let [cmd, ...rest] = Deno.args
  try {
    let asked = requestedHelp(Deno.args)
    let hook = false
    if (asked != null) print(asked)
    else if (!cmd) await bare()
    else {
      let routed = listing(cmd, rest) ?? showing(cmd, rest) ??
        subject(cmd, rest)
      if (routed) {
        cmd = routed.cmd
        rest = routed.args
      }
      let selected = route(cmd, rest, verbs)
      if (selected) {
        let got = parse(selected.name, selected.manual, selected.args)
        hook = got.flags.has('--hook')
        // A deprecated verb hard-errors — it points at its replacement and
        // REFUSES to run, because print-and-continue hides a partial run: the
        // `dep` alias forwarded its args wrong and dropped `--gone` silently,
        // so the edge survived while the caller assumed success (T-16375).
        // Exiting non-zero forces the caller onto the current form. stderr,
        // because stdout is what the caller asked for and is usually piped.
        // The gate belongs to the SPELLING, not the handler it lands in:
        // subject-first sentences merely reuse the old verb's code, so
        // `task T-3 requires T-9` — the successor `dep` points at — runs on.
        let spelled = selected.name == 'help' && rest[0] == 'help'
          ? manuals[cmd]
          : selected.manual
        if (spelled.deprecated && !routed) {
          await reportUsage(
            Deno.args,
            `task ${spelled.name}: deprecated — ${spelled.deprecated}`,
          )
          warn(`task ${spelled.name}: deprecated — ${spelled.deprecated}`)
          Deno.exit(1)
        }
        await selected.manual.run(got)
      } else if (cmd.startsWith(':')) {
        validateCommand(cmd.slice(1), rest)
        await colon(undefined, [cmd, ...rest])
      } else if (rest[0]?.startsWith(':')) {
        validateCommand(rest[0].slice(1), rest.slice(1))
        await colon(cmd, rest)
      } else if (
        (cmd == 'wip' || cmd == 'done' || cmd == 'cancel') && idLike(rest[0])
      ) {
        // Explicit-target sugar validates its own args below, not the focused
        // palette command's word count.
        await finishes[cmd](rest)
      } else if (cmd && commands[cmd]) {
        validateCommand(cmd, rest)
        await colon(undefined, [cmd, ...rest])
      } else {
        await reportUsage(Deno.args, `no such verb: ${cmd}`)
        print(usage())
        Deno.exit(2)
      }
    }
    // Whatever the verb did, hand over anything addressed to this session.
    await heard(hook)
  } catch (e) {
    if (e instanceof UsageError) {
      await reportUsage(Deno.args, e.message)
    }
    warn(`task: ${(e as Error).message} (server: ${host()})`)
    Deno.exit(1)
  }
}
