// The task CLI. Install once, run anywhere the server is reachable:
//   deno task install       (deno install -g — puts `task` on PATH)
//   task tui                 the terminal UI
//   task list [.status=open] list tasks, dot-param filtered
//   task new .title="Hi" [.body=... .status=wip]   (bare words = title)
//   task set T-3 .status=done                       patch any entity
//   task show T-3                                   one entity, whole
// Dot-params route by prop through the shared vocabulary (.title → doc);
// collisions use the explicit .comp.prop spelling. TASKS_HOST points at a
// non-default server.
import { type Change } from './types.ts'
import {
  byBoard,
  claimant,
  claimChanges,
  find,
  host,
  idOf,
  type Param,
  param,
  patches,
  rows,
  send,
  snapshot,
} from './client.ts'

let usage = `task — the entity graph, from a shell

  task tui                       open the terminal UI
  task list [.prop=value ...]    list tasks (any dot-param filters)
  task new .title="..." [...]    create a task (bare words become the title)
  task set <id> .prop=value ...  patch an entity (id: T-3, 3, or an eid)
  task show <id>                 print one entity as JSON
  task claim <id> [session]      lease a task for a session ($TASKS_SESSION)
  task release <id>              drop the lease

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
  let { params } = split(args)
  let all = rows(await snapshot())
  let hits = all
    .filter((r) => r.comps.task)
    .filter((r) =>
      params.every((p) => String(r.comps[p.comp]?.[p.prop]) == String(p.value))
    )
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
  let doc = { title: words.join(' '), ...grouped.doc }
  if (!doc.title) throw new Error('a task needs a .title')
  let task = { status: 'open', ...grouped.task }
  let eid = crypto.randomUUID()
  let changes: Change[] = [
    { eid, name: 'doc', comp: doc },
    { eid, name: 'task', comp: task },
    ...Object.entries(grouped)
      .filter(([n]) => n != 'doc' && n != 'task')
      .map(([name, comp]) => ({ eid, name, comp })),
  ]
  await send(changes)
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
  await send(claimChanges(all, row.eid, session))
  console.log(`${idOf(row)} claimed by ${session}`)
}

let release = async (args: string[]) => {
  let [id] = args
  if (!id) throw new Error('task release <id>')
  let row = find(rows(await snapshot()), id)
  if (!row) throw new Error(`no entity: ${id}`)
  await send([{ eid: row.eid, name: 'claim', comp: null }])
  console.log(`${idOf(row)} released`)
}

let show = async (args: string[]) => {
  let [id] = args
  if (!id) throw new Error('task show <id>')
  let row = find(rows(await snapshot()), id)
  if (!row) throw new Error(`no entity: ${id}`)
  console.log(JSON.stringify(row, null, 2))
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
  else if (cmd == 'claim') await claim(rest)
  else if (cmd == 'release') await release(rest)
  else {
    console.log(usage.trim())
    if (cmd && cmd != 'help' && cmd != '--help') Deno.exit(2)
  }
} catch (e) {
  console.error(`task: ${(e as Error).message} (server: ${host()})`)
  Deno.exit(1)
}
