// Edited source inputs owe their own tracker work.

import { equal, test } from '@yaks/testing'
import { fixture } from './fixture_test.ts'
import { capture } from './report.ts'
import { enrichFrames } from './frames.ts'
import { comp } from './model.ts'

let edited = fixture({
  enrich: enrichFrames((frames) => Promise.resolve(frames)),
})
let error = new Error('before')
error.stack = 'Error: before\n at first (file:///srv/a.ts:10:2)'
await edited.apply(capture(error, { sink: () => {}, eid: 'edited-error' }), {
  trusted: true,
})
await edited.apply([{
  entity: { eid: 'edited-error' },
  error: { commit: 'a'.repeat(40) },
  exception: { stack: 'Error: after\n at second (file:///srv/b.ts:20:3)' },
}], { trusted: true })
let [changed] = await edited.get(['edited-error'])
let frames = comp(changed, 'exception').frames as { file: string }[]
test('editing a grouped occurrence stack resolves its new frames without restart', () => {
  equal(frames[0].file, 'file:///srv/b.ts')
})
