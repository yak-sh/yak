// The directory's outreach trials (@yaks/platform/outreach-trial): a new trial
// sends its batch, and each firing of its wake reads it back. Each provider's
// batches open with the key its Operator conversations use.
import type { Handlers } from '@yaks/effects'
import type { Batches } from '@yaks/model/batch'
import { batches as anthropic } from '@yaks/anthropic/batches'
import { batches as openai } from '@yaks/openai/batches'
import { collect, type Trials, write } from '@yaks/platform/outreach-trial'
import type { Options } from './store.ts'
import { inStore } from './directory-effects.ts'
import { factsOf } from '../outreach.ts'
import { agents } from '../config.ts'

export let effects = (_host: unknown, options: Options): Handlers => {
  let at = options.store
  if (!at.meta) return {}
  let key = (name: 'ANTHROPIC_API_KEY' | 'OPENAI_OPERATOR_API_KEY') => () => {
    let held = at.env[name]
    if (!held) throw new Error(`outreach trials need ${name}`)
    return held
  }
  let batches: Record<string, Batches> = {
    anthropic: anthropic({ key: key('ANTHROPIC_API_KEY') }),
    openai: openai({ key: key('OPENAI_OPERATOR_API_KEY') }),
  }
  let [first] = agents.operator
  let trials: Trials = {
    graph: at.graph,
    facts: async (now) => factsOf(await inStore(at).census(), now),
    batches,
    fallback: { provider: first.provider, model: first.model },
  }
  return {
    outreach_write: async (event) => await write(trials, event.entity.eid),
    outreach_read: async (event) => await collect(trials, event.entity.eid),
  }
}
