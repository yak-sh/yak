// The MCP registry's pure half: command writes at the headless boundary
// and what a list door shows of long text.
import { commandOut, CUT, elide } from './mcp.ts'
import { rows } from './client.ts'
import { assertEquals, assertMatch, assertThrows } from '@std/assert'

let N = 'aaaaaaaa-0000-4000-8000-000000000001'
let P = 'aaaaaaaa-0000-4000-8000-000000000002'
let T = 'aaaaaaaa-0000-4000-8000-000000000003'
let long = 'x'.repeat(CUT * 3)
let all = rows({
  changes: [
    { eid: N, name: 'entity', comp: { eid: N, num: 9, created_at: '' } },
    { eid: N, name: 'doc', comp: { title: 'operator', body: long } },
    { eid: N, name: 'persona', comp: { home_eid: null } },
    { eid: P, name: 'entity', comp: { eid: P, num: 19, created_at: '' } },
    { eid: P, name: 'doc', comp: { title: 'Home', body: '' } },
    { eid: P, name: 'project', comp: {} },
    { eid: P, name: 'alias', comp: { slug: 'home' } },
    { eid: T, name: 'entity', comp: { eid: T, num: 7595, created_at: '' } },
    { eid: T, name: 'doc', comp: { title: 'Task', body: '' } },
    { eid: T, name: 'task', comp: { status: 'open' } },
  ],
})
let persona = all[0]

Deno.test('elide: long text cuts with a marker naming the whole-doc door', () => {
  let c = elide(persona)
  let body = String(c.doc.body)
  assertMatch(body, /ELIDED 1000 of 1500 chars — task_show N-9/)
  assertEquals(body.startsWith('x'.repeat(CUT)), true)
  // short values, non-strings, and titles ride untouched
  assertEquals(c.doc.title, 'operator')
  assertEquals(c.persona.home_eid, null)
  assertEquals(c.entity.num, 9)
})

Deno.test('command: set resolves a human reference before the write', () => {
  let out = commandOut(all, ':set .project_eid=P-19', T)
  assertEquals(out.changes, [
    { eid: T, name: 'task', comp: { project_eid: P } },
  ])
})

Deno.test('command: generated references resolve aliases and reject misses', () => {
  let out = commandOut(all, ':new .project_eid=home Ship it', T)
  let task = out.changes!.find((c) => c.name == 'task')
  assertEquals(task?.comp?.project_eid, P)
  assertThrows(
    () => commandOut(all, ':set .project_eid=missing', T),
    Error,
    'no entity: missing (.project_eid)',
  )
})
