// Catalog outages wait in the effects pool. A terminal report stays useful
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
import { runs } from '@yaks/effects/tools'
import { catalogAt } from '@yaks/code/source'
import { computed, trackerDoc } from './vocab.ts'
import { effects } from './effects.ts'
import { enrichFrames } from './frames.ts'
import { capture } from './report.ts'
import { comp } from './model.ts'

let vocab = loadVocab([
  kernelDoc,
  toolsDoc,
  docDoc,
  trackerDoc,
  effectDoc,
], [kernelKeywords])

for (let recover of [true, false]) {
  let checked = await (async () => {
    let storage = ram(vocab, { computed })
    let g = graph({ vocab, storage })
    let now = 0, calls = 0, reports = 0, ready = false
    let symbol = crypto.randomUUID()
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
            during: job.event ? { entity: job.event.entity.eid } : undefined,
          }),
          { trusted: true },
        ))
      },
    })
    g = graph({ vocab, storage, plugins: [fx] })
    let catalog = catalogAt('http://catalog.test', () => {
      calls++
      if (!ready) {
        return recover
          ? Promise.reject(new DOMException('catalog timeout', 'TimeoutError'))
          : Promise.resolve(new Response('unknown catalog', { status: 404 }))
      }
      return Promise.resolve(Response.json([]))
    })
    let enrich = enrichFrames(async (frames) => {
      await catalog.get(['module'])
      return frames.map((f) => ({ ...f, app: true, symbol }))
    })
    fx.handle(effects({ graph: g }, { enrich }))
    let error = new Error('original')
    error.stack = 'Error: original\n at fail (file:///srv/a.ts:10:2)'
    await g.apply(capture(error, { sink: () => {}, eid: 'original' }), {
      trusted: true,
    })
    await fx.work(g)
    await fx.idle()
    if (recover) equal(reports, 0)
    for (now of [1_000, 3_000, 7_000]) {
      await fx.work(g)
      await fx.idle()
    }
    // Temporary unavailability keeps the original run owed without reports.
    if (recover) equal(reports, 0)
    ready = recover
    now = 31_000
    await fx.work(g)
    await fx.idle()
    if (!recover) {
      // A sustained outage is still bounded and leaves a visible failure.
      for (let i = 0; i < 12; i++) {
        now += 300_000
        await fx.work(g)
        await fx.idle()
      }
    }
    await Promise.all(reporting)
    await fx.work(g)
    await fx.idle()
    equal(recover ? reports == 0 : reports > 0, true)
    let failedReports = reports
    if (recover) equal(calls < 20, true)
    let [original] = await g.get(['original'])
    equal(comp(original, 'exception').stack, error.stack)
    equal(comp(original, 'exception').value, 'original')
    let bug = String(comp(original, 'error').bug)
    equal(comp((await g.get([bug]))[0], 'bug').hits, 1)
    if (!recover) {
      let failures = await g.read(
        '.effect.handler=error_frames .effect.state=failed',
      )
      equal(failures.length > 0, true)
      ready = true
      let next = registry(vocab, {
        write: (b) => g.apply(b, { trusted: true }),
        now: () => now,
      })
      next.handle(effects({ graph: g }, { enrich }))
      await next.work(g)
      await next.idle()
      equal(reports, failedReports)
      equal(comp((await g.get([bug]))[0], 'bug').culprit, undefined)
      await runs({ vocab }).effect_retry({
        entity: { eid: 'retry-catalog' },
        call: { args: { of: 'error_frames' } },
      }, g)
      await next.work(g)
      await next.idle()
      await next.stop()
    }
    let [filled] = await g.get([bug])
    equal(comp(filled, 'bug').culprit, symbol)
    equal(comp(filled, 'bug').hits, 1)
    await fx.stop()
    return { reports, culprit: comp(filled, 'bug').culprit, symbol }
  })()
  test(`catalog readiness defers; terminal failures need explicit retry (recover=${recover})`, () => {
    equal(checked.culprit, checked.symbol)
    equal(recover ? checked.reports == 0 : checked.reports > 0, true)
  })
}
