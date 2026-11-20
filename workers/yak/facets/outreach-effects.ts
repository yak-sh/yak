// The directory's outreach trials (outreach.ts): a new trial sends its batch,
// and each firing of its wake reads it back.
import type { Handlers } from '@yaks/effects'
import { batches } from '@yaks/anthropic/batches'
import type { Options } from './store.ts'
import { inStore } from './directory-effects.ts'
import { collect, factsOf, write } from '../outreach.ts'

export let effects = (_host: unknown, options: Options): Handlers => {
  let at = options.store
  if (!at.meta) return {}
  let facts = async (now: Date) => factsOf(await inStore(at).census(), now)
  let api = batches({
    key: () => {
      let key = at.env.ANTHROPIC_API_KEY
      if (!key) throw new Error('outreach trials need ANTHROPIC_API_KEY')
      return key
    },
  })
  return {
    outreach_write: async (event) =>
      await write(at.graph, facts, api, event.entity.eid),
    outreach_read: async (event) =>
      await collect(at.graph, facts, api, event.entity.eid),
  }
}
