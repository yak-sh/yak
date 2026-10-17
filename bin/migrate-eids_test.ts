import { equal, test } from '@yaks/testing'
import { derivedEid } from '@yaks/graph/identity'
import { legacyEid, replacer, structural, validEid } from './migrate-eids.ts'

let call = '12345678-1234-4234-8234-123456789abc'
let child = 'child:' + call, nextChild = derivedEid(child)
let mapping = new Map([[child, nextChild], [
  'repair',
  derivedEid('migrated-eid|repair'),
]])
let replace = replacer(mapping)

test('rekey dependent input and receipt use the new session address', () => {
  equal(legacyEid(child, replace), nextChild)
  equal(legacyEid(child + ':input', replace), derivedEid(nextChild + ':input'))
  equal(
    legacyEid('notice:' + child, replace),
    derivedEid('notice:' + nextChild),
  )
  equal(
    legacyEid('delivery:' + child + ':task:' + call + ':done', replace),
    derivedEid('delivery:' + nextChild + ':task:' + call + ':done'),
  )
  equal(validEid(nextChild), true)
  equal(validEid(child), false)
  equal(validEid('a'.repeat(40)), true)
  equal(validEid('a'.repeat(64)), true)
  equal(validEid('repair'), false)
})

test('structured address rewriting preserves user prose and command text', () => {
  let before = {
    session: child,
    prompt: child,
    body: 'repair',
    command: 'repair',
    q: '.entry.session=' + child,
    args: { eid: child, prompt: 'repair', query: '.created.via=' + child },
    tasks: { [child]: { doc: { body: 'repair' } } },
    content: { body: child },
  }
  equal(structural(before, mapping), {
    session: nextChild,
    prompt: child,
    body: 'repair',
    command: 'repair',
    q: '.entry.session=' + nextChild,
    args: {
      eid: nextChild,
      prompt: 'repair',
      query: '.created.via=' + nextChild,
    },
    tasks: { [nextChild]: { doc: { body: 'repair' } } },
    content: { body: child },
  })
})
