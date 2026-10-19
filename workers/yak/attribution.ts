// A browser's guest work, and the durable handover when it signs in. The
// directory keeps one browser and a worked edge to each app it reached. The
// edge remains unfinished until that store has filled every matching byline.
import { link } from '@yaks/edge'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import { KERNEL, meta } from './meta.ts'
import type { Env } from './env.ts'
import { browserOf } from './session.ts'
import { instrumentEid } from './instrument.ts'

/** Register a committed guest write. A durable app effect owes this receipt,
 * so signing in and a reset may happen before the directory learns about it. */
export let contributed = async (
  env: Pick<Env, 'STORE'>,
  via: string,
  app: string,
) => {
  via = instrumentEid(via)
  await meta(env).apply([
    { entity: { eid: via }, browser: {} },
    { ...link(via, 'worked', app), completed: null },
  ], KERNEL)
}

/** The verified cookie alone can claim guest work. Touching its receipts in
 * this same transaction owes durable runs, which survive a restart. */
export let claimed = async (req: Request, env: Env, by: string) => {
  let browser = env.SESSION_SECRET && await browserOf(req, env.SESSION_SECRET)
  if (!browser) return
  let g = meta(env)
  let vias = [
    ...new Set([browser.via, ...browser.source ? [browser.source] : []]),
  ]
  let found = await g.query(
    `.entity.eid=${vias.join(',')} .browser|.worked .edge.from=${
      vias.join(',')
    } !completed`,
  )
  let rows = found.filter((row) => row.browser)
  if (
    rows.some((row) => {
      let held = (row.browser as Comp | undefined)?.by
      return held && held != by
    })
  ) return
  let claiming = new Set([
    ...rows.filter((row) => !(row.browser as Comp | undefined)?.by)
      .map((row) => row.entity.eid),
    ...rows.some((row) => row.entity.eid == browser.via) ? [] : [browser.via],
  ])
  if (!claiming.size) return
  let receipts = found.filter((row) => row.worked)
  try {
    await g.apply([
      ...[...claiming].map((via) => ({
        entity: { eid: via },
        browser: { by },
        $was: { browser: { by: null } },
      })),
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
  let vias = [...new Set([via, instrumentEid(via)])]
  let rows = await graph.read(
    `(.created.via=${vias.join(',')} !created.by|.updated.via=${
      vias.join(',')
    } !updated.by) .limit=${size} ?created ?updated`,
  ) as Bundle[]
  let bundles = rows.map((r) => {
    let out: Bundle = { entity: r.entity, $was: {} }
    for (let name of ['created', 'updated']) {
      let stamp = r[name] as Comp | undefined
      if (
        typeof stamp?.via == 'string' && vias.includes(stamp.via) && !stamp.by
      ) {
        out[name] = { by }
        out.$was![name] = { by: null, via: token(stamp.via) }
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
