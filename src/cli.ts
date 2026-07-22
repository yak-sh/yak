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
  inflate,
  memoryChanges,
  notices,
  type Param,
  param,
  patches,
  rows,
  search,
  send,
  sessionFor,
  showMd,
  similarHint,
  snapshot,
  spawnChanges,
  spawnDefaults,
  taskChanges,
  wrapChanges,
} from './client.ts'
import { matchQuery, pred, resolveRefs } from './query.ts'
import { FILTERS, GRAMMAR } from './grammar.ts'
import { type Edge, edges, type Snapshot } from './types.ts'
// `import type` (not the repo's usual inline `{ type X }`): telemetry.ts
// reaches for node:sqlite, and the CLI has no business loading a db driver.
import type { Log } from './telemetry.ts'
import type { JournalEntry } from './client.ts'
import { filesFor, syncFiles } from './persona.ts'
import { commands, focusOf, run as runCommand } from './commands.ts'

// Every verb: usage, blurb, worked examples. `task help` derives all its
// faces from this table plus grammar.ts, so what the CLI teaches and what
// it accepts are the same text — extend the table, every door updates.
let VERBS: [usage: string, blurb: string, examples: string[]][] = [
  ['tui', 'open the terminal UI', []],
  [
    'claude [claude args...]',
    'interactive claude, fleet-wired: skip-permissions + the tasks channel',
    ['task claude', 'task claude --continue'],
  ],
  ['list [filters...] [--json]', 'list tasks (filter grammar)', [
    'task list .status=open .priority<=1',
    'task list .project=harness .modified_at>="1 week ago"',
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
  ['claim <id> [session]', 'lease a task for a session ($TASKS_SESSION)', [
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
    'sync [--commit]',
    "materialize personas into each project repo's .tasks/",
    ['task sync', 'task sync --commit'],
  ],
  [
    'remember <title...> [--body=…] [--type=feedback|project] [--scope=P-9]',
    'save a memory: the title is the index line, the body the lesson',
    [
      'task remember "pipe a gate, lose its exit code" --type=feedback --scope=P-19',
    ],
  ],
  [
    'context [session|P-9]',
    'the boot digest, scoped to the repo you stand in; bare = preview',
    ['task context', 'task context P-20', 'task context my-session-id'],
  ],
  ['wrap [session]', 'session over: release claims, note unfinished', []],
  ['telemetry [--errors] [--since=ISO] [-n N]', 'tool calls + crashes', [
    'task telemetry --errors -n 20',
  ]],
  [
    ':<command> … | <id> :<command> …',
    "the web bar's `:` vocabulary — same table, same words (task help :)",
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
  let hit = VERBS.find(([u]) => u.split(' ')[0] == topic)
  if (!hit) throw new Error(`no such verb: ${topic} (task help lists them)`)
  let [u, b, examples] = hit
  console.log(`task ${u}\n  ${b}`)
  if (examples.length) {
    console.log(`\n${examples.map((e) => `  ${e}`).join('\n')}`)
  }
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
  // ('.priority<=1', '.domain=Ops,Eng'); bare words are ignored.
  let json = args.includes('--json')
  let all = rows(await snapshot())
  let preds = resolveRefs(
    args.filter((a) => a != '--json').map(pred).filter((p) => p != null),
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

let create = async (args: string[]) => {
  let { params, words } = split(args)
  // Reference values (.project=bindery, .assignee=jeff) resolve at the
  // door — same rule as the MCP tools.
  let grouped = patches(derefParams(rows(await snapshot()), params))
  grouped.doc = { title: words.join(' '), ...grouped.doc }
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
    ...(say
      ? commentChanges(
        all,
        row.eid,
        say,
        Deno.env.get('TASKS_SESSION') ?? undefined,
      )
      : []),
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

// A claim is a session's lease on a task — other agents see who holds
// it, and the server refuses to hand a held lease to someone else.
let claim = async (args: string[]) => {
  let [id, sess] = args
  let session = sess ?? Deno.env.get('TASKS_SESSION')
  if (!id) throw new Error('task claim <id> [session]')
  if (!session) {
    throw new Error('task claim <id> <session> (or set TASKS_SESSION)')
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
  let by = Deno.env.get('TASKS_SESSION') ?? undefined
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
  let session = Deno.env.get('TASKS_SESSION') ?? undefined
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

// Comments attach to anything; attribution rides $TASKS_SESSION when set.
let comment = async (args: string[]) => {
  let [id, ...words] = args
  let body = words.join(' ')
  if (!id || !body) throw new Error('task comment <id> <text...>')
  let all = rows(await snapshot())
  let row = find(all, id)
  if (!row) throw new Error(`no entity: ${id}`)
  await send(commentChanges(all, row.eid, body, Deno.env.get('TASKS_SESSION')))
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

// The session's closing words, read the same way: the last assistant
// turn's text blocks. The operator already wrote its own summary — wrap
// captures it as the session brief instead of asking anyone to retell.
let finalText = (path: string) => {
  try {
    if (!path) return
    let lines = Deno.readTextFileSync(path).trim().split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
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

let context = async (args: string[]) => {
  let hook = args.includes('--hook')
  let sid = args.find((a) => !a.startsWith('--')) ??
    Deno.env.get('TASKS_SESSION')
  // The digest plus the comms bus: unseen comments ride along, and the
  // session's ack cursor advances exactly when they're printed.
  let tell = async (snap: Snapshot, sid: string, scope?: string) => {
    let out = contextDigest(snap, sid, Date.now(), scope)
    let n = notices(snap, sid)
    if (n.lines.length) {
      await send(n.ack)
      out += '\n— while you were away —\n' + n.lines.join('\n')
    }
    console.log(out)
  }
  if (hook) {
    try {
      let body = JSON.parse(await new Response(Deno.stdin.readable).text())
      sid ??= String(body.session_id ?? '')
      if (!sid) return
      let snap = await snapshot()
      // Reify the session on arrival: id + worktree, before any claim.
      let cwd = String(body.cwd ?? '') || undefined
      let s = sessionFor(rows(snap), sid, cwd)
      if (s.changes.length) await send(s.changes)
      // The hook payload names no model (session_id, transcript_path,
      // cwd, hook_event_name, source) — but the transcript does: its
      // last assistant line carries message.model. Announce it, so an
      // external session's spawns can inherit and the board can say
      // what's serving. A fresh transcript has no assistant line yet —
      // then there's simply nothing to announce.
      let model = modelOf(String(body.transcript_path ?? ''))
      if (model) {
        await send([{
          eid: s.eid,
          name: 'session',
          comp: { provider: 'claude', model },
        }])
      }
      // Announce the actor when it's derivable — and for a SESSION that
      // means the OPERATOR, never a person: a client is a person's hands,
      // but a session's words are the operator's, made FOR the person
      // (owner call, 2026-07-21). Derivation: cwd → repo → project — the
      // session speaks as the venture it works in. No matching repo, no
      // guess; identity is asserted, never inferred from who's watching.
      let mine = rows(snap).find((r) => r.eid == s.eid)?.comps.session
      if (!mine?.actor_eid) {
        let here = rows(snap).find((r) =>
          r.comps.repo?.path && cwd?.startsWith(String(r.comps.repo.path))
        )
        if (here) {
          await send([{
            eid: s.eid,
            name: 'session',
            comp: { actor_eid: here.eid },
          }])
        }
      }
      // A managed spawn boots already holding its lease: the launcher
      // passes TASKS_TASK, and an unclaimed task claims quietly here —
      // no prompt discipline required. A held lease stays held (the
      // server would bounce a steal anyway); the digest names the holder.
      let hc = hookClaim(rows(snap), Deno.env.get('TASKS_TASK'), sid, cwd)
      if (hc.length) {
        await send(hc)
        snap = await snapshot() // the digest should show the claim it made
      }
      // The cwd names the scope directly — the reified session row may
      // not have landed in this snap yet.
      let at = rows(snap).find((r) =>
        r.comps.repo?.path && cwd?.startsWith(String(r.comps.repo.path))
      )
      await tell(snap, sid, at?.eid)
    } catch {
      // silent: offline server or malformed stdin — the session goes on
    }
    return
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
    let at = all.find((r) =>
      r.comps.repo?.path && Deno.cwd().startsWith(String(r.comps.repo.path))
    )
    return console.log(contextDigest(snap, undefined, Date.now(), at?.eid))
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
  let session = Deno.env.get('TASKS_SESSION')
  if (!session) throw new Error('remember: set TASKS_SESSION (attribution)')
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
  let sid = args.find((a) => !a.startsWith('--')) ??
    Deno.env.get('TASKS_SESSION')
  try {
    // Hook stdin always gets read: even when TASKS_SESSION names the
    // session, the payload carries the transcript whose last assistant
    // turn IS the brief (continuity is self-authored — T-4469).
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
      throw new Error('task wrap <session> (or set TASKS_SESSION)')
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
// only what changed, and only --commit makes commits (paths-only, so a
// working repo's staged index is never swept up). The server's effect
// keeps files fresh on graph changes; this verb is the explicit door —
// first sync of a new repo, or the committed story until the
// permission-gated actuator (T-3926) owns it.
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
  if (!args.includes('--commit')) return
  let roots = [...new Set(written.map((p) => p.split('/.tasks/')[0]))]
  for (let root of roots) {
    let run = async (...a: string[]) =>
      await new Deno.Command('git', {
        args: ['-C', root, ...a],
        stdout: 'null',
        stderr: 'piped',
      }).output()
    await run('add', '.tasks')
    let { success, stderr } = await run(
      'commit',
      '-m',
      'personas: materialize',
      '--',
      '.tasks',
    )
    console.log(
      success
        ? `committed ${root}`
        : `commit failed ${root}: ${
          new TextDecoder().decode(stderr).trim().slice(-160)
        }`,
    )
  }
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
// door drops straight into the running transcript. One minted
// TASKS_SESSION is the whole binding — the SessionStart hook reifies the
// entity under it, every tool claims and comments as it, and the channel
// plugin filters the /ws broadcast for it. (claude's own session_id
// would drift across /clear and --continue; the minted id holds.)
let CHANNEL = 'plugin:tasks@tasks-fleet'
let interactive = async (args: string[]) => {
  // Allowlisted in root's managed settings → clean launch; otherwise the
  // dev-load flag activates the channel behind a press-Enter dialog —
  // fine at a keyboard, which is the only place this verb runs.
  let listed = false
  try {
    listed = Deno.readTextFileSync('/etc/claude-code/managed-settings.json')
      .includes('"tasks-fleet"')
  } catch { /* no managed settings — dev-load below */ }
  let { code } = await new Deno.Command('claude', {
    args: [
      '--dangerously-skip-permissions',
      '--channels',
      CHANNEL,
      ...(listed ? [] : ['--dangerously-load-development-channels', CHANNEL]),
      ...args,
    ],
    env: {
      TASKS_SESSION: Deno.env.get('TASKS_SESSION') ?? crypto.randomUUID(),
      TASKS_HOST: host(),
    },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).output()
  Deno.exit(code)
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

let [cmd, ...rest] = Deno.args
try {
  if (cmd?.startsWith(':')) await colon(undefined, [cmd, ...rest])
  else if (cmd == 'tui') await tui()
  else if (cmd == 'claude') await interactive(rest)
  else if (cmd == 'list' || cmd == 'ls') await list(rest)
  else if (cmd == 'new') await create(rest)
  else if (cmd == 'set') await set(rest)
  else if (cmd == 'show') await show(rest)
  else if (cmd == 'history') await past(rest)
  else if (cmd == 'search') await seek(rest)
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
  else {
    console.log(usage.trim())
    if (cmd) Deno.exit(2)
  }
} catch (e) {
  console.error(`task: ${(e as Error).message} (server: ${host()})`)
  Deno.exit(1)
}
