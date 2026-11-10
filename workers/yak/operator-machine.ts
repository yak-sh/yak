// An Operator's model steps on its person's own machine: the provider
// `machine`, which forwards each step through the space's tunnel to the
// providers that machine serves (@yaks/model/step), and what a step does when
// the machine can't answer it.
//
// The machine is asked for a model by the model's own name, and which of its
// providers answers is the machine's to say (@yaks/model `serving`). So the
// Operator names no provider there: config.ts `agents.machine` lists one model
// for each provider a machine lends, in the order asked. A step whose model
// the machine can't answer (the tunnel is down, the provider's allowance is
// spent, the provider takes no such input) is asked of the next provider's
// model, and then of the hosted model, which the space pays for as it pays
// for every hosted step. A step nobody asked for at that moment (a knock, a
// wake-up) has no hosted model to fall to: it waits for the machine.
import { type Model, ModelError, type Request } from '@yaks/model'

/** The provider an Operator's machine-served steps are asked of
 * (`provider{name, transport: 'machine'}`). */
export const MACHINE = 'machine'

/** What a machine is asked for: a model for each provider it lends, with the
 * stronger model of that provider coding is handed to. */
export type Lends = { model: string; delegate?: string }[]

/** One way to answer a step: a model, the name it is asked under, and whether
 * the space pays for it (a hosted model) rather than the machine's owner. */
export type Leg = { model: Model; name: string; hosted?: boolean }

/** How long a step that waits for its machine waits before it is asked again
 * (ms), at the least ({@link falling}). */
export const AWAY = 60_000

/**
 * The models a step asking the machine for `asked` goes to, in order: `asked`
 * itself, the same kind of model from each other provider the machine lends
 * (its delegate where `asked` is one, its own otherwise), then the hosted
 * model of that kind.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { namesFor } from './operator-machine.ts'
 * let lends = [{ model: 'a', delegate: 'A' }, { model: 'b', delegate: 'B' }]
 * let hosted = { model: 'h', delegate: 'H' }
 * equal(namesFor('a', lends, hosted), { machine: ['a', 'b'], hosted: 'h' })
 * equal(namesFor('B', lends, hosted), { machine: ['B', 'A'], hosted: 'H' })
 * equal(namesFor('other', lends, hosted), {
 *   machine: ['other', 'a', 'b'],
 *   hosted: 'h',
 * })
 * ```
 */
export let namesFor = (
  asked: string,
  lends: Lends,
  hosted: { model: string; delegate?: string },
): { machine: string[]; hosted: string } => {
  let strong = lends.some((l) => l.delegate == asked)
  let pick = <T extends { model: string; delegate?: string }>(l: T) =>
    strong ? l.delegate ?? l.model : l.model
  let own = lends.find((l) => l.model == asked || l.delegate == asked)
  return {
    machine: [asked, ...lends.filter((l) => l != own).map(pick)],
    hosted: pick(hosted),
  }
}

/**
 * One model out of several ways to answer: each step asks `legs(req)` in
 * order and is answered by the first that answers. A leg that fails before
 * its first output with a `ModelError` passes the step to the next; one that
 * had begun to answer, a stop the caller asked for, and the last leg's failure
 * are thrown as they came. `fell` is told before a hosted leg is asked after
 * another failed, with the request it will be sent and the failure, and
 * answers the request to send. A step with no hosted leg waits for the
 * machine: its last failure before any output is thrown as one that may pass
 * (`retry`, after {@link AWAY} at the least), so whoever runs it asks again.
 *
 * ```ts
 * import { type Model, ModelError } from '@yaks/model'
 * import { equal } from '@yaks/testing'
 * import { falling } from './operator-machine.ts'
 * let off: Model = () => Promise.reject(new ModelError('unreachable'))
 * let on: Model = (req) =>
 *   Promise.resolve({ id: 'r', model: req.model, items: [] })
 * let model = falling(() => [
 *   { model: off, name: 'mine' },
 *   { model: on, name: 'hosted', hosted: true },
 * ])
 * equal((await model({ model: 'mine', items: [], tools: [] })).model, 'hosted')
 * let waits = falling(() => [{ model: off, name: 'mine' }])
 * let error = await waits({ model: 'mine', items: [], tools: [] })
 *   .catch((e) => e)
 * equal([error.code, error.retry], ['unreachable', { after: 60_000 }])
 * ```
 */
export let falling = (
  legs: (req: Request) => Leg[] | Promise<Leg[]>,
  fell?: (req: Request, error: ModelError) => Request | Promise<Request>,
): Model =>
async (req) => {
  let all = await legs(req)
  let failed: ModelError | undefined
  for (let [i, leg] of all.entries()) {
    let begun = false
    let sent: Request = { ...req, model: leg.name }
    if (failed && leg.hosted && fell) sent = await fell(sent, failed)
    try {
      return await leg.model({
        ...sent,
        onFirst: () => {
          begun = true
          sent.onFirst?.()
        },
        onText: sent.onText && ((text) => {
          begun = true
          sent.onText!(text)
        }),
      })
    } catch (error) {
      req.signal?.throwIfAborted()
      if (!(error instanceof ModelError) || begun) throw error
      if (i == all.length - 1) {
        throw all.some((l) => l.hosted) ? error : away(error)
      }
      failed = error
    }
  }
  throw failed ?? new ModelError('provider', 'No model answers this step')
}

// A machine's failure as one that may pass: asked again after the machine's
// own wait, or after AWAY.
let away = (error: ModelError) =>
  new ModelError(
    error.code,
    error.message,
    { after: Math.max(error.retry?.after ?? 0, AWAY) },
    error.response,
  )
