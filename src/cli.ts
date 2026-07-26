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
  mailNotified,
  me,
  memoryChanges,
  notices,
  type Param,
  param,
  patches,
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
import { FILTERS, GRAMMAR } from './grammar.ts'
import { type Edge, edges, prio, type Snapshot } from './types.ts'
// `import type` (not the repo's usual inline `{ type X }`): telemetry.ts
// reaches for node:sqlite, and the CLI has no business loading a db driver.
import type { Log } from './telemetry.ts'
import type { JournalEntry } from './client.ts'
import { agentPid, claudePid } from './proc.ts'
import { filesFor, syncFiles } from './persona.ts'
import { commit } from './git.ts'
import { commands, focusOf, run as runCommand } from './commands.ts'

// Every verb: usage, blurb, worked examples. `task help` derives all its
// faces from this table plus grammar.ts, so what the CLI teaches and what
// it accepts are the same text — extend the table, every door updates.
type Verb = [usage: string, blurb: string, examples: string[]]

let VERBS: Verb[] = [
  ['tui', 'open the terminal UI', []],
  [
    'claude [claude args...]',
    'interactive claude, fleet-wired: skip-permissions + the tasks channel',
    ['task claude', 'task claude --continue'],
  ],
  [
    'codex [codex args...]',
    'interactive codex, fleet-wired: full access + the tasks lifecycle',
    ['task codex', 'task codex resume --last'],
  ],
  ['list [filters...] [--json]', 'list tasks (filter grammar)', [
    'task list .status=open .priority<=1',
    'task list .project=harness .updated.at>="1 week ago"',
    'task list .assignee=jeff --json',
  ]],
  ['new .title="..." [...]', 'create a task (bare words become the title)', [
    'task new P1 .project=holdco Fix the flux capacitor',
    'task new .title="Write the digest" .body="Details..." .domain=Eng',
  ]],
  [
    'set <id> .prop=value ... [--comment=words]',
    'patch any entity; --comment says why, as plain commentary, same batch',
    [
      'task set T-3 .status=done --comment="verified end-to-end"',
      'task set T-3 .assignee=jeff .priority=1',
      'task set S-12 ".body=@brief.md"   # @ = the CLI reads the file itself',
    ],
  ],
  ['show <id> [--json]', 'one entity as a document (--json for scripts)', [
    'task show T-3',
    'task show T-3 --json',
  ]],
  ['history <id> [-n N] [--json]', "the entity's write history (journal)", [
    'task history T-3 -n 10',
  ]],
  ['search <words...> [--json]', 'full-text search (trailing * = prefix)', [
    'task search flux capac*',
    'task search .project=holdco deploy',
  ]],
  [
    'mail [filters|show|send|reply|search|files|doctor]',
    'fleet mail: bare = your unread inbox; task mail --help spells the family',
    [
      'task mail',
      'task mail show E-9',
      'task mail send jeff Subject words --body=@draft.md',
      'task mail reply E-9 "on it — landing today"',
    ],
  ],
  [
    'inbox [show <id> | archive <id>]',
    'everything addressed to you (comments, knocks, mail); archive to hide',
    [
      'task inbox',
      'task inbox show E-9   # marks it opened',
      'task inbox archive E-9',
    ],
  ],
  ['claim <id> [session]', 'lease a task (default: your own session id)', [
    'task claim T-3 my-session-id',
  ]],
  ['release <id>', 'drop the lease', ['task release T-3']],
  [
    'spawn <id> [--provider=X] [--model=Y] [--effort=Z] [--persona=P-9]',
    "dispatch a managed agent onto a task (defaults: your session's own)",
    ['task spawn T-3', 'task spawn T-3 --provider=codex --model=gpt-5.4'],
  ],
  ['comment <id> <text...>', 'say something about ANY entity', [
    'task comment T-3 "blocked on the schema call"',
    'task comment S-31 "status?"   # commenting on a session IS messaging it',
  ]],
  [
    'dep <id> <type> <child> [--gone]',
    'link (--gone unlinks) an edge: requires | contains | reads | about',
    ['task dep T-3 requires T-9', 'task dep T-3 requires T-9 --gone'],
  ],
  ['backup', 'snapshot the db + commit/push the data dir', []],
  [
    'sync [--no-commit]',
    "materialize personas into each project repo's .tasks/ (and commit)",
    ['task sync', 'task sync --no-commit'],
  ],
  [
    'remember <title...> [--body=…] [--type=feedback|project] [--scope=P-9]',
    'save a memory: the title is the index line, the body the lesson',
    [
      'task remember "pipe a gate, lose its exit code" --type=feedback --scope=P-19',
    ],
  ],
  [
    'session <context|wrap|brief> …',
    'the session lifecycle: boot digest, wrap, self-authored brief',
    [
      'task session context             # your digest (bare = preview)',
      'task session context my-sess-id  # a raw sid reifies, by hand',
      'task session brief --body=@-     # your narrative → the session doc',
      'task session wrap',
    ],
  ],
  ['telemetry [--errors] [--since=ISO] [-n N]', 'tool calls + crashes', [
    'task telemetry --errors -n 20',
  ]],
  [
    'wake <who> <when...> [target]',
    'a knock on a timer: the row outlives every process, so it still lands',
    [
      'task wake S-31 in 60m',
      'task wake homelab "9am tomorrow" T-42',
      'task wake jeff after 8 hours',
    ],
  ],
  [
    ':<command> … | <id> :<command> …',
    "the web bar's `:` vocabulary — same table, same words (task help :); " +
    'the colon is optional for a verb no CLI name of its own claims',
    [
      'task :fix T-42',
      'task :new P1 ship the fix',
      'task T-42 :done',
      'task :done   # your claim is the focus',
    ],
  ],
  ['help [verb|grammar|:]', 'this text; grammar = filters + dot-params', [
    'task help list',
    'task help grammar',
    'task help :fix',
  ]],
]

// Aliases stay out of the menu, but their own help must admit and explain
// them. New callers should learn the canonical spellings.
let ALIASES: Verb[] = [
  [
    'ls [filters...] [--json]',
    'legacy alias for task list',
    ['task list .status=open'],
  ],
  [
    'context [sid] [--hook]',
    'legacy alias for task session context',
    ['task session context'],
  ],
  [
    'wrap [sid] [--hook]',
    'legacy alias for task session wrap',
    ['task session wrap'],
  ],
]

let cliVerbs = new Set(
  [...VERBS, ...ALIASES].map(([u]) => u.split(' ')[0]),
)

let usage = `task — the entity graph, from a shell

${
  VERBS.map(([u, b]) =>
    u.length > 29
      ? `  task ${u}\n${' '.repeat(38)}${b}`
      : `  task ${u.padEnd(29)}  ${b}`
  ).join('\n')
}

dot-params route by prop (.title= → doc.title); where a prop lives in
several components (pin/camera x,y,w,h) spell it out: .pin.x=12
'task help grammar' spells the whole filter grammar; 'task help <verb>'
shows examples.
`

let help = (args: string[]) => {
  let [topic] = args
  if (!topic) return console.log(usage.trim())
  if (topic == 'grammar') {
    return console.log(`${GRAMMAR}\n\n${FILTERS}`)
  }
  // The `:` vocabulary teaches from its own table — the one the web bar
  // and TUI run — so the shell can never describe a command it doesn't
  // share. `task help :` is the menu, `task help :fix` one entry.
  if (topic.startsWith(':')) {
    let name = topic.slice(1)
    let show = name ? { [name]: commands[name] } : commands
    if (name && !commands[name]) {
      throw new Error(`not a command: ${name} (task help : lists them)`)
    }
    return console.log(
      Object.entries(show)
        .map(([n, c]) =>
          `task :${`${n} ${c.args}`.trim().padEnd(34)} ${c.about}`
        )
        .join('\n'),
    )
  }
  let hit = [...VERBS, ...ALIASES].find(([u]) => u.split(' ')[0] == topic)
  if (!hit) throw new Error(`no such verb: ${topic} (task help lists them)`)
  let [u, b, examples] = hit
  console.log(`task ${u}\n  ${b}`)
  if (examples.length) {
    console.log(`\n${examples.map((e) => `  ${e}`).join('\n')}`)
  }
}

// A selected verb owns every option-shaped arg before it can touch the
// graph. Passthrough launchers and `task new` stay out: claude/codex own
// their flags, while new has its more useful --flag → .param correction.
let options: Record<string, RegExp[]> = {
  list: [/^--json$/],
  ls: [/^--json$/],
  set: [/^--comment=.*$/],
  show: [/^--json$/],
  history: [/^--json$/, /^-n\d*$/],
  search: [/^--json$/],
  mail: [/^--json$/, /^--all$/, /^--sent$/],
  'mail show': [/^--json$/],
  'mail send': [/^--body=.*$/, /^--from=.*$/],
  'mail reply': [/^--body=.*$/, /^--from=.*$/],
  'mail files': [/^--out(?:=.*)?$/],
  inbox: [/^--json$/],
  'inbox show': [/^--json$/],
  'session context': [/^--hook$/, /^--subagent$/],
  'session wrap': [/^--hook$/],
  'session brief': [/^--body=.*$/],
  spawn: [
    /^--provider=.*$/,
    /^--model=.*$/,
    /^--effort=.*$/,
    /^--persona=.*$/,
  ],
  dep: [/^--gone$/],
  remember: [/^--body=.*$/, /^--type=.*$/, /^--scope=.*$/],
  context: [/^--hook$/, /^--subagent$/],
  wrap: [/^--hook$/],
  sync: [/^--no-commit$/],
  telemetry: [/^--errors$/, /^--since=.*$/, /^-n\d*$/],
}

let leaf = (cmd: string | undefined, args: string[]) => {
  if (!cmd) return
  let subs: Record<string, string[]> = {
    mail: ['show', 'send', 'reply', 'search', 'files', 'doctor'],
    inbox: ['show', 'archive'],
    session: ['context', 'wrap', 'brief'],
  }
  let sub = args[0]
  return subs[cmd]?.includes(sub) ? `${cmd} ${sub}` : cmd
}

let option = (arg: string) =>
  arg != '--' && (arg.startsWith('--') || /^-[A-Za-z]/.test(arg))

let optionName = (arg: string) =>
  arg.startsWith('--') ? arg.split('=')[0] : arg.slice(0, 2)

let rejectOptions = (verb: string | undefined, args: string[]) => {
  if (
    !verb || ['claude', 'codex', 'new'].includes(verb) ||
    verb.startsWith(':') || (commands[verb] && !cliVerbs.has(verb)) ||
    args[0]?.startsWith(':')
  ) return
  let allow = options[verb] ?? []
  let bad = args.find((a) => option(a) && !allow.some((p) => p.test(a)))
  if (!bad) return
  let name = optionName(bad)
  if ((verb == 'wrap' || verb == 'session wrap') && name == '--body') {
    throw new Error(
      "wrap takes no --body — did you mean 'task session brief --body=…'?",
    )
  }
  throw new Error(`${verb} does not take ${name}`)
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
  words[0]?.match(/^[Pp]\d+$/)
    ? { words: words.slice(1), priority: prio(words[0])! }
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
  if (!id || !params.length) throw new Error('task set <id> .prop=value ...')
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

let MAIL_USAGE = `task mail — fleet mail in the graph
  task mail [filters...]            your unread inbox, newest last
  task mail --all | --sent          the fleet's mail / outbound only
  task mail show <id>               the mail + its thread; marks it read
  task mail send <to> <subj...> --body=@f|@- [--from=...]  (@- = piped stdin)
  task mail reply <id> [text... | --body=@f|@-]
  task mail search <words...>       full-text search, mail only
  task mail files <id> [--out DIR]  download attachments
  task mail doctor                  every book address vs the CF rules
<to> is a raw address or a graph reference (alias, P-9, eid) — the
address book resolves at delivery. Filters speak the query grammar:
  task mail --all .from~=stripe .verified=0`

// The body, by preference: --body= (@file reads the file — the safe
// door for long prose; @- reads piped stdin), then the trailing words.
// stdin is never read implicitly: a harness holding the pipe open but
// silent would hang the send forever (observed live, T-5854) and no
// guard can tell that pipe from a slow one — so @- is the deliberate
// ask, and a missing body fails fast instead of blocking. Shared by
// mail send/reply and the session brief — one body door, every verb.
let bodyOf = async (flags: string[], words: string[]) => {
  let b = flags.find((a) => a.startsWith('--body='))?.slice(7)
  if (b == '@-') {
    if (Deno.stdin.isTerminal()) {
      throw new Error('--body=@-: stdin is a TTY — pipe the body in')
    }
    return (await new Response(Deno.stdin.readable).text()).trim()
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
      if (!p) throw new Error(`not a mail filter: ${a}\n\n${MAIL_USAGE}`)
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
      sent
        ? '(nothing sent)'
        : every
        ? '(no mail)'
        : '(no unread mail — task mail --all sees everything)',
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
  if (!id) throw new Error(`task mail show <id>\n\n${MAIL_USAGE}`)
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
    throw new Error(`task mail send <to> <subject...>\n\n${MAIL_USAGE}`)
  }
  let body = await bodyOf(flags, [])
  if (!body) {
    throw new Error(
      'a mail needs a body: --body=@file, or --body=@- with piped stdin',
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
  if (!id) throw new Error(`task mail reply <id> [text...]\n\n${MAIL_USAGE}`)
  let all = rows(await snapshot())
  let row = find(all, id)
  if (!row?.comps.mail) throw new Error(`not a mail: ${id}`)
  let body = await bodyOf(flags, text)
  if (!body) {
    throw new Error(
      'a reply needs words: text, --body=@file, or --body=@- with stdin',
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
  if (!id) throw new Error(`task mail files <id> [--out DIR]\n\n${MAIL_USAGE}`)
  let door = `http://${host()}/mail/${encodeURIComponent(id)}/files`
  let res = await fetch(door)
  if (!res.ok) throw new Error(await res.text())
  let { message_id, files } = await res.json() as {
    message_id: string
    files: { name: string; size: number }[]
  }
  if (!files.length) return console.log(`no attachments for ${id}`)
  out ??= `mail-attachments/${message_id.replace(/[^\w.-]/g, '_')}`
  Deno.mkdirSync(out, { recursive: true })
  for (let f of files) {
    let r = await fetch(`${door}/${encodeURIComponent(f.name)}`)
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
  if (!q) throw new Error(`task mail search <words...>\n\n${MAIL_USAGE}`)
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
  if (sub == 'help' || sub == '--help') return console.log(MAIL_USAGE)
  return mailList(args)
}

// ---- task inbox: everything addressed to you — comments on your session
// and claimed tasks, knocks at your door, project mail — filtered to what
// you haven't archived (T-7006). `show` marks an item opened (reading IS
// the mark); `archive` is the ONE act that hides. Generalizes `task mail`.
let INBOX_USAGE = `task inbox — your notification inbox in the graph
  task inbox [--json]              everything addressed to you, unread first
  task inbox show <id> [--json]    the item whole; marks it opened
  task inbox archive <id>          hide it — the one act that removes it`

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
  if (!id) throw new Error(`task inbox show <id>\n\n${INBOX_USAGE}`)
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
  if (!id) throw new Error(`task inbox archive <id>\n\n${INBOX_USAGE}`)
  let row = find(rows(await snapshot()), id)
  if (!row) throw new Error(`no such entity: ${id}`)
  await send([{ eid: row.eid, name: 'archived', comp: {} }])
  console.log(`archived ${idOf(row)}`)
}

let inbox = (args: string[]) => {
  let [sub, ...rest] = args
  if (sub == 'show') return inboxShow(rest)
  if (sub == 'archive') return inboxArchive(rest)
  if (sub == 'help' || sub == '--help') return console.log(INBOX_USAGE)
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
    let table = await (await fetch(`http://${host()}/providers`)).json() as {
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

// An edge is a sentence — "<id> requires <child>" — and the comp names the
// whole triple, so link and unlink are the same Change with gone flipped.
let dep = async (args: string[]) => {
  let gone = args.includes('--gone')
  let [id, type, childId] = args.filter((a) => a != '--gone')
  if (!id || !type || !childId) {
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
  let [id, ...words] = args
  let body = words.join(' ')
  if (!id || !body) throw new Error('task comment <id> <text...>')
  let all = rows(await snapshot())
  let row = find(all, id)
  if (!row) throw new Error(`no entity: ${id}`)
  await send(commentChanges(all, row.eid, body, me()))
  console.log(`commented on ${idOf(row)}`)
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

// Codex announces its model in the hook payload. Claude's payload does not,
// so its transcript remains the evidence for both provider and model.
export let hookDialect = (body: Record<string, unknown>) => {
  let codexModel = String(body.model ?? '')
  let provider = codexModel ? 'codex' : 'claude'
  let transcript = String(body.transcript_path ?? '') || undefined
  return {
    provider,
    model: codexModel || modelOf(transcript ?? ''),
    transcript,
  }
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

let context = async (args: string[]) => {
  let hook = args.includes('--hook')
  // Subagent mode: explicit --subagent (debug override), or the payload's
  // SubagentStart event, or a Bash-shelled `task` inside a Task-tool child
  // (CLAUDE_CODE_CHILD_SESSION). Operator mode (SessionStart / bare) is
  // unchanged. The hook branch confirms the event from stdin below.
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
    // The digest's mail line is a notification door — stamp `notified` on the
    // letters it surfaces so the channel plugin won't re-ring them (T-7010).
    let mailStamps = mailNotified(snap, sid, scope)
    if (mailStamps.length) await send(mailStamps)
    let n = notices(snap, sid)
    if (n.lines.length) {
      await send(n.ack)
      out += '\n## while you were away\n' +
        n.lines.map((l) => `- ${l}`).join('\n')
    }
    console.log(out)
  }
  if (hook) {
    try {
      let body = JSON.parse(await new Response(Deno.stdin.readable).text())
      // The payload disambiguates the two hooks wired to this one line:
      // SubagentStart → subagent mode; SessionStart (anything else) →
      // the operator digest below, untouched.
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
      // Codex names its model in the hook payload; Claude names it only
      // after its transcript has an assistant turn. The provider decides
      // which transcript and process fields are meaningful.
      let { model, provider, transcript } = hookDialect(body)
      let cwd = String(body.cwd ?? '') || undefined
      // The provider's transcript is the external session's durable log.
      // `provider` stays out of this CREATE: a new session carrying one is
      // a managed spawn request. It lands as a patch below.
      let s = sessionFor(
        rows(snap),
        sid,
        cwd,
        agentPid(provider),
        {
          agent_type: String(body.agent_type ?? '') || undefined,
          source: String(body.source ?? '') || undefined,
          transcript,
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
    let s = sessionFor(all, sid, Deno.cwd(), own ? claudePid() : undefined)
    await send(s.changes)
    snap = await snapshot()
  }
  await tell(snap, sid)
}

// Save a memory: doc + memory comp, source-attributed to the calling
// session — the CLI face of MCP memory_save, so headless agents (the
// scribe first) have the door too.
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
// trailing words, --body=@file, --body=@- (piped stdin). Another
// session's doc is task set's job (task set S-12 .body=@brief.md).
let sessionBrief = async (args: string[]) => {
  let flags = args.filter((a) => a.startsWith('--'))
  let words = args.filter((a) => !a.startsWith('--'))
  let sid = me()
  if (!sid) throw new Error('session brief: run under a session (no identity)')
  let body = await bodyOf(flags, words)
  if (!body) {
    throw new Error(
      'a brief needs words: text, --body=@file, or --body=@- with stdin',
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
let SESSION_USAGE = `task session — the lifecycle of the session you are
  task session context [sid] [--hook]   reify + digest (the SessionStart
                                        hook); a raw sid mints the entity
  task session wrap [sid] [--hook]      over: release claims, capture the
                                        brief (the SessionEnd hook)
  task session brief [text... | --body=@f|@-]
                                        write your own brief (survives wrap)`

let session = (args: string[]) => {
  let [sub, ...rest] = args
  if (
    ['context', 'wrap', 'brief'].includes(sub) &&
    (rest.includes('--help') || rest.includes('-h'))
  ) {
    return console.log(SESSION_USAGE)
  }
  if (sub == 'context') return context(rest)
  if (sub == 'wrap') return wrap(rest)
  if (sub == 'brief') return sessionBrief(rest)
  if (!sub || sub == 'help' || sub == '--help') {
    return console.log(SESSION_USAGE)
  }
  throw new Error(`not a session verb: ${sub}\n\n${SESSION_USAGE}`)
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
  let res = await fetch(`http://${host()}/telemetry?${q}`)
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
// plugin binds by that pid, so service follows each rotation. Nothing to
// mint here — the env passes through unchanged.
let terminal = async (command: string, args: string[]) => {
  let { code } = await new Deno.Command(command, {
    args,
    env: { TASKS_HOST: host() },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).output()
  Deno.exit(code)
}

let CHANNEL = 'plugin:tasks@tasks-fleet'
let claude = async (args: string[]) => {
  // Allowlisted in root's managed settings → clean launch; otherwise the
  // dev-load flag activates the channel behind a press-Enter dialog —
  // fine at a keyboard, which is the only place this verb runs.
  let listed = false
  try {
    listed = Deno.readTextFileSync('/etc/claude-code/managed-settings.json')
      .includes('"tasks-fleet"')
  } catch { /* no managed settings — dev-load below */ }
  await terminal('claude', [
    '--dangerously-skip-permissions',
    '--channels',
    CHANNEL,
    ...(listed ? [] : ['--dangerously-load-development-channels', CHANNEL]),
    ...args,
  ])
}

// The Codex twin: full access matches the interactive Claude posture;
// project hooks bind its thread to the graph at start and wrap it
// at exit. Every other Codex argument stays in the caller's order.
export let codexArgs = (args: string[]) => [
  '--dangerously-bypass-approvals-and-sandbox',
  '--dangerously-bypass-hook-trust',
  ...args,
]

let codex = (args: string[]) => terminal('codex', codexArgs(args))

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
    let asksHelp = rest.includes('--help') || rest.includes('-h')
    if (!asksHelp) rejectOptions(leaf(cmd, rest), rest)
    if (cmd?.startsWith(':')) await colon(undefined, [cmd, ...rest])
    // `<verb> --help` shows the verb's help, not the verb run with a stray flag.
    // mail/inbox/session own their own richer --help, so let them through.
    else if (
      cmd && cmd != 'mail' && cmd != 'inbox' && cmd != 'session' &&
      (rest.includes('--help') || rest.includes('-h'))
    ) {
      help([cmd])
    } else if (cmd == 'tui') await tui()
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
    else if (cmd == 'telemetry') await telemetry(rest)
    else if (cmd == 'help' || cmd == '--help') help(rest)
    // `task T-42 :done` — an id ahead of a colon line names the focus.
    else if (rest[0]?.startsWith(':')) await colon(cmd, rest)
    // Anything left that the shared table knows is that verb, colon
    // optional: `task wake homelab in 60m` is `task :wake …`. The verbs
    // above win the name — this is the tail of the chain, so a CLI verb
    // never loses its own spelling to the palette's.
    else if (cmd && commands[cmd]) await colon(undefined, [cmd, ...rest])
    else {
      console.log(usage.trim())
      if (cmd) Deno.exit(2)
    }
  } catch (e) {
    console.error(`task: ${(e as Error).message} (server: ${host()})`)
    Deno.exit(1)
  }
}
