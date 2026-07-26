// The schema read back out: one derivation (schema.ts over types.ts),
// two faces — the Schema view's rows and the Vocabulary doc's markdown.
// Pin the spellings both share, and that the doc says everything.
import { assert, assertEquals } from '@std/assert'
import { schema, typeWord, vocabularyMd } from './schema.ts'

Deno.test('typeWord: one spelling per type', () => {
  assertEquals(typeWord('text'), 'text')
  assertEquals(typeWord('number'), 'number')
  assertEquals(typeWord('priority'), 'priority')
  assertEquals(typeWord({ enum: ['a', 'b'] }), 'a | b')
  assertEquals(
    typeWord({ enum: ['open'], aliases: { todo: 'open' } }),
    'open; todo → open',
  )
  assertEquals(typeWord({ eid: 'project', death: 'detach' }), '→ project')
  assertEquals(typeWord({ eid: '', death: 'cascade' }), '→ any')
  assertEquals(typeWord({ text: 'domains' }), 'text (domains)')
})

Deno.test('schema(): stamped marked, death words carried, tags empty', () => {
  let rows = Object.fromEntries(schema().map((s) => [s.comp, s.cols]))
  assertEquals(
    rows.claim.find((c) => c.col == 'session_eid')?.death,
    'release',
  )
  assertEquals(rows.claim.find((c) => c.col == 'claimed_at')?.stamped, true)
  assertEquals(rows.entity.every((c) => c.stamped), true) // spine: all server's
  assertEquals(rows.canvas, []) // a tag — the row is the statement
  // project outgrew tag-hood: retirement rides the comp, wire-writable
  assertEquals(rows.project, [
    { col: 'retired_at', type: 'time', stamped: false },
  ])
  // wire-writable and stamped columns of one comp land in one place
  let session = rows.session.map((c) => c.col)
  assert(session.includes('provider') && session.includes('exit_code'))
})

Deno.test('vocabularyMd: components, death words, effects — all present', () => {
  let md = vocabularyMd([{
    comp: 'session',
    hooks: ['created', 'removed'],
    doc: 'spawns the agent',
  }])
  assert(md.includes('### task'))
  assert(md.includes('`project_eid` → project (detach)'))
  assert(md.includes('`claimed_at` time ⚙'))
  assert(md.includes('- parent requires child'))
  assert(md.includes('open → wip → done → cancelled'))
  assert(md.includes('**session** created, removed — spawns the agent'))
})
