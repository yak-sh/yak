import { assertEquals } from '@std/assert'
import { pickLine } from './hits.ts'
import { EXISTS, parseQuery, TEXT } from '../query.ts'

// pickLine's output must be a LEGAL query line. The trap it guards is a
// presence filter with a trailing term ('.person! ali'), which parseQuery
// rejects outright ("presence filters end at !"): so every form here is both
// shape-checked AND fed through parseQuery, which throws on a bad line.
Deno.test('pickLine builds parseable picker queries', () => {
  // a doc picker keeps typed text a single text pred, so the server's
  // id-addressing (findEid) can still resolve a typed human id
  assertEquals(pickLine('T-3'), 'T-3')
  // an empty doc picker lists recent documented entities
  assertEquals(pickLine(''), '.doc!')
  // a component picker: the term LEADS, the presence filter TRAILS
  assertEquals(pickLine('ali', 'person'), 'ali .person!')
  // an empty component picker is the bare presence filter
  assertEquals(pickLine('', 'person'), '.person!')

  // the combined line parses to a text term AND a person-presence pred —
  // proof it screens by component rather than silently searching text alone
  let preds = parseQuery(pickLine('ali', 'person'))
  assertEquals(
    preds.some((p) => p.op == TEXT && p.value == 'ali'),
    true,
  )
  assertEquals(
    preds.some((p) => p.comp == 'person' && p.prop == '' && p.op == EXISTS),
    true,
  )

  // none of the forms a picker emits may throw at the parser
  for (
    let line of [
      pickLine('T-3'),
      pickLine(''),
      pickLine('ali', 'person'),
      pickLine('', 'person'),
      pickLine('widget line', 'task'),
      pickLine('.status=open', 'task'),
    ]
  ) parseQuery(line)
})
