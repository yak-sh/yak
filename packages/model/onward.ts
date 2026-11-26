// A step asked of a chain of models: where the provider refuses it, because
// the model asked is retired or is none it knows, or because its own account
// has nothing left to spend, the step goes on to the next model the chain
// names, so neither a model taken off a catalogue nor a provider's spent
// account ends a turn.
import { dry } from './limits.ts'
import { type Model, ModelError, type Request } from './mod.ts'

// The codes a provider's "no such model" is heard as: `model` where a
// provider package names it so (@yaks/workers-ai, @yaks/anthropic,
// @yaks/openai's own door), and OpenAI's own `model_not_found`, which an
// OpenAI-compatible API passes on as it came.
let GONE = new Set(['model', 'model_not_found'])

/**
 * Whether `error` is a provider saying it has no model by the name asked: one
 * it retired, or one it never had.
 *
 * ```ts
 * import { gone, ModelError } from '@yaks/model'
 * import { equal } from '@yaks/testing'
 * equal(gone(new ModelError('model', '5028: m was deprecated')), true)
 * equal(gone(new ModelError('model_not_found')), true)
 * equal(gone(new ModelError('busy')), false)
 * equal(gone(new Error('model')), false)
 * ```
 */
export let gone = (error: unknown): error is ModelError =>
  error instanceof ModelError && GONE.has(error.code)

/**
 * Whether `error` is a provider declining to run the request at all: the
 * model asked is {@link gone}, or the provider's own account is dry (@yaks/model
 * `dry`: its spend limit, billing quota, credit or plan window used up). A
 * refused request ran nothing, so it costs nothing and another provider may
 * take it. A caller's own ceiling (`limit`) is no refusal: every provider
 * would meet it.
 *
 * ```ts
 * import { ModelError, refused } from '@yaks/model'
 * import { equal } from '@yaks/testing'
 * equal(refused(new ModelError('model')), true)
 * equal(refused(new ModelError('project_spend_limit_exceeded')), true)
 * equal(refused(new ModelError('credit')), true)
 * equal(refused(new ModelError('limit')), false)
 * equal(refused(new ModelError('busy')), false)
 * ```
 */
export let refused = (error: unknown): error is ModelError =>
  gone(error) || error instanceof ModelError && dry(error)

/** One model of a chain: what asks it, and the name it is asked by. */
export type Link = { model: Model; name: string }

/**
 * A model that asks `chain(req)` in order: the first link answers the step,
 * and a link {@link refused} before producing output passes the step to the
 * next, even where the provider acknowledged the request first. `passed`
 * hears each such failure with the name it was asked by. Other failures are
 * thrown as they came.
 *
 * ```ts
 * import { type Model, ModelError, onward } from '@yaks/model'
 * import { equal } from '@yaks/testing'
 * let failing = (code: string): Model => () => Promise.reject(new ModelError(code))
 * let acked = (code: string): Model => async (req) => {
 *   await req.onAck?.({ p: { id: 'r' } })
 *   throw new ModelError(code)
 * }
 * let started = (code: string): Model => (req) => {
 *   req.onFirst?.()
 *   return Promise.reject(new ModelError(code))
 * }
 * let ok: Model = (req) =>
 *   Promise.resolve({ id: 'r', model: req.model, items: [] })
 * let heard: string[] = []
 * let chain = (links: Model[]) => () =>
 *   links.map((model, i) => ({ model, name: 'm' + i }))
 * let ask = (...links: Model[]) =>
 *   onward(chain(links), (name) => heard.push(name))(
 *     { model: 'm0', items: [], tools: [] },
 *   ).then((r) => r.model, (e) => e.code)
 * equal(await ask(failing('model'), ok), 'm1')
 * equal(await ask(acked('project_spend_limit_exceeded'), ok), 'm1')
 * equal(await ask(failing('credit'), failing('model'), ok), 'm2')
 * equal(await ask(failing('busy'), ok), 'busy')
 * equal(await ask(failing('limit'), ok), 'limit')
 * equal(await ask(started('credit'), ok), 'credit')
 * equal(await ask(failing('model')), 'model')
 * equal(heard, ['m0', 'm0', 'm0', 'm1'])
 * ```
 */
export let onward = (
  chain: (req: Request) => Link[] | Promise<Link[]>,
  passed?: (name: string, error: ModelError) => void,
): Model =>
async (req) => {
  let links = await chain(req)
  for (let [i, link] of links.entries()) {
    let begun = false
    try {
      return await link.model({
        ...req,
        model: link.name,
        onFirst: () => {
          begun = true
          req.onFirst?.()
        },
        onText: req.onText && ((text) => {
          begun = true
          req.onText!(text)
        }),
      })
    } catch (error) {
      req.signal?.throwIfAborted()
      if (!refused(error) || begun || i == links.length - 1) throw error
      passed?.(link.name, error)
    }
  }
  throw new ModelError('provider', 'No model answers this step')
}
