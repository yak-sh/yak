import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { LONG, type Read, sessionName } from './name.ts'

let s = (more: Record<string, unknown> = {}): Bundle => ({
  entity: { eid: 's1' },
  session: { id: 's1' },
  ...more,
})
let titled = (title: string): Bundle => ({
  entity: { eid: title },
  doc: { title },
})
let said = (body: string, more: Record<string, unknown> = {}): Bundle => ({
  entity: { eid: body },
  content: { body },
  ...more,
})

test('a session is named by what it works on, then by what it says', () => {
  let cases: [Bundle, Read, string][] = [
    [s(), { claim: [titled('Held')], work: [titled('Worked')] }, 'Held'],
    [s(), {
      work: [{ entity: { eid: 'e' }, edge: { to: 't' } }, titled('Worked')],
    }, 'Worked'],
    [s({ doc: { title: 'Own' } }), { first: [said('hi')] }, 'Own'],
    [
      s(),
      { first: [said('a notice', { notice: {} }), said('the  person')] },
      'the person',
    ],
    [s(), {
      first: [said('reply', { output: {} }), said('a notice', { notice: {} })],
    }, 'a notice'],
    [s({ brief: { text: 'Work T-9' } }), {}, 'Work T-9'],
    [s({ session: { id: 's1', operator: true } }), {}, 'Personal conversation'],
    [s({ process: { command: 'claude -p --append-system-prompt …' } }), {}, ''],
  ]
  for (let [e, read, name] of cases) assertEquals(sessionName(e, read), name)
  assertEquals(
    sessionName(s(), { first: [said('x'.repeat(500))] }).length,
    LONG,
  )
})
