// Explicitly owed work uses the same durable rows as declared graph triggers.
import type { Access, Eid } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { effectsIn } from '@yaks/vocab'

/** Owe one fresh invocation independently of a component transition. */
export let enqueue = (g: Access, handler: string, target: Eid) => {
  if (!g.vocab.comp('effect')) throw new Refused('No durable effect pool')
  if (!effectsIn(g.vocab.docs).some((effect) => effect.name == handler)) {
    throw new Refused('No declared effect: ' + handler)
  }
  return g.apply([{
    entity: { eid: crypto.randomUUID() },
    effect: {
      handler,
      target,
      kind: 'matched',
      state: 'pending',
      attempts: 0,
      generation: 0,
      at: new Date().toISOString(),
    },
  }], { trusted: true })
}
