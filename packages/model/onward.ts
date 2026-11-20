// A step asked of a chain of models: where the provider says the model asked
// is retired or is none it knows, the step goes on to the next model the chain
// names, so a model taken off a catalogue never ends a turn.
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

/** One model of a chain: what asks it, and the name it is asked by. */
export type Link = { model: Model; name: string }

/**
 * A model that asks `chain(req)` in order: the first link answers the step,
 * and a link that fails {@link gone} before acknowledging the request or
 * producing output passes the step to the next. `passed` hears each such
 * failure with the name it was asked by. Other failures are thrown as they
 * came.
 *
 * ```ts
 * import { type Model, ModelError, onward } from '@yaks/model'
 * import { equal } from '@yaks/testing'
 * let retired: Model = () => Promise.reject(new ModelError('model'))
 * let busy: Model = () => Promise.reject(new ModelError('busy'))
 * let ok: Model = (req) =>
 *   Promise.resolve({ id: 'r', model: req.model, items: [] })
 * let heard: string[] = []
 * let ask = (links: { model: Model; name: string }[]) =>
 *   onward(() => links, (name) => heard.push(name))(
 *     { model: 'a', items: [], tools: [] },
 *   ).then((r) => r.model, (e) => e.code)
 * equal(await ask([{ model: retired, name: 'a' }, { model: ok, name: 'b' }]), 'b')
 * equal(await ask([{ model: busy, name: 'a' }, { model: ok, name: 'b' }]), 'busy')
 * equal(await ask([{ model: retired, name: 'a' }]), 'model')
 * equal(heard, ['a'])
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
        onAck: async (mark) => {
          begun = true
          await req.onAck?.(mark)
        },
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
      if (!gone(error) || begun || i == links.length - 1) throw error
      passed?.(link.name, error)
    }
  }
  throw new ModelError('provider', 'No model answers this step')
}
