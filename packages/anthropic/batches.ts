// Anthropic's Message Batches API, spoken over the same wire as ./mod.ts: many
// Messages requests sent as one, answered within a day at half the price,
// each request's cache read as any request's is (so a prefix every request
// shares is written once and read by the rest). A batch is sent, read until
// it has ended, and its results read whole.
import { send, type Wire } from './wire.ts'

/** One request of a batch: a Messages request's body, named by the caller so
 * its result can be found again (results come back in any order). */
export type Entry = { custom_id: string; params: Record<string, unknown> }

/** A batch as the API says it stands. */
export type Batch = {
  id: string
  processing_status: 'in_progress' | 'canceling' | 'ended'
  request_counts?: Record<string, number>
  ended_at?: string | null
}

/** What a content block of a result carries that we read. */
export type Block = { type: string; text?: string }

/** One request's result: its message, or why there is none. */
export type Result = {
  custom_id: string
  result:
    | {
      type: 'succeeded'
      message: {
        content: Block[]
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

/** A key's batches: send one, read how it stands, read its results. */
export type Batches = {
  submit: (requests: Entry[]) => Promise<Batch>
  read: (id: string) => Promise<Batch>
  results: (id: string) => Promise<Result[]>
}

/** The batches of one key: send one, read how it stands, read its results.
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
 * assertEquals((await api.read('b1')).processing_status, 'ended')
 * assertEquals(asked, ['GET https://api.anthropic.com/v1/messages/batches/b1'])
 * ```
 */
export let batches = (
  wire: Wire & { key: () => string | Promise<string> },
): Batches => {
  let at = async (path: string, init?: RequestInit) =>
    await send(wire, await wire.key(), `/v1/messages/batches${path}`, init)
  return {
    submit: async (requests: Entry[]): Promise<Batch> =>
      await (await at('', {
        method: 'POST',
        body: JSON.stringify({ requests }),
      })).json(),
    read: async (id: string): Promise<Batch> =>
      await (await at(`/${encodeURIComponent(id)}`)).json(),
    // JSON lines, one result each.
    results: async (id: string): Promise<Result[]> =>
      (await (await at(`/${encodeURIComponent(id)}/results`)).text())
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l)),
  }
}
