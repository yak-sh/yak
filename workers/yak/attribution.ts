// A browser's guest work, and the durable handover when it signs in. The
// directory keeps one browser and a worked edge to each app it reached. The
// edge remains unfinished until that store has filled every matching byline.
import { link } from '@yaks/edge'
import { kernelDoc } from '@yaks/kernel/vocab'
import { type Bundle, type Comp, type Graph, Stale, token } from '@yaks/graph'
import { effectsIn, pick, type VocabDoc } from '@yaks/vocab'
import { KERNEL, meta } from './meta.ts'
import type { Env } from './env.ts'
import type { Plugin } from './plugin.ts'
import { browserOf } from './session.ts'

let pending = '.worked .edge.from.browser.by !completed'

export let attributionDoc: VocabDoc = {
  $defs: {
    browser: {
      component: true,
      type: 'object',
      description: 'a platform-vouched writing browser, claimed on sign-in',
      properties: {
        by: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          stamped: true,
          description: 'the person who claimed this browser’s guest work',
        },
      },
    },
    attribute_writes: {
      effect: true,
      created: ['worked'],
      changed: ['worked'],
      active: pending,
      sweep: pending,
      description: 'fill the authors of a signed-in browser’s guest rows',
    },
  },
}

/** Register a committed guest write. A durable app effect owes this receipt,
 * so signing in and a reset may happen before the directory learns about it. */
export let contributed = async (
  env: Pick<Env, 'STORE'>,
  via: string,
  app: string,
) => {
  await meta(env).apply([
    { entity: { eid: via }, browser: {} },
    { ...link(via, 'worked', app), completed: null },
  ], KERNEL)
}

/** The verified cookie alone can claim guest work. Touching its receipts in
 * this same transaction owes durable runs; the sweep also covers a restart. */
export let claimed = async (req: Request, env: Env, by: string) => {
  let browser = env.SESSION_SECRET && await browserOf(req, env.SESSION_SECRET)
  if (!browser) return
  let g = meta(env)
  let rows = await g.query(`.entity.eid=${browser.via} .browser`)
  let held = rows[0]?.browser as Comp | undefined
  if (held?.by) return
  let receipts = await g.query(`.worked .edge.from=${browser.via} !completed`)
  try {
    await g.apply([
      {
        entity: { eid: browser.via },
        browser: { by },
        $was: { browser: { by: null } },
      },
      ...receipts.map((r) => ({ entity: r.entity, worked: {} })),
    ], KERNEL)
  } catch (error) {
    // Two sign-ins may race; the first verified claimant keeps the byline.
    if (!(error instanceof Stale)) throw error
  }
}

/** One bounded store pass. Attribution changes preserve when and how each
 * stamp was written; matching one stamp never assigns the other one's author. */
export let attributed = async (
  graph: Graph,
  via: string,
  by: string,
  size = 30,
) => {
  let rows = await graph.read(
    `(.created.via=${via} !created.by|.updated.via=${via} !updated.by) .limit=${size} ?created ?updated`,
  ) as Bundle[]
  let change = rows.map((r) => {
    let out: Bundle = { entity: r.entity, $was: {} }
    for (let name of ['created', 'updated']) {
      let stamp = r[name] as Comp | undefined
      if (stamp?.via == via && !stamp.by) {
        out[name] = { by }
        out.$was![name] = { by: null, via: token(via) }
      }
    }
    return out
  })
  if (change.length) await graph.apply(change, { trusted: true, stamp: false })
  return { filled: change.length, more: change.length == size }
}

export let registrationDoc: VocabDoc = {
  $defs: {
    register_writes: {
      effect: true,
      created: ['created'],
      changed: ['updated'],
      active: '(.created.via !created.by|.updated.via !updated.by)',
      sweep: '(.created.via !created.by|.updated.via !updated.by)',
      description: 'register this browser’s guest work for durable attribution',
    },
  },
}

export let attributionPlugin: Plugin = {
  name: 'attribution',
  vocab: [attributionDoc, pick(kernelDoc, ['completed'])],
  effects: [(on, at) => {
    if (!at.env.STORE) return
    if (!at.meta) {
      if (
        !effectsIn(at.graph.vocab.docs).some((e) => e.name == 'register_writes')
      ) return
      on.handle({
        register_writes: async (event, tx) => {
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
        },
      })
      return
    }
    on.handle({
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
          let { appOf, appStore, spaceOf } = await import('./directory.ts')
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
    })
  }],
}
