// A credential's owner decides whether app code receives the key itself.
// Enforced in the directory transaction, across tools and graph writes.
import { after, each } from '@yaks/fp'
import type { Actor, Bundle, Comp, Plugin, Tx } from '@yaks/graph'
import { dead } from '@yaks/graph/bundle'
import { writers } from '@yaks/graph/provenance'
import { Refused } from '@yaks/graph/errors'
import { hook } from '@yaks/graph/plugin'
import { line } from '@yaks/query'

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

let patches = (bundles: Bundle[]): Bundle[] => {
  let out = new Map<string, Bundle>()
  for (let b of bundles) {
    if (b.uses === undefined && b.edge === undefined && !dead(b)) continue
    let at = out.get(b.entity.eid) ?? { entity: b.entity }
    if (b.$delete === true) at.$delete = true
    for (let name of ['uses', 'edge', 'tombstone']) {
      if (b[name] === undefined) continue
      at[name] = b[name] === null
        ? null
        : { ...comp(at, name), ...comp(b, name) }
    }
    out.set(b.entity.eid, at)
  }
  return [...out.values()]
}

let owned = (tx: Tx, person: string | null, owner: unknown) =>
  typeof owner != 'string' || !person ? false : owner == person ? true : after(
    tx.read(
      line`.member.space=${owner}&.member.person=${person}&.member.role=owner`,
    ),
    (rows) => rows.length > 0,
  )

/** The authenticated person behind a writer, independent of its byline. */
export let connectionAccess = (
  person: (actor: Actor) => string | null,
): Plugin => ({
  name: 'yak/connections',
  hooks: {
    precondition: hook(['uses', 'edge', 'tombstone', '$delete'], (
      bundles,
      tx,
      _err,
      context,
    ) => {
      let writer = writers(bundles)
      let touched = patches(bundles)
      if (!touched.length) return bundles
      return after(tx.get(touched.map((b) => b.entity.eid)), (rows) => {
        let held = new Map(rows.map((b) => [b.entity.eid, b]))
        return each(touched, bundles, (out, b) => {
          let actor = writer(b.entity.eid)
          if (context?.trusted && !actor.by && !actor.via) return out
          let was = held.get(b.entity.eid)
          let before = comp(was, 'uses').direct === true
          let dropped = dead(b) || b.uses === null
          let direct = dropped ? false : comp(b, 'uses').direct
          let now = direct === undefined ? before : direct === true
          let edge = { ...comp(was, 'edge'), ...comp(b, 'edge') }
          if (before == now && (!now || edge.to == comp(was, 'edge').to)) {
            return out
          }
          let targets = [...new Set([comp(was, 'edge').to, edge.to])]
            .filter((to): to is string => typeof to == 'string')
          return after(tx.get(targets, ['connection']), (connections) => {
            // A new ask has no credential or kept connection yet. Once it
            // exists, even removing and recreating its link needs its owner.
            if (!connections.length && !was) return out
            return each(
              connections.length ? connections : [undefined],
              out,
              (out, connection) =>
                after(
                  owned(
                    tx,
                    person(actor),
                    comp(connection, 'connection').owner,
                  ),
                  (yes) => {
                    if (!yes) {
                      throw new Refused(
                        'Only the connection’s owner can change whether an app receives its key directly',
                      )
                    }
                    return out
                  },
                ),
            )
          })
        })
      })
    }),
  },
})
