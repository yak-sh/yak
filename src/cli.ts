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
  find,
  history,
  historyLine,
  hookClaim,
  host,
  idOf,
  lapseChanges,
  notices,
  type Param,
  param,
  patches,
  rows,
  search,
  send,
  sessionFor,
  snapshot,
  spawnChanges,
  taskChanges,
} from './client.ts'
import { matchQuery, pred } from './query.ts'
import { type Snapshot } from './types.ts'
// `import type` (not the repo's usual inline `{ type X }`): telemetry.ts
// reaches for node:sqlite, and the CLI has no business loading a db driver.
import type { Log } from './telemetry.ts'

let usage = `task — the entity graph, from a shell

  task tui                       open the terminal UI
  task list [.prop=value ...]    list tasks (any dot-param filters)
  task new .title="..." [...]    create a task (bare words become the title)
  task set <id> .prop=value ...  patch an entity (id: T-3, 3, or an eid)
  task show <id>                 print one entity as JSON
  task history <id> [-n N]       the entity's write history (the journal)
  task search <words...>         full-text search (trailing * = prefix)
  task claim <id> [session]      lease a task for a session ($TASKS_SESSION)
  task release <id>              drop the lease
  task spawn <id> --provider=X --model=Y [--effort=Z] [--persona=P-9]
                                 dispatch a managed agent onto a task
  task comment <id> <text...>    say something about ANY entity
  task backup                    snapshot the db + commit/push the data dir
  task context [session]         this session's working set ($TASKS_SESSION)
  task lapse [session]           session over: release claims, note unfinished
  task telemetry [--errors]      tool calls + crashes, newest first
    [--since=ISO] [-n N]

dot-params route by prop (.title= → doc.title); where a prop lives in
several components (pin/camera x,y,w,h) spell it out: .pin.x=12
`

let split = (args: string[]) => {
  let params: Param[] = []
  let words: string[] = []
  for (let a of args) {
    let p = param(a)
    if (p) params.push(p)
    else words.push(a)
  }
  return { params, words }
}

let list = async (args: string[]) => {
  // Filters speak the query grammar — operators, lists, ranges
  // ('.priority<=1', '.domain=Ops,Eng'); bare words are ignored.
  let preds = args.map(pred).filter((p) => p != null)
  let all = rows(await snapshot())
  let hits = all
    .filter((r) => r.comps.task)
    .filter((r) => matchQuery(r.comps, preds))
    .sort(byBoard)
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
  let grouped = patches(params)
  grouped.doc = { title: words.join(' '), ...grouped.doc }
  if (!grouped.doc.title) throw new Error('a task needs a .title')
  let eid = crypto.randomUUID()
  await send(taskChanges(eid, grouped))
  let made = rows(await snapshot()).find((r) => r.eid == eid)
  console.log(`${made ? idOf(made) : eid} created`)
}

let set = async (args: string[]) => {
  let { params, words } = split(args)
  let [id] = words
  if (!id || !params.length) throw new Error('task set <id> .prop=value ...')
  let row = find(rows(await snapshot()), id)
  if (!row) throw new Error(`no entity: ${id}`)
  await send(
    Object.entries(patches(params))
      .map(([name, comp]) => ({ eid: row.eid, name, comp })),
  )
  console.log(`${idOf(row)} updated`)
}

// Full-text search — every doc in the graph, ranked, matches bracketed.
let seek = async (args: string[]) => {
  let q = args.join(' ')
  if (!q) throw new Error('task search <words...> (trailing * = prefix)')
  let hits = await search(q)
  if (!hits.length) return console.log('(no hits)')
  for (let h of hits) {
    let aim = h.open_eid != h.eid ? ` → on ${h.open_eid}` : ''
    let snip = h.snip.replaceAll('\x01', '[').replaceAll('\x02', ']')
    console.log(
      `${idOf(h)} ${h.kind}: ${h.title || '(untitled)'}${aim} — ${snip}`,
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
// Session on the board (task show <S-id> reads it back).
let spawn = async (args: string[]) => {
  let flag = (n: string) =>
    args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
  let [id] = args.filter((a) => !a.startsWith('--'))
  let provider = flag('provider')
  let model = flag('model')
  if (!id || !provider || !model) {
    throw new Error(
      'task spawn <id> --provider=X --model=Y [--effort=Z] [--persona=P-9]',
    )
  }
  let all = rows(await snapshot())
  let made = spawnChanges(all, {
    task: id,
    provider,
    model,
    effort: flag('effort'),
    persona: flag('persona'),
  })
  await send(made.changes)
  let after = rows(await snapshot()).find((r) => r.eid == made.eid)
  console.log(`${after ? idOf(after) : made.eid} spawned onto ${id}`)
}

let release = async (args: string[]) => {
  let [id] = args
  if (!id) throw new Error('task release <id>')
  let row = find(rows(await snapshot()), id)
  if (!row) throw new Error(`no entity: ${id}`)
  await send([{ eid: row.eid, name: 'claim', comp: null }])
  console.log(`${idOf(row)} released`)
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
  let [id] = args
  if (!id) throw new Error('task show <id>')
  let all = rows(await snapshot())
  let row = find(all, id)
  if (!row) throw new Error(`no entity: ${id}`)
  let comments = all.filter((r) => r.comps.comment?.target_eid == row.eid)
  console.log(JSON.stringify({ ...row, comments }, null, 2))
}

// The entity's write history — the journal, one line per touching batch:
// when · who · what changed. Blame without a version table.
let past = async (args: string[]) => {
  let n = Number(args.find((a) => a.startsWith('-n'))?.slice(2) ?? 0) ||
    Number(args[args.indexOf('-n') + 1] ?? 0) || 50
  let id = args.find((a) => !a.startsWith('-'))
  if (!id) throw new Error('task history <id> [-n N]')
  let all = rows(await snapshot())
  let row = find(all, id)
  if (!row) throw new Error(`no entity: ${id}`)
  let entries = await history(row.eid, n)
  if (!entries.length) return console.log(`${idOf(row)}: no history`)
  for (let e of entries) console.log(historyLine(e))
}

// The injection loop's front door. Plain: print the digest for a session
// id. --hook: SessionStart mode — session_id arrives as hook JSON on
// stdin, and NOTHING may fail loudly (a hook must never wedge a session;
// no server just means no context today).
let context = async (args: string[]) => {
  let hook = args.includes('--hook')
  let sid = args.find((a) => !a.startsWith('--')) ??
    Deno.env.get('TASKS_SESSION')
  // The digest plus the comms bus: unseen comments ride along, and the
  // session's ack cursor advances exactly when they're printed.
  let tell = async (snap: Snapshot, sid: string) => {
    let out = contextDigest(snap, sid)
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
      // A managed spawn boots already holding its lease: the launcher
      // passes TASKS_TASK, and an unclaimed task claims quietly here —
      // no prompt discipline required. A held lease stays held (the
      // server would bounce a steal anyway); the digest names the holder.
      let hc = hookClaim(rows(snap), Deno.env.get('TASKS_TASK'), sid, cwd)
      if (hc.length) {
        await send(hc)
        snap = await snapshot() // the digest should show the claim it made
      }
      await tell(snap, sid)
    } catch {
      // silent: offline server or malformed stdin — the session goes on
    }
    return
  }
  if (!sid) throw new Error('task context <session> (or set TASKS_SESSION)')
  await tell(await snapshot(), sid)
}

// SessionEnd's mirror of context: drop everything the session holds.
// --hook mode (stdin JSON, silent failure) wires it to the lifecycle.
let lapse = async (args: string[]) => {
  let hook = args.includes('--hook')
  let sid = args.find((a) => !a.startsWith('--')) ??
    Deno.env.get('TASKS_SESSION')
  try {
    if (hook && !sid) {
      let body = JSON.parse(await new Response(Deno.stdin.readable).text())
      sid = String(body.session_id ?? '')
    }
    if (!sid) {
      if (hook) return
      throw new Error('task lapse <session> (or set TASKS_SESSION)')
    }
    let changes = lapseChanges(rows(await snapshot()), sid)
    if (changes.length) await send(changes)
    if (!hook) {
      console.log(
        `released ${changes.filter((c) => c.name == 'claim').length} claim(s)`,
      )
    }
  } catch (e) {
    if (!hook) throw e
    // hooks never fail loudly — a dead server just means no lapse today
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
let backup = async () => {
  let script = new URL('../bin/backup', import.meta.url).pathname
  let { code } = await new Deno.Command(script, {
    stdin: 'null',
    stdout: 'inherit',
    stderr: 'inherit',
  }).output()
  if (code) Deno.exit(code)
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
  if (cmd == 'tui') await tui()
  else if (cmd == 'list' || cmd == 'ls') await list(rest)
  else if (cmd == 'new') await create(rest)
  else if (cmd == 'set') await set(rest)
  else if (cmd == 'show') await show(rest)
  else if (cmd == 'history') await past(rest)
  else if (cmd == 'search') await seek(rest)
  else if (cmd == 'claim') await claim(rest)
  else if (cmd == 'spawn') await spawn(rest)
  else if (cmd == 'comment') await comment(rest)
  else if (cmd == 'backup') await backup()
  else if (cmd == 'context') await context(rest)
  else if (cmd == 'lapse') await lapse(rest)
  else if (cmd == 'release') await release(rest)
  else if (cmd == 'telemetry') await telemetry(rest)
  else {
    console.log(usage.trim())
    if (cmd && cmd != 'help' && cmd != '--help') Deno.exit(2)
  }
} catch (e) {
  console.error(`task: ${(e as Error).message} (server: ${host()})`)
  Deno.exit(1)
}
