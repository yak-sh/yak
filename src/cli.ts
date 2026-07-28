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
  bornAt,
  byBoard,
  claimant,
  claimChanges,
  commentChanges,
  contextDigest,
  derefParams,
  edgesOf,
  find,
  history,
  historyBy,
  historyLine,
  hookClaim,
  host,
  idOf,
  inboxItem,
  inboxMail,
  inflate,
  isOperator,
  isUnread,
  mailAt,
  mailChanges,
  mailLine,
  me,
  memoryChanges,
  noticeBlock,
  notices,
  type Param,
  param,
  patches,
  query,
  readerFor,
  replyChanges,
  repoAt,
  type Row,
  rows,
  search,
  send,
  sessionFor,
  sessionMeta,
  showMd,
  similarHint,
  snapshot,
  spawnChanges,
  spawnDefaults,
  taskBlock,
  taskChanges,
  threadOf,
  unreadMail,
  wrapChanges,
} from './client.ts'
import { matchQuery, noFilter, pred, resolveRefs } from './query.ts'
import {
  bookOf,
  diagnose,
  liveRules,
  type Rules,
  STATIC_RULES,
} from './doctor.ts'
import { type Edge, edges, type Snapshot, statuses } from './types.ts'
// `import type` (not the repo's usual inline `{ type X }`): telemetry.ts
// reaches for node:sqlite, and the CLI has no business loading a db driver.
import type { Log } from './telemetry.ts'
import type { JournalEntry } from './client.ts'
import { agentPid, claudePid, descends } from './proc.ts'
import { filesFor, syncFiles } from './persona.ts'
import { commit } from './git.ts'
import { request } from './http.ts'
import { commands, focusOf, run as runCommand } from './commands.ts'
import {
  cliVerbs,
  help,
  requestedHelp,
  route,
  usage,
  validate,
  validateCommand,
} from './manual.ts'
export { subjectUsage } from './manual.ts'

let formats = ['markdown', 'json']

export let claimedDigest = (mine: Row[]) =>
  mine
    .slice(0, 4)
    .flatMap((r) => taskBlock(mine, [], r))
    .join('\n')

let bare = async () => {
  console.log(usage())
  let session = me()
  if (!session) return
  let [sess] = await query([`.session.id=${session}`], 'session')
  if (!sess) return
  let mine = await query([`.claim.session_eid=${sess.eid}`], 'task')
  let digest = claimedDigest(mine)
  if (digest) console.log(`\n${digest}`)
}

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
  if (verb == '--json') {
    if (objects.length) throw new Error(`task ${id} [show] [--json]`)
    return { cmd: 'show', args: [id, verb] }
  }
  if (verb == 'show') {
    if (objects.length > 1 || objects.some((x) => x != '--json')) {
      throw new Error(`task ${id} [show] [--json]`)
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

let split = (args: string[]) => {
  let params: Param[] = []
  let words: string[] = []
  for (let a of args) {
    let p = param(a)
    if (p) params.push(inflate(p))
    else words.push(a)
  }
  return { params, words }
}

let list = async (args: string[]) => {
  // Filters speak the query grammar — operators, lists, ranges
  // ('.priority<=1', '.domain=Ops,Eng'). A word that isn't a filter
  // teaches instead of silently listing everything.
  let json = args.includes('--json')
  let all = rows(await snapshot())
  let preds = resolveRefs(
    args.filter((a) => a != '--json').map((a) => {
      let p = pred(a)
      if (!p) throw new Error(`${noFilter(a)} (task help grammar)`)
      return p
    }),
    (id) => find(all, id)?.eid,
  )
  let byEid = new Map(all.map((r) => [r.eid, r.comps]))
  let hits = all
    .filter((r) => r.comps.task)
    .filter((r) => matchQuery(r.comps, preds, (e) => byEid.get(e)))
    .sort(byBoard)
  if (json) return console.log(JSON.stringify(hits, null, 2))
  for (let r of hits) {
    let t = r.comps.task ?? {}
    let who = claimant(all, r)
    let flag = who ? `  \u2691 ${who}` : ''
    console.log(
      `${idOf(r).padEnd(6)} ${String(t.status ?? '').padEnd(5)} ${
        String(r.comps.doc?.title ?? '')
      }${flag}`,
    )
  }
  if (!hits.length) console.error('(no matches)')
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

export let strayFlag = (
  words: string[],
): { got: string; suggest: string } | null => {
  let i = words.findIndex((w) => /^--[\w-]+(=|$)/.test(w))
  if (i < 0) return null
  let raw = words[i]
  let eq = raw.indexOf('=')
  let [flag, val] = eq >= 0
    ? [raw.slice(0, eq), raw.slice(eq + 1)]
    : [raw, words[i + 1]]
  return { got: raw, suggest: `${flag.replace(/^--/, '.')}=${val ?? '…'}` }
}

let create = async (args: string[]) => {
  let { params, words } = split(args)
  let stray = strayFlag(words)
  if (stray) {
    throw new Error(
      `task new uses dot-params, not --flags — did you mean ${stray.suggest}? (got ${stray.got})`,
    )
  }
  // Reference values (.project=bindery, .assignee=jeff) resolve at the
  // door — same rule as the MCP tools.
  let grouped = patches(derefParams(rows(await snapshot()), params))
  // A leading P<n> sets priority (the documented shorthand); an explicit
  // .priority= wins the value, but the leading token still leaves the title.
  let { words: title, priority } = leadPrio(words)
  if (priority != null) grouped.task = { priority, ...grouped.task }
  grouped.doc = { title: title.join(' '), ...grouped.doc }
  if (!grouped.doc.title) throw new Error('a task needs a .title')
  let eid = crypto.randomUUID()
  await send(taskChanges(eid, grouped))
  let made = rows(await snapshot()).find((r) => r.eid == eid)
  console.log(`${made ? idOf(made) : eid} created`)
  let hint = await similarHint(
    `${grouped.doc.title}\n${grouped.doc.body ?? ''}`,
    eid,
  )
  if (hint) console.log(hint)
}

let set = async (args: string[]) => {
  // --comment=... rides the same atomic batch as plain commentary — the
  // change itself is the journal's to record, never a comment's.
  let say = args.find((a) => a.startsWith('--comment='))?.slice(10)
  let { params, words } = split(args.filter((a) => !a.startsWith('--comment=')))
  let [id] = words
  if (!id || words.length != 1 || !params.length) {
    throw new Error('task set <id> .prop=value ...')
  }
  let all = rows(await snapshot())
  let row = find(all, id)
  if (!row) throw new Error(`no entity: ${id}`)
  await send([
    ...Object.entries(patches(derefParams(all, params)))
      .map(([name, comp]) => ({ eid: row.eid, name, comp })),
    ...(say ? commentChanges(all, row.eid, say, me()) : []),
  ])
  console.log(`${idOf(row)} updated`)
}

// Full-text search — every doc in the graph, ranked, matches bracketed.
let seek = async (args: string[]) => {
  let json = args.includes('--json')
  let q = args.filter((a) => a != '--json').join(' ')
  if (!q) throw new Error('task search <words...> (trailing * = prefix)')
  let hits = await search(q)
  if (json) return console.log(JSON.stringify(hits, null, 2))
  if (!hits.length) return console.log('(no hits)')
  for (let h of hits) {
    let aim = h.open_eid != h.eid ? ` → on ${h.open_eid}` : ''
    let snip = h.snip.replaceAll('\x01', '[').replaceAll('\x02', ']')
    let sunk = h.retired ? ' · retired' : ''
    console.log(
      `${idOf(h)} ${h.kind}: ${h.title || '(untitled)'}${aim} — ${snip}${sunk}`,
    )
  }
}

// ---- task mail: the mail door (letters only — mail-comp wearers; hooks
// and event comments never surface here) ----

// The body, by preference: --body= (@file reads the file — the safe
// door for long prose; - and @- read piped stdin), then trailing words.
// stdin is never read implicitly: a harness holding the pipe open but
// silent would hang the send forever (observed live, T-5854) and no
// guard can tell that pipe from a slow one — so - or @- is the deliberate
// ask, and a missing body fails fast instead of blocking. Shared by
// mail send/reply and the session brief — one body door, every verb.
type Input = {
  terminal: () => boolean
  read: () => Promise<string>
}

let input: Input = {
  terminal: () => Deno.stdin.isTerminal(),
  read: () => new Response(Deno.stdin.readable).text(),
}

export let bodyOf = async (
  flags: string[],
  words: string[],
  stdin = input,
) => {
  let b = flags.find((a) => a.startsWith('--body='))?.slice(7)
  if (b == '-' || b == '@-') {
    if (stdin.terminal()) {
      throw new Error(`--body=${b}: stdin is a TTY — pipe the body in`)
    }
    return (await stdin.read()).trim()
  }
  if (b?.startsWith('@')) {
    b = String(inflate({ comp: 'doc', prop: 'body', value: b }).value)
  }
  return b ?? words.join(' ')
}

// The inbox: YOUR unread bare — the digest's own predicate, scoped to
// the project you stand in — --all/--sent widen to the fleet, dot-params
// screen (the one filter grammar). A word that isn't a filter teaches
// the verb family instead of guessing.
let mailList = async (args: string[]) => {
  let json = args.includes('--json')
  let every = args.includes('--all'), sent = args.includes('--sent')
  let preds = args.filter((a) => !['--json', '--all', '--sent'].includes(a))
    .map((a) => {
      let p = pred(a)
      if (!p) throw new Error(`not a mail filter: ${a}\n\n${help(['mail'])}`)
      return p
    })
  let all = rows(await snapshot())
  let resolved = resolveRefs(preds, (id) => find(all, id)?.eid)
  let byEid = new Map(all.map((r) => [r.eid, r.comps]))
  let sess = all.find((r) => String(r.comps.session?.id ?? '') == me())
  let inbox = inboxMail(
    repoAt(all, Deno.cwd())?.eid,
    isOperator(sess?.comps.session),
  )
  let hits = all
    .filter((r) => r.comps.mail)
    .filter((r) => sent ? !r.comps.mail.message_id : every ? true : inbox(r))
    .filter((r) => matchQuery(r.comps, resolved, (e) => byEid.get(e)))
    .sort((a, b) => mailAt(a).localeCompare(mailAt(b)))
  if (json) return console.log(JSON.stringify(hits, null, 2))
  if (!hits.length) {
    return console.error(
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
    console.log(bold && unreadMail(r) ? `\x1b[1m${line}\x1b[0m` : line)
  }
}

// One mail whole, its thread beneath — and reading IS the mark: the
// `opened` stamp (T-7006) lands by a normal wire patch. Nothing else
// auto-reads.
let mailShow = async (args: string[]) => {
  let json = args.includes('--json')
  let [id] = args.filter((a) => a != '--json')
  if (!id) throw new Error(help(['mail', 'show']))
  let snap = await snapshot()
  let all = rows(snap)
  let row = find(all, id)
  if (!row?.comps.mail) throw new Error(`not a mail: ${id}`)
  let thread = threadOf(all, row.eid)
  if (json) {
    console.log(JSON.stringify(
      { ...row, thread: thread.map((t) => idOf(t)) },
      null,
      2,
    ))
  } else {
    console.log(showMd(snap, all, row))
    if (thread.length > 1) {
      console.log('\n## Thread')
      for (let t of thread) {
        console.log(`${t.eid == row.eid ? '▶' : ' '} ${mailLine(t)}`)
      }
    }
  }
  if (!row.comps.opened) {
    await send([{ eid: row.eid, name: 'opened', comp: {} }])
  }
}

// Minting doc+mail IS the send request — the server's effect delivers
// and stamps the receipt; task show <E-id> reads it back.
let mailSend = async (args: string[]) => {
  let flags = args.filter((a) => a.startsWith('--'))
  let [to, ...subj] = args.filter((a) => !a.startsWith('--'))
  if (!to || !subj.length) {
    throw new Error(help(['mail', 'send']))
  }
  let body = await bodyOf(flags, [])
  if (!body) {
    throw new Error(
      'a mail needs a body: --body=@file, or --body=- with piped stdin',
    )
  }
  let made = mailChanges({
    to,
    subject: subj.join(' '),
    body,
    from: flags.find((a) => a.startsWith('--from='))?.slice(7),
  })
  await send(made.changes)
  let after = rows(await snapshot()).find((r) => r.eid == made.eid)
  let eid = after ? idOf(after) : made.eid
  console.log(`${eid} → ${to} — task show ${eid} for the delivery receipt`)
}

let mailReply = async (args: string[]) => {
  let flags = args.filter((a) => a.startsWith('--'))
  let [id, ...text] = args.filter((a) => !a.startsWith('--'))
  if (!id) throw new Error(help(['mail', 'reply']))
  let all = rows(await snapshot())
  let row = find(all, id)
  if (!row?.comps.mail) throw new Error(`not a mail: ${id}`)
  let body = await bodyOf(flags, text)
  if (!body) {
    throw new Error(
      'a reply needs words: text, --body=@file, or --body=- with stdin',
    )
  }
  let made = replyChanges(
    row,
    body,
    flags.find((a) => a.startsWith('--from='))?.slice(7),
  )
  await send(made.changes)
  let after = rows(await snapshot()).find((r) => r.eid == made.eid)
  let eid = after ? idOf(after) : made.eid
  console.log(
    `${eid} → ${made.changes[1].comp?.to} (re: ${
      idOf(row)
    }) — task show ${eid} for the receipt`,
  )
}

// Attachments, through the server's proxy (the worker's token lives
// there, never here — the CLI only ever talks to its own server).
// Default DIR: ./mail-attachments/<message-id>/.
let mailFiles = async (args: string[]) => {
  let out: string | undefined
  let rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] == '--out') out = args[++i]
    else if (args[i].startsWith('--out=')) out = args[i].slice(6)
    else rest.push(args[i])
  }
  let [id] = rest
  if (!id) throw new Error(help(['mail', 'files']))
  let door = `http://${host()}/mail/${encodeURIComponent(id)}/files`
  let res = await request(door)
  if (!res.ok) throw new Error(await res.text())
  let { message_id, files } = await res.json() as {
    message_id: string
    files: { name: string; size: number }[]
  }
  if (!files.length) return console.log(`no attachments for ${id}`)
  out ??= `mail-attachments/${message_id.replace(/[^\w.-]/g, '_')}`
  Deno.mkdirSync(out, { recursive: true })
  for (let f of files) {
    let r = await request(`${door}/${encodeURIComponent(f.name)}`)
    if (!r.ok) throw new Error(`${f.name}: ${await r.text()}`)
    // R2 keys can't hide a directory in a NAME — but never trust one.
    let path = `${Deno.realPathSync(out)}/${f.name.replaceAll('/', '_')}`
    await Deno.writeFile(path, new Uint8Array(await r.arrayBuffer()))
    console.log(path)
  }
}

// The doctor: every book address must be Cloudflare-deliverable. Live
// rules when a token can read them; the checked-in snapshot (loudly
// non-authoritative) when none can — and a token that fails to read is
// its own loud line, never a silent degrade. Exit 1 on any gap: the
// disease is sends that report success while mail vanishes (ufos@).
let mailDoctor = async () => {
  let book = bookOf(rows(await snapshot()))
  let rules: Rules | null = null
  try {
    rules = await liveRules()
  } catch (e) {
    console.error(`⚠ live rule read failed — ${(e as Error).message}`)
  }
  if (!rules) {
    rules = STATIC_RULES
    console.error(
      '⚠ STATIC rule snapshot (src/doctor.ts) — NOT authoritative, it can\n' +
        '  drift from Cloudflare silently; set CLOUDFLARE_ROUTING_READ_TOKEN\n' +
        '  (Email Routing read on the yak.sh zone) for the live check',
    )
  }
  let bots = book.filter((e) => /@bot\.yak\.sh$/i.test(e.address))
  let bad = diagnose(book, rules)
  for (let f of bad) console.log(`✗ ${f.address} (${f.owner}) — ${f.problem}`)
  console.log(
    `${bots.length - bad.length}/${bots.length} bot.yak.sh addresses ` +
      `deliverable (${book.length} in the book; rules: ` +
      `${rules.live ? 'live' : 'static'})`,
  )
  if (bad.length) Deno.exit(1)
}

// FTS, screened to mail — the one search surface, one more door.
let mailSeek = async (args: string[]) => {
  let q = args.join(' ')
  if (!q) throw new Error(help(['mail', 'search']))
  let hits = (await search(q)).filter((h) => h.kind == 'mail')
  if (!hits.length) return console.log('(no hits)')
  for (let h of hits) {
    let snip = h.snip.replaceAll('\x01', '[').replaceAll('\x02', ']')
    console.log(`${idOf(h)} ${h.title || '(no subject)'} — ${snip}`)
  }
}

let mail = (args: string[]) => {
  let [sub, ...rest] = args
  if (sub == 'show') return mailShow(rest)
  if (sub == 'send') return mailSend(rest)
  if (sub == 'reply') return mailReply(rest)
  if (sub == 'search') return mailSeek(rest)
  if (sub == 'files') return mailFiles(rest)
  if (sub == 'doctor') return mailDoctor()
  if (sub == 'help' || sub == '--help') return console.log(help(['mail']))
  return mailList(args)
}

// ---- task inbox: everything addressed to you — comments on your session
// and claimed tasks, knocks at your door, project mail — filtered to what
// you haven't archived (T-7006). `show` marks an item opened (reading IS
// the mark); `archive` is the ONE act that hides. Generalizes `task mail`.
let inboxLine = (r: Row) => {
  let dot = isUnread(r) ? '●' : '·'
  let body = String(r.comps.doc?.body ?? r.comps.doc?.title ?? '')
    .split('\n')[0].slice(0, 80)
  return `${dot} ${idOf(r)} ${r.kind}${body ? ` — ${body}` : ''}`
}

// The inbox list: addressed to me, NOT archived, unread weighted (unread
// first, then oldest→newest so the freshest sits at the bottom, like mail).
let inboxList = async (args: string[]) => {
  let json = args.includes('--json')
  let all = rows(await snapshot())
  let who = readerFor(all, me(), Deno.cwd())
  let items = all.filter(inboxItem(who)).sort((a, b) =>
    (isUnread(b) ? 1 : 0) - (isUnread(a) ? 1 : 0) ||
    bornAt(a).localeCompare(bornAt(b))
  )
  if (json) return console.log(JSON.stringify(items, null, 2))
  if (!items.length) return console.error('(inbox empty)')
  let bold = Deno.stdout.isTerminal()
  for (let r of items) {
    let line = inboxLine(r)
    console.log(bold && isUnread(r) ? `\x1b[1m${line}\x1b[0m` : line)
  }
}

// Reading IS the mark: render the item whole, then stamp `opened` (a bare
// wire write; the server freezes the clock) — the way mailShow stamps.
let inboxShow = async (args: string[]) => {
  let json = args.includes('--json')
  let [id] = args.filter((a) => a != '--json')
  if (!id) throw new Error(help(['inbox', 'show']))
  let snap = await snapshot()
  let all = rows(snap)
  let row = find(all, id)
  if (!row) throw new Error(`no such entity: ${id}`)
  if (json) console.log(JSON.stringify(row, null, 2))
  else console.log(showMd(snap, all, row))
  if (!row.comps.opened) {
    await send([{ eid: row.eid, name: 'opened', comp: {} }])
  }
}

// The one verb that hides: stamp `archived`, removing the item from the
// inbox predicate. Deliberate — no sweep or subagent can do this for you.
let inboxArchive = async (args: string[]) => {
  let [id] = args
  if (!id) throw new Error(help(['inbox', 'archive']))
  let row = find(rows(await snapshot()), id)
  if (!row) throw new Error(`no such entity: ${id}`)
  await send([{ eid: row.eid, name: 'archived', comp: {} }])
  console.log(`archived ${idOf(row)}`)
}

let inbox = (args: string[]) => {
  let [sub, ...rest] = args
  if (sub == 'show') return inboxShow(rest)
  if (sub == 'archive') return inboxArchive(rest)
  if (sub == 'help' || sub == '--help') return console.log(help(['inbox']))
  return inboxList(args)
}

// A claim is a session's lease on a task — other agents see who holds
// it, and the server refuses to hand a held lease to someone else.
let claim = async (args: string[]) => {
  let [id, sess] = args
  let session = sess ?? me()
  if (!id) throw new Error('task claim <id> [session]')
  if (!session) {
    throw new Error('task claim <id> <session> (or run under a session)')
  }
  let all = rows(await snapshot())
  let row = find(all, id)
  if (!row) throw new Error(`no entity: ${id}`)
  await send(claimChanges(all, row.eid, session, Deno.cwd()))
  console.log(`${idOf(row)} claimed by ${session}`)
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
  let snap = await snapshot()
  let all = rows(snap)
  // Unnamed provider/model inherit: the calling session's own (a spawn
  // begets its own kind), then the provider table's first entry.
  let by = me()
  let mine = spawnDefaults(all, by)
  let provider = flags.provider ?? mine.provider
  let model = flags.model ?? (flags.provider ? undefined : mine.model)
  if (!provider || !model) {
    let table = await (await request(`http://${host()}/providers`)).json() as {
      name: string
      models: string[]
    }[]
    provider ??= table[0]?.name
    model ??= table.find((p) => p.name == provider)?.models[0]
    if (!provider || !model) throw new Error('no provider to default to')
  }
  let made = spawnChanges(all, {
    task: id,
    provider,
    model,
    effort: flags.effort,
    persona: flags.persona,
    by,
    deps: snap.deps,
  })
  await send(made.changes)
  let after = rows(await snapshot()).find((r) => r.eid == made.eid)
  let onto = find(all, id)
  console.log(
    `${after ? idOf(after) : made.eid} spawned onto ${onto ? idOf(onto) : id}`,
  )
}

let spawn = async (args: string[]) => {
  let flag = (n: string) =>
    args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
  let [id] = args.filter((a) => !a.startsWith('--'))
  if (!id) {
    throw new Error(
      'task spawn <id> [--provider=X] [--model=Y] [--effort=Z] [--persona=P-9]',
    )
  }
  await launch(id, {
    provider: flag('provider'),
    model: flag('model'),
    effort: flag('effort'),
    persona: flag('persona'),
  })
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
  let all = rows(await snapshot())
  let eid: string | undefined
  if (focus) {
    let r = find(all, focus)
    if (!r) throw new Error(`no entity: ${focus}`)
    eid = r.eid
  } else eid = focusOf(all, session)
  let out = runCommand(line, { eid, rows: all, session })
  if (out.changes?.length) await send(out.changes)
  if (out.msg) console.log(out.msg)
  if (out.spawn) await launch(out.spawn, {})
  if (out.go) {
    let r = all.find((x) => x.eid == out.go)
    console.log(`http://${host()}/${r ? idOf(r) : out.go}`)
  }
}

let release = async (args: string[]) => {
  let [id] = args
  if (!id) throw new Error('task release <id>')
  let row = find(rows(await snapshot()), id)
  if (!row) throw new Error(`no entity: ${id}`)
  await send([{ eid: row.eid, name: 'claim', comp: null }])
  console.log(`${idOf(row)} released`)
}

// A role is DESIRED capacity, so the only honest stop is a state patch. The
// reconciler drives processes toward this row every couple of seconds, which
// means killing a pane or a tmux session is not a stop — it is a relaunch with
// extra steps. `task role stop` is therefore the whole off switch, and it is
// durable: it survives a daemon restart because the desire, not the process,
// is what got written down.
let roleOf = (all: Row[], id: string) => {
  let row = find(all, id)
  if (!row) throw new Error(`no entity: ${id}`)
  if (!row.comps.role) throw new Error(`not a role: ${id}`)
  return row
}

let roleSession = (all: Row[], eid: string) =>
  all.filter((r) => r.comps.session?.role_eid == eid)
    .sort((a, b) => a.num - b.num).at(-1)

let roleLine = (all: Row[], r: Row) => {
  let role = r.comps.role, spawn = r.comps.spawn ?? {}
  let scope = all.find((x) => x.eid == role.scope_eid)
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
    (role.error ? `\n${' '.repeat(9)}error: ${role.error}` : '')
}

let roleState = async (sub: string, rest: string[]) => {
  let want = sub == 'stop' ? 'stopped' : 'running'
  let ids = rest.filter((a) => a != '--all')
  let all = rows(await snapshot())
  let targets = rest.includes('--all')
    ? all.filter((r) => r.comps.role).sort((a, b) => a.num - b.num)
    : ids.map((id) => roleOf(all, id))
  if (!targets.length) {
    throw new Error(rest.includes('--all') ? 'no roles' : help(['role', sub]))
  }
  let moved = targets.filter((r) => r.comps.role.state != want)
  await send(
    moved.map((r) => ({ eid: r.eid, name: 'role', comp: { state: want } })),
  )
  for (let r of targets) {
    let already = !moved.includes(r) ? ' (already)' : ''
    console.log(`${idOf(r)} ${want}${already}  ${r.comps.doc?.title ?? ''}`)
  }
}

let role = async (args: string[]) => {
  let [sub, ...rest] = args
  if (sub == 'help' || sub == '--help') return console.log(help(['role']))
  if (sub == 'stop' || sub == 'start') return await roleState(sub, rest)
  if (sub && sub != '--json') {
    throw new Error(`not a role verb: ${sub}\n\n${help(['role'])}`)
  }
  let all = rows(await snapshot())
  let roles = all.filter((r) => r.comps.role).sort((a, b) => a.num - b.num)
  if (sub == '--json') {
    return console.log(JSON.stringify(
      roles.map((r) => ({
        id: idOf(r),
        title: r.comps.doc?.title ?? null,
        ...r.comps.role,
        spawn: r.comps.spawn ?? null,
        session: roleSession(all, r.eid)?.comps.session?.id ?? null,
      })),
      null,
      2,
    ))
  }
  if (!roles.length) return console.log('no roles')
  for (let r of roles) console.log(roleLine(all, r))
}

// An edge is a sentence — "<id> requires <child>" — and the comp names the
// whole triple, so link and unlink are the same Change with gone flipped.
let dep = async (args: string[]) => {
  let gone = args.includes('--gone')
  let words = args.filter((a) => a != '--gone')
  let [id, type, childId] = words
  if (!id || !type || !childId || words.length != 3) {
    throw new Error('task dep <id> <type> <child> [--gone]')
  }
  if (!edges.includes(type as Edge)) {
    throw new Error(`edge type is one of: ${edges.join(', ')}`)
  }
  let all = rows(await snapshot())
  let row = find(all, id)
  let child = find(all, childId)
  if (!row) throw new Error(`no entity: ${id}`)
  if (!child) throw new Error(`no entity: ${childId}`)
  await send([{
    eid: row.eid,
    name: 'dependency',
    comp: { type, child_eid: child.eid, ...(gone ? { gone: true } : {}) },
  }])
  console.log(`${idOf(row)} ${type} ${idOf(child)}${gone ? ' — unlinked' : ''}`)
}

// Comments attach to anything; attribution rides the session env (me()).
let comment = async (args: string[]) => {
  let verdictArg = args.find((a) => a.startsWith('--verdict='))
  let verdict = verdictArg?.slice(10)
  let [id, ...words] = args.filter((a) => !a.startsWith('--verdict='))
  let body = words.join(' ')
  if (verdictArg != null && !verdict) {
    throw new Error('--verdict needs approved, rejected, or changes_requested')
  }
  if (!id || (!body && !verdict)) {
    throw new Error('task comment <id> [text...] [--verdict=...]')
  }
  let all = rows(await snapshot())
  let row = find(all, id)
  if (!row) throw new Error(`no entity: ${id}`)
  await send(commentChanges(all, row.eid, body, me(), { verdict }))
  console.log(`${verdict ? `${verdict} review` : 'comment'} on ${idOf(row)}`)
}

let show = async (args: string[]) => {
  let json = args.includes('--json')
  let [id] = args.filter((a) => a != '--json')
  if (!id) throw new Error('task show <id> [--json]')
  let snap = await snapshot()
  let all = rows(snap)
  let row = find(all, id)
  if (!row) throw new Error(`no entity: ${id}`)
  if (json) {
    // The machine shape, unchanged forever: scripts parse this.
    let comments = all.filter((r) => r.comps.comment?.target_eid == row.eid)
    let edges = edgesOf(snap, all, row.eid)
    console.log(JSON.stringify({ ...row, ...edges, comments }, null, 2))
  } else console.log(showMd(snap, all, row))
}

// The entity's write history — the journal, one line per touching batch:
// when · who · what changed. Blame without a version table.
let past = async (args: string[]) => {
  let json = args.includes('--json')
  args = args.filter((a) => a != '--json')
  let n = Number(args.find((a) => a.startsWith('-n'))?.slice(2) ?? 0) ||
    Number(args[args.indexOf('-n') + 1] ?? 0) || 50
  let id = args.find((a) => !a.startsWith('-'))
  if (!id) throw new Error('task history <id> [-n N]')
  let all = rows(await snapshot())
  let row = find(all, id)
  if (!row) throw new Error(`no entity: ${id}`)
  let entries = await history(row.eid, n)
  if (json) return console.log(JSON.stringify(entries, null, 2))
  if (!entries.length) return console.log(`${idOf(row)}: no history`)
  for (let e of entries) console.log(historyLine(e))
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
    task = all.find((r) => r.comps.claim?.session_eid == sess.eid)
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

// A graph-declared role already names the capability the daemon launched.
// The ancestry marker is the equivalent opt-in for an ad-hoc terminal.
export let hookOperator = (role?: string, pid?: number) =>
  !!role || operatorHook(pid)

let context = async (args: string[]) => {
  let hook = args.includes('--hook')
  // Subagent mode: explicit --subagent (debug override), or the payload's
  // SubagentStart event, or a Bash-shelled `task` inside a Task-tool child
  // (CLAUDE_CODE_CHILD_SESSION). The hook branch confirms the event from
  // stdin below; SessionStart reifies a normal graph participant.
  let sub = args.includes('--subagent')
  let sid = args.find((a) => !a.startsWith('--')) ?? me()
  // The digest plus the comms bus: unseen comments ride along, and the
  // session's ack cursor advances exactly when they're printed. A reified
  // session's own meta leads as frontmatter (T-4554) — the S-num is how
  // the agent addresses its own session doc.
  let tell = async (snap: Snapshot, sid: string, scope?: string) => {
    let fm = sessionMeta(rows(snap), sid)
    let out = contextDigest(snap, sid, Date.now(), scope)
    if (fm) out = `${fm}\n${out}`
    let n = notices(snap, sid)
    if (n.lines.length) {
      await send(n.ack)
      out += noticeBlock(n.lines)
    }
    console.log(out)
  }
  if (hook) {
    try {
      let body = JSON.parse(await new Response(Deno.stdin.readable).text())
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
        let snap = await snapshot()
        let cwd = String(body.cwd ?? '') || undefined
        let agentType = String(body.agent_type ?? '') || undefined
        let s = sessionFor(rows(snap), subId, cwd, undefined, {
          agent_type: agentType,
          source: String(body.source ?? '') || undefined,
        })
        if (s.changes.length) {
          await send(s.changes)
          snap = await snapshot() // the block should see the reify
        }
        console.log(subagentDigest(snap, subId, agentType))
        return
      }
      sid ??= String(body.session_id ?? '')
      if (!sid) return
      let snap = await snapshot()
      // The generated hook names its provider; old configs recover it from
      // process ancestry. Payload model fields are metadata, never identity.
      let { model, provider, transcript } = hookDialect(body, hookProvider())
      let cwd = String(body.cwd ?? '') || undefined
      let all = rows(snap)
      let prior = all.find((r) =>
        r.comps.session && String(r.comps.session.id) == sid
      )
      let role = roleEid(all, Deno.env.get('TASKS_ROLE'))
      let pid = agentPid(provider)
      let external = prior?.comps.session?.origin != 'managed'
      let operator = external && hookOperator(role, pid)
      // The provider's transcript is the external session's durable log.
      // `provider` stays out of this CREATE: a new session carrying one is
      // a managed spawn request. It lands as a patch below.
      let s = sessionFor(
        all,
        sid,
        cwd,
        pid,
        {
          agent_type: String(body.agent_type ?? '') || undefined,
          source: String(body.source ?? '') || undefined,
          transcript,
          pane: external
            ? Deno.env.get('TMUX_PANE')?.trim() || null
            : undefined,
          // Project-wide attention is the one positive capability. Every
          // session gets the normal graph digest and direct notifications.
          operator: external ? operator : undefined,
          role_eid: role,
        },
      )
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
      if (s.changes.length || model || hc.length) snap = await snapshot()
      // The cwd names the scope directly — the reified session row may
      // not have landed in this snap yet.
      await tell(snap, sid, repoAt(rows(snap), cwd)?.eid)
    } catch {
      // silent: offline server or malformed stdin — the session goes on
    }
    return
  }
  // A manual `task context` shelled from inside a Task-tool child carries
  // CLAUDE_CODE_CHILD_SESSION — same subagent output (task block only), no
  // reify (no payload here) and no digest. --subagent forces it too.
  if ((sub || Deno.env.get('CLAUDE_CODE_CHILD_SESSION') == '1') && sid) {
    let snap = await snapshot()
    let sess = rows(snap).find((r) =>
      r.comps.session && String(r.comps.session.id) == sid
    )
    let agentType = sess?.comps.session?.agent_type
    return console.log(
      subagentDigest(snap, sid, agentType ? String(agentType) : undefined),
    )
  }
  // Bare = the preview: what a fresh session would boot with, scoped to
  // the repo you stand in — or to a named project (task context P-20).
  // Read-only — no session is reified, no bus cursor moves.
  let snap = await snapshot()
  let all = rows(snap)
  let named = sid ? find(all, sid) : undefined
  if (named?.comps.project) {
    return console.log(contextDigest(snap, undefined, Date.now(), named.eid))
  }
  if (!sid) {
    let at = repoAt(all, Deno.cwd())
    return console.log(contextDigest(snap, undefined, Date.now(), at?.eid))
  }
  // S-12 (or its eid) names the session ENTITY; the id string inside it
  // is the identity every tool speaks. Anything else that resolves is a
  // mistake — and a ref-shaped miss (T-99) is a typo, never a new
  // session's name.
  if (named?.comps.session) {
    return await tell(snap, String(named.comps.session.id))
  }
  if (named) throw new Error(`${sid} is a ${named.kind}, not a session`)
  if (/^[A-Za-z]+-\d+$/.test(sid)) throw new Error(`no entity: ${sid}`)
  // A raw sid REIFIES (T-4554): a hand-made session — codex, a foreign
  // harness — gets its entity and digest without simulating the hook's
  // JSON. An existing session stays a pure read: refreshing cwd/pid from
  // whoever happens to preview it would corrupt the row.
  if (!all.some((r) => r.comps.session && String(r.comps.session.id) == sid)) {
    // The pid is THIS process's claude, so it may only be stamped when
    // the sid names THIS process's conversation. A subagent is a tool
    // call INSIDE the operator's claude (CLAUDE_CODE_CHILD_SESSION=1,
    // and its CLAUDE_CODE_SESSION_ID is the operator's) — a child that
    // mints its own id would otherwise hang a second row on the
    // operator's process, and a pid with two rows is an ambiguous door
    // (T-7279, T-7288). A child session has no process of its own to
    // claim; the SubagentStart hook already stamps none.
    let own = !Deno.env.get('CLAUDE_CODE_CHILD_SESSION') &&
      Deno.env.get('CLAUDE_CODE_SESSION_ID') == sid
    let role = roleEid(all, Deno.env.get('TASKS_ROLE'))
    let s = sessionFor(
      all,
      sid,
      Deno.cwd(),
      own ? claudePid() : undefined,
      { role_eid: role },
    )
    await send(s.changes)
    snap = await snapshot()
  }
  await tell(snap, sid)
}

// Turn hooks say when a native composer is safe to address. The state is a
// hint about this session's own terminal, so a hook may write it like pid and
// pane; the delivery adapter still revalidates all three before touching tmux.
let sessionTurn = async (args: string[]) => {
  let hook = args.includes('--hook')
  let words = args.filter((a) => !a.startsWith('--'))
  try {
    let body: Record<string, unknown> = {}
    if (hook) {
      body = JSON.parse(await new Response(Deno.stdin.readable).text())
    }
    let turn = hook
      ? hookTurn(body)
      : words.find((w) => /^(idle|busy)$/.test(w))
    let sid = String(body.session_id ?? '') ||
      words.find((w) => w != turn) ||
      me()
    if (!sid || !turn) {
      if (hook) return
      throw new Error('task session turn <idle|busy> [sid]')
    }
    let all = rows(await snapshot())
    let sess = all.find((r) =>
      r.comps.session && String(r.comps.session.id) == sid
    )
    if (!sess || sess.comps.session.turn == turn) return
    await send([{
      eid: sess.eid,
      name: 'session',
      comp: { turn },
    }])
    if (!hook) console.log(`${idOf(sess)} turn ${turn}`)
  } catch (e) {
    if (!hook) throw e
  }
}

// Save a memory: doc + memory comp, stamped via the calling session — the
// CLI face of MCP memory_save, so headless agents (the scribe first) have
// the door too.
let remember = async (args: string[]) => {
  let flag = (n: string) =>
    args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
  let title = args.filter((a) => !a.startsWith('--')).join(' ').trim()
  if (!title) throw new Error('task remember <title...> (the index line)')
  let session = me()
  if (!session) throw new Error('remember: no session identity (attribution)')
  let all = rows(await snapshot())
  let body = flag('body')
  if (body?.startsWith('@')) {
    body = String(inflate({ comp: 'doc', prop: 'body', value: body }).value)
  }
  let made = memoryChanges(all, {
    title,
    body,
    type: flag('type'),
    scope: flag('scope'),
    session,
  })
  await send(made.changes)
  let after = rows(await snapshot()).find((r) => r.eid == made.eid)
  console.log(`${after ? idOf(after) : made.eid} remembered`)
  let hint = await similarHint(`${title}\n${body ?? ''}`, made.eid)
  if (hint) console.log(hint)
}

// SessionEnd's mirror of context: drop everything the session holds.
// --hook mode (stdin JSON, silent failure) wires it to the lifecycle.
let wrap = async (args: string[]) => {
  let hook = args.includes('--hook')
  let sid = args.find((a) => !a.startsWith('--')) ?? me()
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
    let changes = wrapChanges(
      rows(await snapshot()),
      sid,
      Date.now(),
      entries,
      final,
    )
    if (changes.length) await send(changes)
    if (!hook) {
      console.log(
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
let sessionBrief = async (args: string[]) => {
  let flags = args.filter((a) => a.startsWith('--'))
  let words = args.filter((a) => !a.startsWith('--'))
  let sid = me()
  if (!sid) throw new Error('session brief: run under a session (no identity)')
  let body = await bodyOf(flags, words)
  if (!body) {
    throw new Error(
      'a brief needs words: text, --body=@file, or --body=- with stdin',
    )
  }
  let all = rows(await snapshot())
  let sess = all.find((r) =>
    r.comps.session && String(r.comps.session.id) == sid
  )
  if (!sess) {
    throw new Error(`no session entity for ${sid} — task session context first`)
  }
  // Keep a hand-set title; name a nameless one the way wrap would.
  let day = new Date().toISOString().slice(0, 10)
  let title = String(sess.comps.doc?.title || `Work session ${day}`)
  await send([{ eid: sess.eid, name: 'doc', comp: { title, body } }])
  console.log(`${idOf(sess)} brief written`)
}

// Session-lifecycle verbs live here — root `task context` / `task wrap`
// stay as quiet aliases: hook lines in the wild call them (T-4554).
let session = (args: string[]) => {
  let [sub, ...rest] = args
  if (sub == 'context') return context(rest)
  if (sub == 'wrap') return wrap(rest)
  if (sub == 'brief') return sessionBrief(rest)
  if (sub == 'turn') return sessionTurn(rest)
  if (!sub || sub == 'help' || sub == '--help') {
    return console.log(help(['session']))
  }
  throw new Error(`not a session verb: ${sub}\n\n${help(['session'])}`)
}

// What the tools have been doing: MCP calls, HTTP writes and browser
// crashes, newest first. --errors is the view you want most days.
let telemetry = async (args: string[]) => {
  let q = new URLSearchParams()
  if (args.includes('--errors')) q.set('only', 'errors')
  let since = args.find((a) => a.startsWith('--since='))
  if (since) q.set('since', since.slice(8))
  let n = args.indexOf('-n')
  if (n >= 0 && args[n + 1]) q.set('limit', args[n + 1])
  let res = await request(`http://${host()}/telemetry?${q}`)
  if (!res.ok) throw new Error(`server said ${res.status}`)
  let rows = await res.json() as Log[]
  if (!rows.length) return console.error('(nothing recorded)')
  for (let r of rows) {
    console.log(
      `${r.ts}  ${r.source.padEnd(4)} ${r.name.padEnd(14)} ${
        r.ok ? 'ok ' : 'ERR'
      } ${(r.ms == null ? '' : `${r.ms}ms`).padStart(6)}  ${
        (r.session_id ?? '-').padEnd(10)
      }  ${(r.error ?? '').slice(0, 80)}`,
    )
  }
}

// Backup is bin/backup (a data-dir git commit) — the CLI is its front
// door so 'task backup' works wherever the CLI is installed.
// Materialize every persona into its project repo's .tasks/ — write
// only what changed, then commit the paths git already tracks (git.ts
// keeps that safe; --no-commit stops at the write, for a look before
// anything lands). The server's effect keeps files fresh on graph
// changes; this verb is the explicit door — the first sync of a new
// repo, or the committed story until the permission-gated actuator
// (T-3926) owns it.
let sync = async (args: string[]) => {
  let snap = await snapshot()
  let files = filesFor(rows(snap), snap.deps, Date.now())
  if (!files.length) {
    return console.log('no personas with a homed repo — nothing to write')
  }
  let { written, failed } = syncFiles(files)
  for (let p of written) console.log(`wrote ${p}`)
  for (let f of failed) console.error(`failed ${f}`)
  if (!written.length && !failed.length) console.log('all fresh')
  if (args.includes('--no-commit')) return
  // Every path, not just this run's writes: a file left dirty by an
  // earlier sync (or adopted with `git add` since) lands here too.
  let done = await commit(files.map((f) => f.path), 'personas: materialize')
  for (let root of done.committed) console.log(`committed ${root}`)
  for (let p of done.untracked) console.log(`untracked ${p} — git add to adopt`)
  for (let f of done.failed) console.error(`commit failed ${f}`)
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

let terminalScope = (args: string[], pid: number) => {
  let end = args.indexOf('--')
  if (end < 0) end = args.length
  let operator = args.slice(0, end).includes('--operator')
  return {
    args: args.filter((a, i) => a != '--operator' || i >= end),
    env: {
      TASKS_OPERATOR: operator ? String(pid) : '',
      TASKS_TASK: '',
      CLAUDE_CODE_CHILD_SESSION: '',
    },
  }
}

export let claudeLaunch = (
  args: string[],
  listed: boolean,
  pid = Deno.pid,
  cwd = Deno.cwd(),
) => {
  let scope = terminalScope(args, pid)
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

let claude = async (args: string[]) => {
  // Allowlisted in root's managed settings → clean launch; otherwise the
  // dev-load flag activates the channel behind a press-Enter dialog —
  // fine at a keyboard, which is the only place this verb runs.
  let listed = false
  try {
    listed = Deno.readTextFileSync('/etc/claude-code/managed-settings.json')
      .includes('"tasks-fleet"')
  } catch { /* no managed settings — dev-load below */ }
  let launch = claudeLaunch(args, listed)
  await terminal('claude', launch.args, launch.env)
}

// Full access matches the interactive Claude posture; lifecycle hooks bind
// the provider thread to the graph. Every other Codex argument keeps order.
export let codexLaunch = (args: string[], pid = Deno.pid) => {
  let scope = terminalScope(args, pid)
  return {
    args: [
      '--dangerously-bypass-approvals-and-sandbox',
      '--dangerously-bypass-hook-trust',
      ...codexHookArgs(),
      ...scope.args,
    ],
    env: scope.env,
  }
}

export let codexArgs = (args: string[]) => codexLaunch(args).args

let codex = async (args: string[]) => {
  let launch = codexLaunch(args)
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

// Only run the CLI when invoked as the program — importing this module (e.g.
// from tests) must not dispatch a command or call Deno.exit.
if (import.meta.main) {
  let [cmd, ...rest] = Deno.args
  try {
    let asked = requestedHelp(Deno.args)
    if (asked != null) console.log(asked)
    else {
      let routed = subject(cmd, rest)
      if (routed) {
        cmd = routed.cmd
        rest = routed.args
      }
      let selected = route(cmd, rest)
      if (selected) {
        validate(selected.name, selected.manual, selected.args)
        // A deprecated verb still WORKS — this is a signpost, not a gate.
        // It has to fire on the RUN: the only people still typing one are
        // acting from habit, and they never read the help. stderr, because
        // stdout is what the caller asked for and is usually piped.
        if (selected.manual.deprecated) {
          console.error(
            `task ${selected.name}: deprecated — ${selected.manual.deprecated}`,
          )
        }
      } else if (cmd?.startsWith(':')) {
        validateCommand(cmd.slice(1), rest)
      } else if (rest[0]?.startsWith(':')) {
        validateCommand(rest[0].slice(1), rest.slice(1))
      } else if (cmd && commands[cmd]) {
        validateCommand(cmd, rest)
      }
      if (cmd?.startsWith(':')) await colon(undefined, [cmd, ...rest])
      else if (cmd == 'tui') await tui()
      else if (cmd == 'claude') await claude(rest)
      else if (cmd == 'codex') await codex(rest)
      else if (cmd == 'list' || cmd == 'ls') await list(rest)
      else if (cmd == 'new') await create(rest)
      else if (cmd == 'set') await set(rest)
      else if (cmd == 'show') await show(rest)
      else if (cmd == 'history') await past(rest)
      else if (cmd == 'search') await seek(rest)
      else if (cmd == 'mail') await mail(rest)
      else if (cmd == 'inbox') await inbox(rest)
      else if (cmd == 'session') await session(rest)
      else if (cmd == 'claim') await claim(rest)
      else if (cmd == 'spawn') await spawn(rest)
      else if (cmd == 'comment') await comment(rest)
      else if (cmd == 'dep') await dep(rest)
      else if (cmd == 'backup') await backup()
      else if (cmd == 'remember') await remember(rest)
      else if (cmd == 'context') await context(rest)
      else if (cmd == 'wrap') await wrap(rest)
      else if (cmd == 'sync') await sync(rest)
      else if (cmd == 'release') await release(rest)
      else if (cmd == 'role') await role(rest)
      else if (cmd == 'telemetry') await telemetry(rest)
      else if (cmd == 'help' || cmd == '--help') console.log(help(rest))
      else if (!cmd) await bare()
      // `task T-42 :done` — an id ahead of a colon line names the focus.
      else if (rest[0]?.startsWith(':')) await colon(cmd, rest)
      // CLI verbs win shared names; the remaining palette words may omit `:`.
      else if (cmd && commands[cmd]) await colon(undefined, [cmd, ...rest])
      else {
        console.log(usage())
        Deno.exit(2)
      }
    }
  } catch (e) {
    console.error(`task: ${(e as Error).message} (server: ${host()})`)
    Deno.exit(1)
  }
}
