// Anthropic's Message Batches API as @yaks/model's `Batches`, spoken over the
// same wire as ./mod.ts: many Messages requests sent as one, answered within a
// day at half the price. Each request's system text is marked for the cache,
// so a prefix every request shares is written once and read by the rest.
import type { Answered, Asked, Batches } from '@yaks/model/batch'
import type { Usage } from '@yaks/model'
import { send, type Wire } from './wire.ts'

/** One request of a batch as the API takes it: a Messages request's body,
 * named so its result can be found again. */
export type Entry = { custom_id: string; params: Record<string, unknown> }

/** One request's result as the API gives it: its message, or why there is
 * none. */
export type Result = {
  custom_id: string
  result:
    | {
      type: 'succeeded'
      message: {
        content: { type: string; text?: string }[]
        usage: {
          input_tokens: number
          output_tokens: number
          cache_read_input_tokens?: number | null
          cache_creation_input_tokens?: number | null
        }
      }
    }
    | { type: 'errored' | 'canceled' | 'expired'; error?: unknown }
}

/** A request as a Messages request's body, its system text cached. */
export let entryOf = (a: Asked): Entry => ({
  custom_id: a.id,
  params: {
    model: a.model,
    max_tokens: a.max,
    system: [{
      type: 'text',
      text: a.system,
      cache_control: { type: 'ephemeral' },
    }],
    messages: [{ role: 'user', content: a.text }],
  },
})

/**
 * A result as an answer: its text and usage, counted as @yaks/model counts
 * them (input includes what the cache read and wrote).
 *
 * ```ts
 * import { answerOf } from '@yaks/anthropic/batches'
 * import { assertEquals } from '@std/assert'
 *
 * assertEquals(answerOf({
 *   custom_id: 'a',
 *   result: {
 *     type: 'succeeded',
 *     message: {
 *       content: [{ type: 'text', text: 'hi' }],
 *       usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 90 },
 *     },
 *   },
 * }), {
 *   id: 'a',
 *   text: 'hi',
 *   usage: { input_tokens: 100, cached_tokens: 90, cache_write_tokens: 0, output_tokens: 5 },
 * })
 * assertEquals(answerOf({ custom_id: 'b', result: { type: 'expired' } }), {
 *   id: 'b',
 *   error: 'expired',
 * })
 * ```
 */
export let answerOf = (r: Result): Answered => {
  if (r.result.type != 'succeeded') {
    let why = r.result.error ? ` ${JSON.stringify(r.result.error)}` : ''
    return { id: r.custom_id, error: r.result.type + why }
  }
  let u = r.result.message.usage
  let read = u.cache_read_input_tokens ?? 0
  let wrote = u.cache_creation_input_tokens ?? 0
  let usage: Usage = {
    input_tokens: u.input_tokens + read + wrote,
    cached_tokens: read,
    cache_write_tokens: wrote,
    output_tokens: u.output_tokens,
  }
  let text = r.result.message.content.filter((b) => b.type == 'text')
    .map((b) => b.text ?? '').join('')
  return { id: r.custom_id, text, usage }
}

/** The batches of one key.
 *
 * ```ts
 * import { batches } from '@yaks/anthropic/batches'
 * import { assertEquals } from '@std/assert'
 *
 * let asked: string[] = []
 * let fetch = (url: string | URL | Request, init?: RequestInit) => {
 *   asked.push(`${init?.method ?? 'GET'} ${url}`)
 *   return Promise.resolve(Response.json({ id: 'b1', processing_status: 'ended' }))
 * }
 * let api = batches({ fetch: fetch as typeof globalThis.fetch, key: () => 'k' })
 * assertEquals(await api.ended('b1'), true)
 * assertEquals(asked, ['GET https://api.anthropic.com/v1/messages/batches/b1'])
 * ```
 */
export let batches = (
  wire: Wire & { key: () => string | Promise<string> },
): Batches => {
  let at = async (path: string, init?: RequestInit) =>
    await send(wire, await wire.key(), `/v1/messages/batches${path}`, init)
  let id = (s: string) => `/${encodeURIComponent(s)}`
  let json = async <T>(r: Response) => await r.json() as T
  return {
    submit: async (asked) =>
      (await json<{ id: string }>(
        await at('', {
          method: 'POST',
          body: JSON.stringify({ requests: asked.map(entryOf) }),
        }),
      )).id,
    ended: async (b) =>
      (await json<{ processing_status: string }>(await at(id(b))))
        .processing_status == 'ended',
    // JSON lines, one result each.
    results: async (b) =>
      (await (await at(`${id(b)}/results`)).text())
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => answerOf(JSON.parse(l))),
  }
}
