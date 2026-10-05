import { test } from '@yaks/testing'
import './testing.ts'
import { assertEquals } from '@std/assert'
import { adopt, edgeRider, pageRanked, parseQuery, windowOf } from './query.ts'

test('edge selectors accept boolean and named relation declarations', () => {
  for (let type of ['cites', 'imports', 'referenced']) {
    assertEquals(edgeRider(parseQuery(`.edges[${type}]`))?.select, { type })
  }
})

test('a web query pages past an entity without a number', () => {
  let win = windowOf(parseQuery('.limit=2&.after=child:abc'))
  assertEquals(win, { limit: 2, after: 'child:abc' })
  assertEquals(
    pageRanked([
      { eid: 'first' },
      { eid: 'child:abc' },
      { eid: 'last' },
    ], win).map((row) => row.eid),
    ['last'],
  )
})

test('a drop on a board of everything under a project files it there', () => {
  assertEquals(adopt(parseQuery('.filed.project->p1&.filed.priority=2')), {
    filed: { project: 'p1', priority: 2 },
  })
  assertEquals(adopt(parseQuery('.filed.project<-p1')), {})
})
