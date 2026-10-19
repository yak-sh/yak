// Readiness changes and edited source inputs owe their own tracker work.

import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { effectDoc, effects as registry } from '@yaks/effects'
import { fixture, vocab } from './fixture_test.ts'
import { effects, type Options } from './effects.ts'
import { capture } from './report.ts'
import { enrichFrames } from './frames.ts'
import { comp } from './model.ts'

let pooled = loadVocab([...vocab.docs, effectDoc])
let now = 0, notified: string[] = [], reports: unknown[] = []
let options: Options = {}
let fx = registry(pooled, {
  write: (b) => g.apply(b, { trusted: true }),
  now: () => now,
  report: (error) => reports.push(error),
})
let g = graph({ vocab: pooled, storage: ram(pooled), plugins: [fx] })
fx.handle(effects({ graph: g }, options))
await g.apply([{
  entity: { eid: 'waiting-bug' },
  bug: { fault: 'missing configuration' },
}], { trusted: true })
await fx.work(g)
await fx.idle()
let before = [...notified]
let pending = await g.read('.effect.handler=bug_notify .effect.state=pending')
options.notify = (bugs) => {
  notified.push(...bugs.map((b) => b.entity.eid))
}
now = 60_000
await fx.work(g)
await fx.idle()
await fx.stop()
test('tracker notification resumes from the same debt when its destination arrives', () => {
  equal(before, [])
  equal(pending.length > 0, true)
  equal(pending.every((b) => comp(b, 'effect').attempts == 0), true)
  equal(notified, ['waiting-bug'])
  equal(reports, [])
})

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
