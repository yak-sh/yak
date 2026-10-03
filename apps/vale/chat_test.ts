// Recent conversation expires without deleting stored chat or unsent drafts.
import { equal, test } from '@yaks/testing'
import { history, type Line, RECENT } from './chat.ts'

test('chat keeps only recent lines, including while the panel stays open', () => {
  let now = Date.UTC(2026, 9, 2)
  let line = (eid: string, at: number): Line => ({
    eid,
    at,
    player: 'hero',
    by: 'person',
    text: eid,
  })
  let old = [line('days ago', now - 3 * 86400000)]
  let recent = line('recent', now - 1000)
  equal(history(old, [recent], Infinity, now), [recent])
  equal(history([recent], [], Infinity, now + RECENT), [])
})
