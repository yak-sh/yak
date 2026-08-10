// The knock ladder, rung by rung: cast to whoever is awake, spawn a
// project with nobody running, mail an addressed person, and say why
// when no door opens — against an in-memory db, no processes (the spawn
// rung asserts the minted session request, never a launch).
import { type Change } from './types.ts'
import { fakeClaude } from './door_fake.ts'
Deno.env.set('DB_PATH', ':memory:')
let { apply, db, open } = await import('./db.ts')
let { knocked } = await import('./knock.ts')
let { assertEquals, assertMatch } = await import('@std/assert')

open()
let uid = () => crypto.randomUUID()
let sent: Change[] = []
let cast = (cs: Change[]) => sent.push(...cs)

// The delivery outcome is the shared delivered/error facet (D-14945): via
// carries what the ladder did, message why it couldn't, neither = pending.
let drow = (eid: string) =>
  db.prepare('select * from delivered where eid = ?').get(eid) as
    | Record<string, string | null>
    | undefined
let erow = (eid: string) =>
  db.prepare('select * from error where eid = ?').get(eid) as
    | Record<string, string | null>
    | undefined

// A project with a repo, and a task on it — the spawnable ask.
let project = (() => {
  let eid = uid()
  apply(db, [
    { eid, name: 'doc', comp: { title: 'Homelab' } },
    { eid, name: 'project', comp: {} },
    { eid, name: 'repo', comp: { path: '/repo', base_branch: 'main' } },
  ])
  return eid
})()
let task = (() => {
  let eid = uid()
  apply(db, [
    { eid, name: 'doc', comp: { title: 'mint an api key' } },
    { eid, name: 'task', comp: { status: 'open', project: project } },
  ])
  return eid
})()

let knock = (target: string, to: string) => {
  let eid = uid()
  let out = apply(db, [
    { eid, name: 'knock', comp: { target: target } },
    { eid, name: 'deliver', comp: { to } },
  ])
  let comp = out.find((c) => c.name == 'knock')!.comp!
  knocked(cast)(eid, comp)
  return eid
}

Deno.test('awake operator actor: the cast is the delivery', () => {
  let s = uid(), role = uid()
  apply(db, [
    { eid: role, name: 'doc', comp: { title: 'operator' } },
    { eid: role, name: 'role', comp: { scope: project } },
    {
      eid: s,
      name: 'session',
      comp: { id: 'op-1', actor: project, operator: true, role: role },
    },
  ])
  db.prepare(
    "update session set origin = 'managed', status = 'running' where eid = ?",
  ).run(s)
  let k = knock(task, project)
  assertMatch(String(drow(k)?.via), /^cast S-\d+$/)
  assertEquals(erow(k), undefined)
  db.prepare("update session set status = 'completed' where eid = ?").run(s)
})

// The T-15147 hijack: a managed spawn wearing the actor is NOT the
// operator loop — every delivery door (channel, bus) drops actor address
// for it, so a cast there is a stamp nobody hears. With no operator
// awake the ladder must descend to the spawn rung, never lie.
Deno.test('a managed spawn wearing the actor does not take the cast', () => {
  let s = uid()
  apply(db, [{
    eid: s,
    name: 'session',
    comp: { id: 'spawn-1', actor: project },
  }])
  db.prepare(
    `update session set origin = 'managed', status = 'running',
     requested_task = ? where eid = ?`,
  ).run(task, s)
  let k = knock(task, project)
  assertMatch(String(drow(k)?.via), /^spawned S-\d+$/)
  db.prepare("update session set status = 'completed' where eid = ?").run(s)
})

Deno.test('nobody awake at a project: spawn onto the target task', () => {
  let k = knock(task, project)
  assertMatch(String(drow(k)?.via), /^spawned S-\d+$/)
  // the spawn request rides the graph: a session asking for the task
  let s = db.prepare(
    'select * from session where requested_task = ? order by rowid desc',
  ).get(task) as Record<string, string>
  assertEquals(Boolean(s.provider && s.model), true)
  // a knock about something unspawnable says so
  let d = uid()
  apply(db, [{ eid: d, name: 'doc', comp: { title: 'just a doc' } }])
  let k2 = knock(d, project)
  assertMatch(String(erow(k2)?.message), /not spawnable/)
})

Deno.test('an addressed person: the knock rides mail, words and all', () => {
  let jeff = uid(), c = uid()
  apply(db, [
    { eid: jeff, name: 'doc', comp: { title: 'Jeff' } },
    { eid: jeff, name: 'person', comp: {} },
    { eid: jeff, name: 'email', comp: { address: 'jeff@test' } },
    // the words rode the batch as a plain comment on the target
    { eid: c, name: 'doc', comp: { title: '', body: 'need this today' } },
    { eid: c, name: 'comment', comp: { target: task } },
  ])
  let k = knock(task, jeff)
  assertMatch(String(drow(k)?.via), /^mailed U-\d+$/)
  let m = db.prepare(
    'select d.title, d.body from mail m join doc d on d.eid = m.eid',
  ).get() as { title: string; body: string }
  assertMatch(m.title, /^knock: T-\d+/)
  assertEquals(m.body, 'need this today')
})

Deno.test('an operator is a door: external claude hears it, its child does not', async () => {
  let c = await fakeClaude()
  // The operator: plain `claude` in a terminal, so origin 'external' —
  // the case the old `origin = 'managed'` test shut out entirely.
  let op = uid()
  apply(db, [{
    eid: op,
    name: 'session',
    comp: { id: 'op-2', actor: project, pid: c.pid, operator: true },
  }])
  // A subagent it spawned, reified LATER (so it sorts first) — a tool
  // call inside the operator's process, which is why it never claims the
  // pid and never takes the operator's knock.
  apply(db, [{
    eid: uid(),
    name: 'session',
    comp: { id: 'kid-1', actor: project },
  }])
  // And the live hijack shape (T-15147): a REACHABLE managed spawn
  // reified newer than the operator. Recency must not outrank the loop.
  let spawn = uid()
  apply(db, [{
    eid: spawn,
    name: 'session',
    comp: { id: 'spawn-2', actor: project },
  }])
  db.prepare(
    `update session set origin = 'managed', status = 'running',
     requested_task = ? where eid = ?`,
  ).run(task, spawn)
  let k = knock(task, project)
  let { num } = db.prepare('select num from entity where eid = ?').get(op) as {
    num: number
  }
  assertEquals(drow(k)?.via, `cast S-${num}`)
  assertEquals(erow(k), undefined)
  c.kill('SIGKILL')
  await c.status
  // the door shuts with the process: the ladder descends again — past
  // the still-running managed spawn, which is not a door for the actor
  assertMatch(String(drow(knock(task, project))?.via), /^spawned S-\d+$/)
  db.prepare("update session set status = 'completed' where eid = ?").run(spawn)
})

// The operator loop outranks recency: a delegated worktree agent is its OWN
// live claude process wearing the same actor, reified LATER, so newest-first
// alone would hand it the wake meant for the operator (the T-15070 hijack).
Deno.test('an actor knock prefers the operator over a newer worktree agent', async () => {
  let opProc = await fakeClaude()
  let agentProc = await fakeClaude()
  // The operator: reified FIRST (lower num), flagged operator.
  let op = uid()
  apply(db, [{
    eid: op,
    name: 'session',
    comp: { id: 'op-op', actor: project, pid: opProc.pid, operator: true },
  }])
  // A worktree agent: a SEPARATE reachable claude wearing the same actor,
  // reified LATER (higher num), not an operator. Recency would pick it.
  apply(db, [{
    eid: uid(),
    name: 'session',
    comp: { id: 'agent-op', actor: project, pid: agentProc.pid },
  }])
  let k = knock(task, project)
  let { num } = db.prepare('select num from entity where eid = ?').get(op) as {
    num: number
  }
  assertEquals(drow(k)?.via, `cast S-${num}`)
  assertEquals(erow(k), undefined)
  opProc.kill('SIGKILL')
  agentProc.kill('SIGKILL')
  await opProc.status
  await agentProc.status
})

// A settled managed run is not a dead end: input to a session is a
// comment aimed at it, and that is the door the knock takes.
Deno.test('a settled managed session: the knock rides its input door', () => {
  let sess = uid()
  apply(db, [{ eid: sess, name: 'session', comp: { id: uid() } }])
  db.prepare(
    `update session set origin = 'managed', status = 'completed' where eid = ?`,
  ).run(sess)
  // The knocker's words, said on the target a moment before the knock —
  // the same window rung 3's letter reads.
  let said = uid()
  apply(db, [
    {
      eid: said,
      name: 'doc',
      comp: { title: '', body: 'the key expires today' },
    },
    { eid: said, name: 'comment', comp: { target: task } },
  ])

  let k = knock(task, sess)
  assertEquals(erow(k), undefined)
  assertMatch(String(drow(k)?.via), /^commented S-/)
  // The comment landed ON the session — that IS the input.
  let input = db.prepare(
    `select d.body from comment c join doc d on d.eid = c.eid
     where c.target = ? order by c.rowid desc limit 1`,
  ).get(sess) as { body: string }
  assertMatch(input.body, /^knock: T-\d+ — the key expires today$/)
})

// An EXTERNAL session that has gone quiet has no run to continue, so it
// must fall through rather than mint input nobody will read.
Deno.test('a settled external session is not a door', () => {
  let sess = uid()
  apply(db, [{ eid: sess, name: 'session', comp: { id: uid() } }])
  db.prepare(`update session set status = 'completed' where eid = ?`).run(sess)
  let k = knock(task, sess)
  assertMatch(String(erow(k)?.message), /no door/)
})

Deno.test('no door: the artifact says why nobody heard', () => {
  let stray = uid()
  apply(db, [{ eid: stray, name: 'doc', comp: { title: 'nobody' } }])
  let k = knock(task, stray)
  assertEquals(erow(k) != null, true)
  assertMatch(String(erow(k)?.message), /no door/)
})
