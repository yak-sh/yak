/// <reference lib="deno.ns" />
// A module opened inside a Worker by the thread integration tests.
import type { Comp } from '@yaks/graph'
import { effectDoc, effects, until as stopped } from '@yaks/effects'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { until } from '@yaks/testing'
import { remote } from './graph.ts'
import { roles } from './roles.ts'
import type { Open } from './types.ts'

export let doc: VocabDoc = {
  $defs: {
    job: {
      component: true,
      properties: { value: { type: 'number' }, ready: { type: 'boolean' } },
    },
    answer: {
      component: true,
      properties: {
        value: { type: 'number', stamped: true },
        by: { type: 'string' },
      },
    },
    admitted: { component: true },
    mark: {
      component: true,
      properties: { live: { type: 'boolean' }, stopped: { type: 'boolean' } },
    },
    finish: { effect: true, created: ['job'] },
    admit_answer: { rule: true, match: '.answer, +!admitted' },
    answered: { effect: true, created: ['admitted'] },
  },
}
export let vocab = loadVocab([doc, effectDoc])
export let open: Open<{ gated?: boolean; fail?: boolean }> = async (start) => {
  if (start.data.fail) throw new Error('opening failed')
  if (!start.port) throw new Error('this fixture needs the owning graph')
  let graph = remote(start.port, vocab)
  await graph.apply([{ entity: { eid: start.me } }])
  let fx = effects(vocab, {
    owner: start.me,
    write: (bundles) => graph.apply(bundles, { trusted: true }),
  })
  fx.handle({
    finish: async (event, tx, write) => {
      if (start.data.gated) {
        await until(
          async () =>
            ((await tx.get([event.entity.eid]))[0]?.job as Comp | undefined)
              ?.ready,
          { timeout: 5000 },
        )
      }
      let [found] = await tx.get([event.entity.eid])
      await write([{
        entity: event.entity,
        answer: { value: Number((found.job as Comp)?.value) * 2, by: start.me },
      }])
    },
  })
  return roles(graph, {
    me: start.me,
    roles: start.roles,
    fx,
    services: {
      clock: async (signal) => {
        await graph.apply([{
          entity: { eid: 'clock' },
          mark: { live: !signal.aborted },
        }])
        await stopped(signal)
        await graph.apply([{
          entity: { eid: 'clock' },
          mark: { stopped: true },
        }])
      },
    },
    close: () => {
      graph.close()
      start.port!.close()
    },
  })
}
