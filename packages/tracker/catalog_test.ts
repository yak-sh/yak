// Restart outages wait in the effects pool. A terminal report stays useful
// tracker text, but cannot recursively ask the failed catalog to enrich it.

import { equal, test } from '@yaks/testing'
import { docDoc } from '@yaks/doc'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { toolsDoc } from '@yaks/tools/vocab'
import { effects as registry } from '@yaks/effects'
import { effectDoc } from '@yaks/effects/vocab'
import { catalogAt } from '@yaks/code/source'
import { computed, trackerDoc } from './vocab.ts'
import { effects } from './effects.ts'
import { enrichFrames } from './frames.ts'
import { capture } from './report.ts'
import { comp } from './model.ts'

for (let recover of [true, false]) {
  test(`catalog outage is bounded and reports no cascade (recover=${recover})`, async () => {
    let vocab = loadVocab([
      kernelDoc,
      toolsDoc,
      docDoc,
      trackerDoc,
      effectDoc,
    ], [kernelKeywords])
    let storage = ram(vocab, { computed })
    let g = graph({ vocab, storage })
    let now = 0, calls = 0, reports = 0, ready = false
    let reporting: (unknown | Promise<unknown>)[] = []
    let fx = registry(vocab, {
      write: (b) => g.apply(b, { trusted: true }),
      now: () => now,
      report: (error, job) => {
        reports++
        reporting.push(g.apply(
          capture(error, {
            sink: () => {},
            eid: 'catalog-failure',
            tags: { handler: job.handler },
            during: { entity: job.event.entity.eid },
          }),
          { trusted: true },
        ))
      },
    })
    g = graph({ vocab, storage, plugins: [fx] })
    let catalog = catalogAt('http://catalog.test', () => {
      calls++
      if (!ready) return Promise.reject(new TypeError('Connection refused'))
      return Promise.resolve(Response.json([]))
    })
    let enrich = enrichFrames(async (frames) => {
      await catalog.get(['module'])
      return frames.map((f) => ({ ...f, app: true, symbol: 'linked' }))
    })
    fx.handle(effects({ graph: g }, { enrich }))
    let error = new Error('original')
    error.stack = 'Error: original\n at fail (file:///srv/a.ts:10:2)'
    await g.apply(capture(error, { sink: () => {}, eid: 'original' }), {
      trusted: true,
    })
    await fx.work(g)
    await fx.idle()
    equal(reports, 0)
    ready = recover
    for (now of [1_000, 3_000]) {
      await fx.work(g)
      await fx.idle()
    }
    await Promise.all(reporting)
    await fx.work(g)
    await fx.idle()
    equal(reports, recover ? 0 : 1)
    equal(calls, recover ? 2 : 3)
    let [original] = await g.get(['original'])
    equal(comp(original, 'exception').stack, error.stack)
    equal(comp(original, 'exception').value, 'original')
    let bug = String(comp(original, 'error').bug)
    equal(comp((await g.get([bug]))[0], 'bug').hits, 1)
    if (!recover) {
      let failures = await g.read(
        '.effect.handler=error_frames .effect.state=failed',
      )
      equal(failures.length, 1)
      ready = true
      let next = registry(vocab, {
        write: (b) => g.apply(b, { trusted: true }),
      })
      next.handle(effects({ graph: g }, { enrich }))
      await next.work(g)
      await next.idle()
      equal(calls, 4)
      equal(reports, 1)
      await next.stop()
    }
    let [filled] = await g.get([bug])
    equal(comp(filled, 'bug').culprit, 'linked')
    equal(comp(filled, 'bug').hits, 1)
    await fx.stop()
  })
}
