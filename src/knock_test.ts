// The knock ladder, rung by rung: cast to whoever is awake, spawn a
// project with nobody running, mail an addressed person, and say why
// when no door opens — against an in-memory db, no processes (the spawn
// rung asserts the minted session request, never a launch).
import { type Change } from './types.ts'
Deno.env.set('DB_PATH', ':memory:')
let { apply, db, open } = await import('./db.ts')
let { knocked } = await import('./knock.ts')
let { assertEquals, assertMatch } = await import('@std/assert')

open()
let uid = () => crypto.randomUUID()
let sent: Change[] = []
let cast = (cs: Change[]) => sent.push(...cs)

let krow = (eid: string) =>
  db.prepare('select * from knock where eid = ?').get(eid) as Record<
    string,
    string | null
  >

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
    { eid, name: 'task', comp: { status: 'open', project_eid: project } },
  ])
  return eid
})()

let knock = (target: string, to: string) => {
  let eid = uid()
  let out = apply(db, [
    { eid, name: 'knock', comp: { target_eid: target, to_eid: to } },
  ])
  let comp = out.find((c) => c.name == 'knock')!.comp!
  knocked(cast)(eid, comp)
  return eid
}

Deno.test('awake actor: the cast is the delivery', () => {
  let s = uid()
  apply(db, [{
    eid: s,
    name: 'session',
    comp: { id: 'op-1', actor_eid: project },
  }])
  db.prepare(
    "update session set origin = 'managed', status = 'running' where eid = ?",
  ).run(s)
  let k = knock(task, project)
  assertMatch(String(krow(k).delivery), /^cast S-\d+$/)
  assertEquals(krow(k).error, null)
  db.prepare("update session set status = 'completed' where eid = ?").run(s)
})

Deno.test('nobody awake at a project: spawn onto the target task', () => {
  let k = knock(task, project)
  assertMatch(String(krow(k).delivery), /^spawned S-\d+$/)
  // the spawn request rides the graph: a session asking for the task
  let s = db.prepare(
    'select * from session where requested_task_eid = ? order by rowid desc',
  ).get(task) as Record<string, string>
  assertEquals(Boolean(s.provider && s.model), true)
  // a knock about something unspawnable says so
  let d = uid()
  apply(db, [{ eid: d, name: 'doc', comp: { title: 'just a doc' } }])
  let k2 = knock(d, project)
  assertMatch(String(krow(k2).error), /not spawnable/)
})

Deno.test('an addressed person: the knock rides mail, words and all', () => {
  let jeff = uid(), c = uid()
  apply(db, [
    { eid: jeff, name: 'doc', comp: { title: 'Jeff' } },
    { eid: jeff, name: 'person', comp: {} },
    { eid: jeff, name: 'email', comp: { address: 'jeff@test' } },
    // the words rode the batch as a plain comment on the target
    { eid: c, name: 'doc', comp: { title: '', body: 'need this today' } },
    { eid: c, name: 'comment', comp: { target_eid: task } },
  ])
  let k = knock(task, jeff)
  assertMatch(String(krow(k).delivery), /^mailed U-\d+$/)
  let m = db.prepare(
    'select d.title, d.body from mail m join doc d on d.eid = m.eid',
  ).get() as { title: string; body: string }
  assertMatch(m.title, /^knock: T-\d+/)
  assertEquals(m.body, 'need this today')
})

Deno.test('no door: the artifact says why nobody heard', () => {
  let stray = uid()
  apply(db, [{ eid: stray, name: 'doc', comp: { title: 'nobody' } }])
  let k = knock(task, stray)
  assertEquals(krow(k).acted_at != null, true)
  assertMatch(String(krow(k).error), /no door/)
})
