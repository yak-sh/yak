// The letter a lapsed sign-in owes its person (lapsed.ts), sent once.
import type { Handlers } from '@yaks/effects'
import { Unsent } from '@yaks/mail'
import type { Options } from './store.ts'
import { ANY, letter } from '../lapsed.ts'
import { mail } from '../mail.ts'
import { caught } from '../defects.ts'

type Lapse = { person?: string; agent?: string; known?: string | null }

export let effects = (_host: unknown, options: Options): Handlers => {
  let at = options.store
  if (!at.meta) return {}
  return {
    tell_lapsed: async (event, tx) => {
      let [row] = await tx.get([event.entity.eid])
      let lapse = row?.lapsed as Lapse | undefined
      if (!lapse?.person || lapse.known) return
      let [person] = await tx.get([lapse.person])
      let to = (person?.email as { address?: string } | undefined)?.address
      if (!to) return
      try {
        await mail(at.env)({ to, ...letter(lapse.agent ?? ANY, at.env) })
      } catch (error) {
        // A letter that never left is tried again later; one that may have
        // left is reported and never sent twice.
        if (error instanceof Unsent) {
          throw Object.assign(error, { retry: { after: 60_000 } })
        }
        caught(error, { effect: 'tell_lapsed', person: lapse.person })
        return
      }
      await at.graph.apply([{
        entity: { eid: event.entity.eid },
        lapsed: { known: new Date().toISOString() },
      }], { trusted: true })
    },
  }
}
