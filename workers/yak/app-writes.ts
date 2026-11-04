// Write normalization and the kernel's vouched person, inside the graph's
// transaction. These plugins depend on vocabulary and authority, never on a
// Durable Object or its storage.
import { after } from '@yaks/fp'
import type { Actor, Bundle, Plugin } from '@yaks/graph'
import { comps } from '@yaks/graph/bundle'
import { actorOf as writerOf } from '@yaks/graph/provenance'
import { sha256 } from '@yaks/graph/sha256'
import { actorOf } from '@yaks/member'
import type { Vocab } from '@yaks/vocab'
import type { Vouch } from './app-authority.ts'

/** One mirrored grant for each app and person, however often vouched. */
export let grantEid = (app: string, person: string): string =>
  sha256(`grant\x00${app}\x00${person}`)

/** Lower named references to the eid the vocabulary stores. */
export let lowering = (vocab: () => Vocab): Plugin => ({
  name: 'yak/lower',
  hooks: {
    normalize: (bundles) =>
      bundles.map((b) => {
        let out: Record<string, unknown> | null = null
        for (let [name, comp] of comps(b)) {
          if (!comp) continue
          for (let [prop, v] of Object.entries(comp)) {
            let eid = (v as { eid?: unknown } | null)?.eid
            if (
              typeof eid != 'string' ||
              vocab().prop(name, prop)?.category != 'ref'
            ) continue
            out ??= { ...b }
            out[name] = {
              ...(out[name] as Record<string, unknown>),
              [prop]: eid,
            }
          }
        }
        return (out ?? b) as Bundle
      }),
  },
})

/** Mirror vouched authority before guards run; refusal rolls it back. */
export let vouching = ({ app, authority }: {
  app: () => string | null
  authority: (actor: Actor | null | undefined) => Vouch | undefined
}): Plugin => {
  let told = new Map<string, string>()
  let untold = (bundles: Bundle[]) => {
    let v = authority(writerOf(bundles))
    let who = v?.person
    if (!who || !v) return null
    let held = app()
    let said = `${held ?? ''} ${v.level ?? ''} ${v.title ?? ''}`
    return told.get(who) == said ? null : { who, v, app: held, said }
  }

  return {
    name: 'yak/vouch',
    // The two rows the hook below writes — a person and their grant. Naming
    // them here puts them in the batch's own gather, so the store learns their
    // identities in the read every batch already takes rather than in one of
    // its own (T-34032).
    admission: () => true,
    wants: (bundles) => {
      let vouch = untold(bundles)
      if (!vouch) return []
      let { who, app } = vouch
      return [{ eids: app ? [who, app, grantEid(app, who)] : [who] }]
    },
    hooks: {
      precondition: (bundles, tx, _err, context) => {
        let vouch = untold(bundles)
        if (!vouch) return bundles
        let { who, v, app, said } = vouch
        if (!context?.admission) told.set(who, said)
        // Admission mirrors the same rows in its temporary transaction so
        // rules see exactly what an ordinary write sees, without retaining it.
        // The app writing as itself (dispatch.ts `owning`, `env.APP`) is the
        // one actor that is not a person: it is already a row here, carrying
        // this store's `access`, and calling it a person would put the app in
        // its own `.person` listing. Its grant is still written — that is
        // what @yaks/member's guard reads to admit the write.
        let out: Bundle[] = who == app ? [] : [{
          entity: { eid: who },
          person: {},
          ...(v.title ? { doc: { title: v.title } } : {}),
        }]
        if (app && v.level) {
          out.push({
            entity: { eid: grantEid(app, who) },
            grant: { app, person: who, access: v.level },
          })
        }
        if (!out.length) return bundles
        return after(tx.patch(out), () => bundles)
      },
      // The transaction is gone, taking the rows above with it — because the
      // batch was refused, or because it was only ever a rehearsal
      // (@yaks/graph `Checked`, the `?check=1` half of a write that spans two
      // stores). Either way what this object believes it has written down goes
      // too, or the next batch by that person would skip a row that is not
      // there.
      audit: (bundles, _tx, _err, context) => {
        if (context?.admission) return bundles
        let who = authority(writerOf(bundles))?.person ?? actorOf(bundles)
        if (who) told.delete(who)
        return bundles
      },
    },
  }
}
