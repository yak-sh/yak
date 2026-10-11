// A browser's guest work, and the durable handover when it signs in. The
// directory keeps one browser and a worked edge to each app it reached. The
// edge remains unfinished until that store has filled every matching byline.
import { link } from '@yaks/edge'
import { type Bundle, type Comp, type Graph, Stale, token } from '@yaks/graph'
import { KERNEL, meta } from './meta.ts'
import type { Env } from './env.ts'
import { browserOf } from './session.ts'

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
  let bundles = rows.map((r) => {
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
  if (bundles.length) {
    await graph.apply(bundles, { trusted: true, stamp: false })
  }
  return { filled: bundles.length, more: bundles.length == size }
}

export { attributionDoc, registrationDoc } from './facets/attribution-vocab.ts'
