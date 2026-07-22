// The MCP registry's pure half: what a list door shows of long text.
// The tools themselves are probe-verified against a live /mcp.
import { CUT, elide } from './mcp.ts'
import { rows } from './client.ts'
import { assertEquals, assertMatch } from '@std/assert'

let N = 'aaaaaaaa-0000-4000-8000-000000000001'
let long = 'x'.repeat(CUT * 3)
let [persona] = rows({
  changes: [
    { eid: N, name: 'entity', comp: { eid: N, num: 9, created_at: '' } },
    { eid: N, name: 'doc', comp: { title: 'operator', body: long } },
    { eid: N, name: 'persona', comp: { home_eid: null } },
  ],
})

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
