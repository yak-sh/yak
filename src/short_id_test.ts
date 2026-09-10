import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from '@std/assert'
import { apply, human, locate, resolveId, snapshot } from './db.ts'
import { bareDb } from './testdb.ts'
import { find, historyLine, jsonOf, normalizeLiterals, rows } from './client.ts'
import { idOf, shortId, shortParts } from './types.ts'
import { parseQuery, resolveRefs } from './query.ts'
import { entityId, entityPath, entityUrl } from './url.ts'
import { evalGraph } from './graph_query.ts'

let eid = '3f9a1c2e-7b00-4000-8000-000000000001'

Deno.test('short ids: display, read/write/query doors and parse table agree', () => {
  let db = bareDb()
  try {
    apply(db, [{ eid, name: 'task', comp: {} }])
    let all = rows(snapshot(db)), row = find(all, eid)!
    assertEquals(human(db, eid), 'T#3f9a1c2e7b')
    assertEquals(idOf(row), human(db, eid))
    // Structured wire bundles retain durable eids, not display fragments.
    assertEquals((jsonOf(row).entity as { eid: string }).eid, eid)
    assertEquals(shortId(eid), '#3f9a1c2e7b')
    assertEquals(idOf({ eid, kind: '' }), '#3f9a1c2e7b')
    for (
      let token of [
        eid,
        eid.toUpperCase(),
        'T#3f9a1c2e7b',
        't#3F9A1C2E7B',
        '#3f9a1c',
        '#3f9a1c2e7b0040008000000000000001',
      ]
    ) {
      assertEquals(resolveId(db, token), eid, token)
      assertEquals(locate(db, token), eid, token)
      assertEquals(find(all, token)?.eid, eid, token)
      let resolve = (id: string) => resolveId(db, id)
      let plan = normalizeLiterals([{
        entity: { eid: token },
        doc: { title: 'named' },
      }], { resolve })
      assertEquals(plan.changes[0].eid, eid)
      for (let prop of ['eid', 'claim.session', 'filed.project']) {
        assertEquals(
          resolveRefs(parseQuery(`.${prop}=${token}`), resolve)[0].value,
          eid,
        )
      }
    }
    assertEquals(shortParts('T#1234567890'), { prefix: 'T', hex: '1234567890' })
    assertEquals(evalGraph(db, '#3f9a1c2e7b').hits.map((h) => h.eid), [eid])
    for (let token of ['abcdef', '123456', '3f9a1c2e7b']) {
      assertEquals(resolveId(db, token), undefined)
      assertEquals(find(all, token), undefined)
    }
    for (let token of ['#12345', 'T#xyz123', 'T#123456' + 'a'.repeat(59)]) {
      assertThrows(() => resolveId(db, token), Error, '6–64')
    }
    assertThrows(() => resolveId(db, 'S#3f9a1c2e7b'), Error, 'prefix S')
    assertThrows(() => find(all, 'S#3f9a1c2e7b'), Error, 'prefix S')
    assertThrows(
      () =>
        resolveRefs(parseQuery('.eid=S#3f9a1c2e7b'), (id) => resolveId(db, id)),
      Error,
      'prefix S',
    )
    apply(db, [{ eid, name: 'entity', comp: {}, $num: true }])
    assertEquals(human(db, eid), 'T-1')
    assertEquals(resolveId(db, 'T-1'), eid)
    assertEquals(resolveId(db, 'T#3f9a1c2e7b'), eid)
  } finally {
    db.close()
  }
})

Deno.test('short ids: collisions list full candidates before checking kind', () => {
  let db = bareDb(), other = '3f9a1c2e-7bff-4000-8000-000000000002'
  try {
    apply(db, [{ eid, name: 'task', comp: {} }, {
      eid: other,
      name: 'session',
      comp: { id: other },
    }])
    let all = rows(snapshot(db))
    for (
      let resolve of [
        (id: string) => resolveId(db, id),
        (id: string) => find(all, id)?.eid,
      ]
    ) {
      let error = assertThrows(
        () => resolve('T#3f9a1c2e7b'),
        Error,
        'ambiguous',
      )
      assertStringIncludes(error.message, eid)
      assertStringIncludes(error.message, other)
      assertThrows(() => evalGraph(db, '#3f9a1c2e7b'), Error, 'ambiguous')
      assertEquals(resolve('T#3f9a1c2e7b00'), eid)
      assertThrows(
        () => resolveRefs(parseQuery('.eid=#3f9a1c2e7b'), resolve),
        Error,
        'ambiguous',
      )
    }
    // Verify SQLite can use the entity.eid index for the actual lookup shape.
    let plan = db.prepare(
      'explain query plan select eid from entity where eid >= ? and eid < ? order by eid',
    ).all('3f9a1c2e-7b', '3f9a1c2e-7c')
    assertStringIncludes(JSON.stringify(plan), 'SEARCH')
    assertStringIncludes(JSON.stringify(plan), 'eid>? AND eid<?')
  } finally {
    db.close()
  }
})

Deno.test('short ids: decimal and hash eids, UUID group boundaries and f carry', () => {
  let db = bareDb()
  try {
    for (
      let id of [
        '12345678-90ab-cdef-ffff-ffffffffffff',
        'ffffffff-ffff-ffff-ffff-ffffffffffff',
        'a'.repeat(40),
        'b'.repeat(64),
      ]
    ) {
      db.prepare('insert into entity (eid) values (?)').run(id)
      let hex = id.replaceAll('-', '')
      for (let n = 6; n <= hex.length; n++) {
        assertEquals(resolveId(db, '#' + hex.slice(0, n)), id)
      }
    }
    assertEquals(resolveId(db, '1234567890'), undefined)
  } finally {
    db.close()
  }
})

Deno.test('short ids: browser URL round trip and history never truncate raw UUIDs', () => {
  for (let token of ['T-42', 'T#3f9a1c2e7b', '#3f9a1c2e7b', eid]) {
    let url = new URL(entityUrl(token))
    assertEquals(url.hash, '')
    assertEquals(url.pathname, entityPath(token))
    assertEquals(entityId(url.href), token)
  }
  assertEquals(entityPath('T#3f9a1c2e7b'), '/T%233f9a1c2e7b')
  assertEquals(entityId('https://tasks.yak.sh/T#3f9a1c2e7b'), undefined)
  assertEquals(entityId('https://tasks.yak.sh/3f9a1c2e'), undefined)
  let entry = { id: 1, ts: '2026-09-10T00:00:00Z', actor: eid, changes: [] }
  assertStringIncludes(historyLine(entry), '#3f9a1c2e7b')
  assertStringIncludes(
    historyLine(entry, new Map([[eid, 'T#3f9a1c2e7b']])),
    'T#3f9a1c2e7b',
  )
  assert(!historyLine(entry).includes('3f9a1c2e-7b00-'))
})
