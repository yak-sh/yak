// Durable registration and handover of guest writes.
import type { Comp } from '@yaks/graph'
import type { Handlers } from '@yaks/effects'
import { effectsIn } from '@yaks/vocab'
import type { Options } from './store.ts'
import { contributed } from '../attribution.ts'
import { KERNEL } from '../meta.ts'
import { maintenance } from '../used.ts'

export let effects = (_host: unknown, options: Options): Handlers => {
  let at = options.store

  if (!at.env.STORE) return {}
  if (!at.meta) {
    if (
      !effectsIn(at.graph.vocab.docs).some((e) => e.name == 'register_writes')
    ) return {}
    return {
      register_writes: maintenance(async (event, tx) => {
        if (!at.app) return
        let [row] = await tx.get([event.entity.eid])
        let vias = new Set<string>()
        for (let name of ['created', 'updated']) {
          let stamp = row?.[name] as Comp | undefined
          if (typeof stamp?.via == 'string' && !stamp.by) vias.add(stamp.via)
        }
        for (let via of vias) {
          await contributed({ STORE: at.env.STORE! }, via, at.app)
        }
      }),
    }
  }
  return {
    attribute_writes: async (event, tx, write, attempt) => {
      let [receipt] = await tx.get([event.entity.eid])
      // Each committed registration owes a run. An earlier run may finish
      // after a newer registration, so its completed mark cannot cancel
      // this run; the store pass itself is repeatable.
      if (!receipt) return
      let edge = receipt.edge as { from: string; to: string }
      let [browser, app] = await tx.get([edge.from, edge.to])
      let by = (browser?.browser as Comp | undefined)?.by
      if (!by) return
      if (app?.app && !app.tombstone) {
        let { appOf, appStore, spaceOf } = await import('../directory.ts')
        let a = appOf(app as Parameters<typeof appOf>[0])
        let [space] = await tx.get([a.space])
        if (!space?.space || space.tombstone) return
        let door = appStore(
          at.env.STORE!,
          spaceOf(space as Parameters<typeof spaceOf>[0]),
          a,
          at.env,
        )
        let result = await door.consume(
          '/attribute',
          async (r) => {
            if (!r.ok) {
              throw Object.assign(
                new Error(`guest attribution answered ${r.status}`),
                r.status >= 500 || r.status == 409
                  ? { retry: { after: 1000 } }
                  : {},
              )
            }
            return await r.json() as { filled: number; more: boolean }
          },
          { method: 'POST', body: JSON.stringify({ via: edge.from, by }) },
          KERNEL,
        )
        if (result.filled) await attempt?.progressed()
        if (result.more) {
          throw Object.assign(
            new Error('guest attribution has another slice'),
            { retry: { after: 1 } },
          )
        }
      }
      await write([{ entity: receipt.entity, completed: {} }])
    },
  }
}
