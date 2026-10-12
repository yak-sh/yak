import { test } from '@yaks/testing'
import './testing.ts'
import { assertEquals } from '@std/assert'
import { scalar } from '@yaks/query'
import {
  adopt,
  edgeRider,
  matchQuery,
  pageRanked,
  parseQuery,
  resolveRefs,
  windowOf,
} from './query.ts'

test('browser matching preserves quoted lists and ranges and literal AST scalars', () => {
  let titles = ['a,b', 'a..b', 'a', 'b']
  let select = (q: string) =>
    titles.filter((title) => matchQuery({ doc: { title } }, parseQuery(q)))
  assertEquals(select('.doc.title="a,b"'), ['a', 'b'])
  assertEquals(select(".doc.title='a..b'"), titles)
  assertEquals(select('.doc.title="a,b",a'), ['a,b', 'a'])
  assertEquals(select('.doc.title=a..b'), titles)
  for (let value of ['a,b', 'a..b']) {
    let preds = [{
      comp: 'doc',
      prop: 'title',
      op: '',
      value,
      operand: scalar(value),
    }]
    assertEquals(
      titles.filter((title) => matchQuery({ doc: { title } }, preds)),
      [value],
    )
    assertEquals(adopt(preds), { doc: { title: value } })
  }
  assertEquals(adopt(parseQuery('.doc.title="a,b"')), {})
})

test('saved reference literals resolve as one operand', () => {
  let eid = '11111111-1111-4111-8111-111111111111'
  for (let name of ['person,one', 'person..two']) {
    let seen: string[] = []
    let preds = resolveRefs(
      [{
        comp: 'filed',
        prop: 'assignee',
        op: '',
        value: name,
        operand: scalar(name),
      }],
      (value) => {
        seen.push(value)
        return eid
      },
    )
    assertEquals(seen, [name])
    assertEquals(matchQuery({ filed: { assignee: eid } }, preds), true)
  }
})

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

test('a saved reference query resolves against each caller without changing it', () => {
  let line = '.filed.assignee=person'
  for (
    let eid of [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]
  ) {
    assertEquals(resolveRefs(parseQuery(line), () => eid)[0].value, eid)
    assertEquals(parseQuery(line)[0].value, 'person')
  }
})

test('a drop on a board of everything under a project files it there', () => {
  assertEquals(adopt(parseQuery('.filed.project->p1&.filed.priority=2')), {
    filed: { project: 'p1', priority: 2 },
  })
  assertEquals(adopt(parseQuery('.filed.project<-p1')), {})
})
