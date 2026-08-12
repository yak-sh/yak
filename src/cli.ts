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
  belongs,
  bornAt,
  bus,
  byBoard,
  checkedRefs,
  claimant,
  claimChanges,
  commentChanges,
  contextDigest,
  contextSnapshot,
  decidedAt,
  derefedChanges,
  derefedParams,
  designChanges,
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
  jsonOf,
  mailAt,
  mailChanges,
  mailLine,
  mailThread,
  me,
  memoryChanges,
  minted,
  needed,
  noticeBlock,
  param,
  patches,
  projectionSnapshot,
  query,
  readerFor,
  readerRows,
  replyChanges,
  repoAt,
  type Row,
  rows,
  scopeFor,
  search,
  send,
  sessionFor,
  sessionMeta,
  sessionRow,
  showMd,
  similarHint,
  spawnChanges,
  spawnDefaults,
  subChanges,
  taskBlock,
  taskChanges,
  unreadMail,
  unreadPipe,
  wrapChanges,
} from './client.ts'
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
import {
  bookOf,
  diagnose,
  liveRules,
  type Rules,
  STATIC_RULES,
} from './doctor.ts'
import {
  type Change,
  type Edge,
  edges,
  kindOrder,
  kindWord,
  plural,
  plurals,
  type Snapshot,
  statuses,
} from './types.ts'
// `import type` (not the repo's usual inline `{ type X }`): telemetry.ts
// reaches for node:sqlite, and the CLI has no business loading a db driver.
import type { Log } from './telemetry.ts'
import type { JournalEntry } from './client.ts'
import { local } from './time.ts'
import { wakeTitle } from './title.ts'
import {
  agentPid,
  bornAt as processBornAt,
  claudePid,
  descends,
} from './proc.ts'
import { projection, syncFiles } from './persona.ts'
import { commit } from './git.ts'
import { land as landTree } from './land.ts'
import { request } from './http.ts'
import { spawnDefault } from './providers.ts'
import { atFleet, mailDomain } from './mailaddr.ts'
import { commands, focusOf, run as runCommand } from './commands.ts'
import { type LogEntry, seqRange, type Sift, transcribe } from './log_text.ts'
import {
  cliVerbs,
  help,
  manuals,
  parse,
  requestedHelp,
  route,
  usage,
  validateCommand,
} from './manual.ts'
import { type Got, type Run, type Verb } from './verb.ts'
import { safe } from './terminal.ts'
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
  let [sess] = await query([`.session.id=${session}`], 'session')
  if (!sess) return
  let mine = await query([`.claim.session=${sess.eid}`], 'task')
  let digest = claimedDigest(mine)
  if (digest) print(`\n${digest}`)
}

// `task projects` is `task list projects` — the plural IS the listing
// verb, because it is what a cold caller types before reading any help.
// Only the plural: the singular stays a subject (`task board`, `task
// home`), so no alias is shadowed by a word that names a kind.
export let listing = (cmd: string | undefined, args: string[]) =>
  cmd && plurals.has(cmd) ? { cmd: 'list', args: [cmd, ...args] } : undefined

// Subject-first is syntax sugar only. The returned route enters the same
// handlers as the canonical subcommands, so graph behavior has one owner.
export let subject = (id: string | undefined, args: string[]) => {
  if (
    !id || id == '--help' || cliVerbs.has(id) || commands[id] ||
    id.startsWith(':') || id.startsWith('-')
  ) return
  let [verb, ...objects] = args
  if (!verb) return { cmd: 'show', args: [id] }
  if (args.includes('--help') || args.includes('-h')) {
    return { cmd: 'help', args: ['subject', id] }
  }
  if (verb == '--json' || verb == '--quarantined') {
    if (
      objects.length > 1 ||
      objects.some((x) => x != '--json' && x != '--quarantined')
    ) {
      throw new Error(`task ${id} [show] [--json] [--quarantined]`)
    }
    return { cmd: 'show', args: [id, verb, ...objects] }
  }
  if (verb == 'show') {
    if (
      objects.length > 2 ||
      objects.some((x) => x != '--json' && x != '--quarantined')
    ) {
      throw new Error(`task ${id} [show] [--json] [--quarantined]`)
    }
    return { cmd: 'show', args: [id, ...objects] }
  }
  if ((edges as readonly string[]).includes(verb)) {
    let children = objects.filter((x) => x != '--gone')
    let flags = objects.filter((x) => x == '--gone')
    if (
      children.length != 1 || flags.length > 1 ||
      flags.length != objects.length - 1
    ) {
      throw new Error(`task ${id} ${verb} <id> [--gone]`)
    }
    return { cmd: 'dep', args: [id, verb, ...objects] }
  }
  if (verb == 'is') {
    if (objects.length != 1 || !statuses.some((s) => s == objects[0])) {
      throw new Error(`status is one of: ${statuses.join(', ')}`)
    }
    return { cmd: 'set', args: [id, `.status=${objects[0]}`] }
  }
  if (verb == 'as') {
    if (objects.length != 1 || !formats.includes(objects[0])) {
      throw new Error(`format is one of: ${formats.join(', ')}`)
    }
    return {
      cmd: 'show',
      args: [id, ...(objects[0] == 'json' ? ['--json'] : [])],
    }
  }
  // Focused palette commands keep their explicit colon: several accept
  // optional objects whose subject-first reading would be ambiguous.
  if (verb.startsWith(':')) return
  throw new Error(`no subject verb: ${verb} (task ${id} --help)`)
}

// Which KIND a listing walks. It is a selector, not a filter — kind is
// derived from an entity's components, so no row carries the column and
// no pred could test it (route() says so to whoever writes `.kind` into a
// board). Every spelling a caller reaches for names it: the bare word in
// either number, the `/query` parameter, and the dot-param the filter
// grammar makes them expect. Undefined = not a kind word at all, so the
// argument falls through to the filter parser.
export let kindArg = (arg: string) => {
  let word = arg.replace(/^\.?kind=/, '')
  let kind = kindWord(word)
  if (!kind && word != arg) {
    throw new Error(`no such kind: ${word} — one of ${kindOrder.join(', ')}`)
  }
  return kind
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

let list = async (got: Got) => {
  let json = got.flags.has('--json')
  let words = got.words
    .map((a) => [a, kindArg(a)] as const)
  let kind = words.find(([, k]) => k)?.[1] ?? 'task'
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
  // The server matches and kind-filters; byBoard stays local. Derived titles
  // and the ⚑ column resolve their named entities through one bounded read.
  let hits = (await query(line, kind)).sort(byBoard)
  let refs = await fetched(
    hits.flatMap((r) => [
      String(r.comps.claim?.session ?? ''),
      String(r.comps.deliver?.to ?? ''),
    ]).filter((s) => s),
  )
  if (json) return print(jsonText(hits.map((r) => jsonOf(r))))
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
    print(
      `${idOf(r).padEnd(6)} ${handle.padEnd(wide)} ${title}${flag}`,
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
    ? (await query([`.session.id=${sid}`], 'session'))[0]
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
  if (!id || !got.params.length) {
    throw new Error('task set <id> .prop=value ...')
  }
  let sid = me()
  let [row, resolved, sess] = await Promise.all([
    needed(id),
    derefedParams(got.params),
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

// `task done T-3 [comment]` / `task cancel T-3 [reason]` — sugar over
// .status=done|cancelled plus an optional comment, one atomic batch like
// `task set`. Only fires when the FIRST word is id-shaped: `done` and
// `cancel` are also palette verbs (commands.ts) that operate on the
// session's FOCUSED task, and bare prose ("cancel duplicate of the
// umbrella") is legitimately a reason for that focused task, not a typo'd
// target — the dispatcher below sends anything else there unchanged. What
// this closes is the id-shaped case: T-14573 found `task cancel T-123`
// silently cancelling the wrong (focused) task and posting "T-123" as the
// reason, because the id read as reason prose instead of a target.
let idLike = (s?: string) => !!s && /^[A-Za-z]+-\d+$/.test(s)

let finish = (status: 'done' | 'cancelled') => async (args: string[]) => {
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
let done = finish('done')
let cancel = finish('cancelled')

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

// The MAIL SLICE (deprecated — `task inbox` is the door): YOUR unread
// bare, the digest's own predicate scoped to the project you stand in;
// --all/--sent widen to the fleet, dot-params screen (the one filter
// grammar). A word that isn't a filter teaches the verb family instead of
// guessing. `task inbox` now speaks all of this, which is what lets this
// one retire.
let mailList = async (got: Got) => {
  let json = got.flags.has('--json')
  let every = got.flags.has('--all'), sent = got.flags.has('--sent')
  let preds = got.words.map((a) => {
    let p = pred(a)
    if (!p) throw new Error(`not a mail filter: ${a}\n\n${help(['mail'])}`)
    return p
  })
  await checkedRefs(preds)
  let filters = got.words
  // The one predicate. "Your items" means the same thing here as in the
  // inbox and the boot digest, so the mail-only slice can never disagree
  // with the door it is a slice of.
  let gathered = every
    ? { rows: await query(filters, 'mail'), who: undefined }
    : sent
    ? {
      rows: await query(['.mail.to!', '.mail.message_id=', ...filters], 'mail'),
      who: undefined,
    }
    : await inboxRows(me(), Deno.cwd(), filters)
  let mine = gathered.who ? inboxItem(gathered.who) : () => false
  let hits = gathered.rows
    .filter((r) => !!r.comps.mail)
    .filter((r) =>
      sent ? !r.comps.mail.message_id : every ? true : unreadMail(r) && mine(r)
    )
    .sort((a, b) => mailAt(a).localeCompare(mailAt(b)))
  if (json) return print(jsonText(hits.map((r) => jsonOf(r))))
  if (!hits.length) {
    return warn(
      sent ? '(nothing sent)' : every
        ? '(no mail)'
        // Points at the inbox, not at more mail: an operator reads this line
        // and concludes they are current, so it must name the surface that
        // actually holds everything owed to them.
        : '(no unread mail — task inbox is everything addressed to you)',
    )
  }
  let bold = Deno.stdout.isTerminal()
  for (let r of hits) {
    let line = mailLine(r)
    print(line, bold && unreadMail(r))
  }
}

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

// The doctor: every book address must be Cloudflare-deliverable. Live
// rules when a token can read them; the checked-in snapshot (loudly
// non-authoritative) when none can — and a token that fails to read is
// its own loud line, never a silent degrade. Exit 1 on any gap: the
// disease is sends that report success while mail vanishes (ufos@).
let mailDoctor = async () => {
  let book = bookOf(await query(['.email.address!']))
  let rules: Rules | null = null
  try {
    rules = await liveRules()
  } catch (e) {
    warn(`⚠ live rule read failed — ${(e as Error).message}`)
  }
  if (!rules) {
    rules = STATIC_RULES
    warn(
      '⚠ STATIC rule snapshot (src/doctor.ts) — NOT authoritative, it can\n' +
        '  drift from Cloudflare silently, and has. Rule verdicts below are\n' +
        '  marked ? and are NOT measurements. Email Routing scope on this\n' +
        '  box belongs to the MCP Cloudflare server (OAuth), not to any\n' +
        '  bearer token — so a live read is an agent errand: read the rules\n' +
        '  and refresh STATIC_RULES. Set CLOUDFLARE_ROUTING_READ_TOKEN if a\n' +
        '  read-only routing token is ever minted.',
    )
  }
  let bots = book.filter((e) => atFleet(e.address))
  let bad = diagnose(book, rules)
  // '?' where the verdict came from the snapshot rather than Cloudflare.
  // A '✗' asserts a measurement, and one read off a stale constant was
  // filed as a production defect (T-10480) — the marker is what stops
  // that, since the ⚠ banner above is read as advisory and this is not.
  for (let f of bad) {
    let mark = f.fromRules && !rules.live ? '?' : '✗'
    print(`${mark} ${f.address} (${f.owner}) — ${f.problem}`)
  }
  print(
    `${bots.length - bad.length}/${bots.length} ${mailDomain()} addresses ` +
      `deliverable (${book.length} in the book; rules: ` +
      `${rules.live ? 'live' : 'static'})`,
  )
  if (bad.length) Deno.exit(1)
}

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
      rows: await query(['.mail.to!', '.mail.message_id=', ...filters], 'mail'),
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

// A claim is a session's lease on a task — other agents see who holds
// it, and the server refuses to hand a held lease to someone else.
let claim = async (got: Got) => {
  let id = got.args.id, sess = got.args.session
  let session = sess ?? me()
  if (!id) throw new Error('task claim <id> [session]')
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
  id: string,
  flags: {
    provider?: string
    model?: string
    effort?: string
    persona?: string
  },
) => {
  let by = me()
  let [task, caller, persona] = await Promise.all([
    needed(id),
    by ? sessionRow(by) : undefined,
    flags.persona ? around(flags.persona) : undefined,
  ])
  let all = [task, ...(caller ? [caller] : []), ...(persona?.all ?? [])]
  // Unnamed provider/model inherit: the calling session's own (a spawn
  // begets its own kind), then the shared anonymous default.
  let mine = spawnDefaults(all, by)
  let provider = flags.provider ?? mine.provider
  let model = flags.model ?? (flags.provider ? undefined : mine.model)
  if (!provider || !model) {
    let table = await (await request(`http://${host()}/providers`)).json() as {
      name: string
      models: string[]
    }[]
    let fallback = spawnDefault(table, { provider, model })
    provider = fallback.provider
    model = fallback.model
    if (!provider || !model) throw new Error('no provider to default to')
  }
  let made = spawnChanges(all, {
    task: id,
    provider,
    model,
    effort: flags.effort,
    persona: flags.persona,
    by,
    deps: persona?.deps,
  })
  await send(made.changes)
  let onto = find(all, id)
  print(
    `${await minted(made.eid)} spawned onto ${onto ? idOf(onto) : id}`,
  )
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
  let sessions = await query([], 'session')
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
      all.push(...await query(['.repo!'], 'project'))
      await one('tasks')
    }
  }
  if (name == 'knock') await one(rest[0])
  if (name == 'wake') {
    await Promise.all([one(rest[0]), one(rest.at(-1))])
  }
  if (name == 'claim' && rest[0]) {
    let sess = await sessionRow(rest[0])
    if (sess) all.push(sess)
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
  if (out.changes?.length) await send(await derefedChanges(out.changes))
  if (out.msg) print(out.msg)
  if (out.spawn) await launch(out.spawn, {})
  if (out.go) {
    let r = all.find((x) => x.eid == out.go)
    print(entityUrl(r ? idOf(r) : out.go))
  }
}

let release = async (got: Got) => {
  let id = got.args.id
  if (!id) throw new Error('task release <id>')
  let row = await needed(id)
  await send([{ eid: row.eid, name: 'claim', comp: null }])
  print(`${idOf(row)} released`)
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

let roleState = async (sub: string, got: Got) => {
  let want = sub == 'stop' ? 'stopped' : 'running'
  let ids = got.many.ids ?? []
  // `.role.state!`, not `.role!` — bare `.role` is session.role, which would
  // list sessions. state
  // is NOT NULL on every role, so its presence IS the component's.
  let targets = got.flags.has('--all')
    ? (await query(['.role.state!'])).sort((a, b) => a.num - b.num)
    : await Promise.all(ids.map(neededRole))
  if (!targets.length) {
    throw new Error(
      got.flags.has('--all') ? 'no roles' : help(['role', sub]),
    )
  }
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
  let json = got.flags.has('--json')
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
      ...jsonOf(row),
      ...edges,
      comments: comments.map((r) => jsonOf(r)),
    }))
  } else print(showMd(snap, all, row))
}

// The entity's write history — the journal, one line per touching batch:
// when · who · what changed. Blame without a version table.
let past = async (got: Got) => {
  let json = got.flags.has('--json')
  let n = Number(got.opts['-n'])
  let id = got.args.id
  if (!id) throw new Error('task history <id> [-n N]')
  let row = await needed(id)
  let entries = await history(row.eid, n)
  if (json) return print(jsonText(entries))
  if (!entries.length) return print(`${idOf(row)}: no history`)
  for (let e of entries) print(historyLine(e))
}

// A session's WHOLE log as a clean, ordered transcript — the dump you want
// first when debugging one. Reads the same /logs door session_peek does (the
// authoritative entry partition for a graph-native session), renders through
// the shared log_text formatter, and screens with --prose / --seq / since /
// until. Pages by --after (a seq cursor) + --limit; default is the whole log.
let transcript = async (got: Got) => {
  let json = got.flags.has('--json')
  let id = got.args.id
  if (!id) {
    throw new Error(
      'task transcript <S> [--prose] [--seq A..B] [--after N] [--limit N]',
    )
  }
  let row = await needed(id)
  if (!row.comps.session) throw new Error(`not a session: ${idOf(row)}`)
  let q = new URLSearchParams()
  let after = got.opts['--after']
  let limit = got.opts['--limit']
  if (after) q.set('after', String(Number(after)))
  if (limit) q.set('limit', String(Number(limit)))
  let res = await request(`http://${host()}/sessions/${row.eid}/logs?${q}`)
  let log = await res.json() as {
    entries: LogEntry[]
    latest?: number
    model?: string
    busy?: boolean
  }
  let sift: Sift = {
    ...(got.flags.has('--prose') ? { prose: true } : {}),
    ...(got.opts['--seq'] ? seqRange(got.opts['--seq']) : {}),
    ...(got.opts['--since'] ? { since: got.opts['--since'] } : {}),
    ...(got.opts['--until'] ? { until: got.opts['--until'] } : {}),
  }
  let entries = log.entries
  if (json) return print(jsonText({ ...log, lines: transcribe(entries, sift) }))
  let s = row.comps.session
  print(
    [
      `${idOf(row)} ${log.busy ? 'running' : s.status ?? 'idle'}`,
      `${s.provider ?? '?'} ${log.model ?? s.serving_model ?? s.model ?? ''}`
        .trim(),
      `seq ${log.latest ?? s.latest_seq ?? 0}`,
    ].join(' · '),
  )
  for (let line of transcribe(entries, sift)) print(line)
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

// Serve the comms bus once per run, on STDERR. A pipe redirects stdout only,
// so `task list | head` still shows this, `--json` stays parseable, and a
// redirect to a file stays clean. `2>/dev/null` does hide it — but the stamp
// demotes an item from unread to read in `task inbox`, which keeps everything
// until it is ARCHIVED, so a message can be missed here and never lost.
//
// The bus asks its OWN bounded question (client.ts bus()) rather than reading
// whatever snapshot a verb happened to leave behind. That is what lets a verb
// stop pulling the corpus (T-13882) without the bus going silent — and it is
// why a verb that only writes serves the bus too.
//
// A HOOK is the case where nobody is there (T-14196). Serving stamps every
// line `notified`, which demotes it from unread — so a hook's stderr, which
// no operator will ever read, would consume the messages and lose them.
// `wrap --hook` is SessionEnd: the worst moment to do that. This used to be
// masked by "only a verb that read a snapshot serves", and asking the bus its
// own question removes the mask, so the rule has to be said out loud.
// `context --hook` needs no exception: its stdout IS the digest the session
// boots into, so it serves deliberately and sets `told` itself.
let told = false
let heard = async (hook = false) => {
  if (told || hook) return
  told = true
  let sid = me()
  if (!sid) return
  // An aside, never the answer: a server that went away between the verb and
  // this fetch costs the notices — which stay unread and ring again — not the
  // verb's exit code. `task help` still works with nothing listening.
  let n = await bus(sid).catch(() => undefined)
  if (!n?.lines.length) return
  await send(n.ack)
  warn(noticeBlock(n.lines))
}

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
  // The digest plus the comms bus: unseen comments ride along, and the
  // session's ack cursor advances exactly when they're printed. A reified
  // session's own meta leads as frontmatter (T-4554) — the S-num is how
  // the agent addresses its own session doc.
  let tell = async (snap: Snapshot, sid: string, scope?: string) => {
    let fm = sessionMeta(rows(snap), sid)
    let out = contextDigest(snap, sid, Date.now(), scope)
    if (fm) out = `${fm}\n${out}`
    let n = await bus(sid)
    told = true // this digest IS the serving; heard() must not repeat it
    if (n.lines.length) {
      await send(n.ack)
      out += noticeBlock(n.lines)
    }
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
      if (pid) all.push(...await query([`.session.pid=${pid}`], 'session'))
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
    } catch {
      // silent: offline server or malformed stdin — the session goes on
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
  let sess = await sessionRow(session)
  let made = designChanges(sess ? [sess] : [], { title, body, session })
  await send(made.changes)
  print(`${await minted(made.eid)} proposed`)
  let hint = await similarHint(`${title}\n${body ?? ''}`, made.eid)
  if (hint) print(hint)
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

// The self-authored brief (T-4554): write YOUR session doc's body — the
// narrative wrap preserves (a non-stub body is never clobbered) and the
// next digest quotes as `## previously`. Body doors match mail's:
// trailing words, --body=@file, --body=- or @- (piped stdin). Another
// session's doc is task set's job (task set S-12 .body=@brief.md).
let sessionBrief = async (got: Got) => {
  let sid = me()
  if (!sid) throw new Error('session brief: run under a session (no identity)')
  let body = got.body
  if (!body) {
    throw new Error(
      'a brief needs words: text, @file, or --body=@file|-|@-',
    )
  }
  let sess = await sessionRow(sid)
  if (!sess) {
    throw new Error(`no session entity for ${sid} — task session context first`)
  }
  // Keep a hand-set title; name a nameless one the way wrap would.
  let day = new Date().toISOString().slice(0, 10)
  let title = String(sess.comps.doc?.title || `Work session ${day}`)
  await send([{ eid: sess.eid, name: 'doc', comp: { title, body } }])
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
  let all = await query([], 'session')
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
  let killed = await reap(seen.verdicts)
  let pruned = repo ? stale.filter((t) => prune(repo, t.tree)) : []
  warn(
    `reaped ${killed.length} process(es), ${pruned.length} worktree(s)`,
  )
}

// What the tools have been doing: MCP calls, HTTP writes and browser
// crashes, newest first. --errors is the view you want most days.
let telemetry = async (got: Got) => {
  let q = new URLSearchParams()
  if (got.flags.has('--errors')) q.set('only', 'errors')
  if (got.opts['--since']) q.set('since', got.opts['--since'])
  if (got.opts['-n']) q.set('limit', got.opts['-n'])
  let res = await request(`http://${host()}/telemetry?${q}`)
  if (!res.ok) throw new Error(`server said ${res.status}`)
  let rows = await res.json() as Log[]
  if (!rows.length) return warn('(nothing recorded)')
  for (let r of rows) {
    print(
      `${local(r.ts)}  ${r.source.padEnd(4)} ${r.name.padEnd(14)} ${
        r.ok ? 'ok ' : 'ERR'
      } ${(r.ms == null ? '' : `${r.ms}ms`).padStart(6)}  ${
        (r.session_id ?? '-').padEnd(10)
      }  ${(r.error ?? '').slice(0, 80)}`,
    )
  }
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
// channel active, so a comment on the session's entity or a knock at its
// door drops straight into the running transcript. Identity is Claude's
// own session id (CLAUDE_CODE_SESSION_ID — /clear rotates it, and the
// rotation IS the point: one S-* per life). The SessionStart hook reifies
// the entity under it and stamps the claude process pid; the channel
// plugin binds by that pid, so service follows each rotation.
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
  `task session ${verb} --hook || true`

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

export let verbs = bind({
  tui: () => tui(),
  claude,
  codex,
  list,
  decided,
  new: create,
  set,
  show,
  history: past,
  transcript,
  search: seek,
  mail: mailList,
  'mail show': mailShow,
  'mail send': mailSend,
  'mail reply': mailReply,
  'mail search': mailSeek,
  'mail files': mailFiles,
  'mail doctor': () => mailDoctor(),
  watch: subscribe('watch'),
  mute: subscribe('mute'),
  inbox: inboxList,
  'inbox show': inboxShow,
  'inbox archive': inboxArchive,
  claim,
  release,
  block,
  unblock,
  spawn,
  land: () => land(),
  comment,
  dep,
  backup: () => backup(),
  sync,
  design,
  remember,
  session,
  'session context': context,
  'session wrap': wrap,
  'session brief': sessionBrief,
  'session turn': sessionTurn,
  role,
  'role stop': (got) => roleState('stop', got),
  'role start': (got) => roleState('start', got),
  probes,
  telemetry,
  wake: (got) => colon(undefined, ['wake', ...got.words]),
  help: (got) => print(help(got.words)),
  ls: list,
  context,
  wrap,
})

// Only run the CLI when invoked as the program — importing this module (e.g.
// from tests) must not dispatch a command or call Deno.exit.
if (import.meta.main) {
  let [cmd, ...rest] = Deno.args
  try {
    let asked = requestedHelp(Deno.args)
    let hook = false
    if (asked != null) print(asked)
    else if (!cmd) await bare()
    else {
      let routed = listing(cmd, rest) ?? subject(cmd, rest)
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
      } else if ((cmd == 'done' || cmd == 'cancel') && idLike(rest[0])) {
        // Explicit-target sugar (T-14573) — done/cancel validate their
        // own args below, not the focused-task palette's word count.
        await (cmd == 'done' ? done(rest) : cancel(rest))
      } else if (cmd && commands[cmd]) {
        validateCommand(cmd, rest)
        await colon(undefined, [cmd, ...rest])
      } else {
        print(usage())
        Deno.exit(2)
      }
    }
    // Whatever the verb did, hand over anything addressed to this session.
    await heard(hook)
  } catch (e) {
    warn(`task: ${(e as Error).message} (server: ${host()})`)
    Deno.exit(1)
  }
}
