// OpenAI's Batch API as @yaks/model's `Batches`: many Responses requests
// uploaded as one JSON-lines file and answered within a day at half the
// price. OpenAI caches a prompt's prefix on its own; requests that name the
// same `prompt_cache_key` are routed to the same cache, so a prefix every
// request shares is read cheaply by all but the first few.
import type { Answered, Asked, Batches } from '@yaks/model/batch'
import { ModelError } from '@yaks/model'
import { OPENAI } from './credential.ts'

/** Where a key's batches are sent. */
export type Options = {
  key: () => string | Promise<string>
  /** the API's root, OpenAI's own by default */
  base?: string
  fetch?: typeof globalThis.fetch
}

/** A Responses request as one line of a batch's file. */
export let lineOf = (a: Asked): string =>
  JSON.stringify({
    custom_id: a.id,
    method: 'POST',
    url: '/v1/responses',
    body: {
      model: a.model,
      instructions: a.system,
      input: a.text,
      max_output_tokens: a.max,
      store: false,
      ...a.cache ? { prompt_cache_key: a.cache } : {},
    },
  })

type Output = { type: string; content?: { type: string; text?: string }[] }
type Body = {
  output?: Output[]
  usage?: {
    input_tokens?: number
    input_tokens_details?: { cached_tokens?: number }
    output_tokens?: number
    output_tokens_details?: { reasoning_tokens?: number }
  }
  error?: { message?: string } | null
  status?: string
}
/** One line of a batch's output or error file. */
export type Line = {
  custom_id: string
  response?: { status_code: number; body: Body } | null
  error?: { code?: string; message?: string } | null
}

/**
 * A line of a batch's output as an answer: the response's text and what it
 * used, or why there is none.
 *
 * ```ts
 * import { answerOf } from '@yaks/openai/batches'
 * import { assertEquals } from '@std/assert'
 *
 * assertEquals(answerOf({
 *   custom_id: 'a',
 *   response: {
 *     status_code: 200,
 *     body: {
 *       status: 'completed',
 *       output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }],
 *       usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 90 }, output_tokens: 5 },
 *     },
 *   },
 * }), { id: 'a', text: 'hi', usage: { input_tokens: 100, cached_tokens: 90, output_tokens: 5, reasoning_tokens: 0 } })
 * assertEquals(answerOf({ custom_id: 'b', error: { code: 'x', message: 'no' } }), { id: 'b', error: 'x: no' })
 * ```
 */
export let answerOf = (l: Line): Answered => {
  let body = l.response?.body
  if (l.error || !body || l.response!.status_code != 200 || body.error) {
    let e: { code?: string; message?: string } = l.error ?? body?.error ?? {}
    let said = [e.code ?? l.response?.status_code, e.message]
      .filter((s) => s != null && s !== '')
    return { id: l.custom_id, error: said.join(': ') || 'no answer' }
  }
  let text = (body.output ?? []).filter((o) => o.type == 'message')
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type == 'output_text')
    .map((c) => c.text ?? '').join('')
  let u = body.usage ?? {}
  return {
    id: l.custom_id,
    text,
    usage: {
      input_tokens: u.input_tokens ?? 0,
      cached_tokens: u.input_tokens_details?.cached_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      reasoning_tokens: u.output_tokens_details?.reasoning_tokens ?? 0,
    },
  }
}

// How a batch stands once it will change no more.
let ENDED = ['completed', 'failed', 'expired', 'cancelled']

/**
 * The batches of one key.
 *
 * ```ts
 * import { batches } from '@yaks/openai/batches'
 * import { assertEquals } from '@std/assert'
 *
 * let fetch = () => Promise.resolve(Response.json({ id: 'b1', status: 'finalizing' }))
 * let api = batches({ fetch, key: () => 'k' })
 * assertEquals(await api.ended('b1'), false)
 * ```
 */
export let batches = (options: Options): Batches => {
  let base = (options.base ?? OPENAI).replace(/\/$/, '')
  let call = async (path: string, init: RequestInit = {}) => {
    let response = await (options.fetch ?? fetch)(base + path, {
      ...init,
      headers: {
        authorization: `Bearer ${await options.key()}`,
        ...typeof init.body == 'string'
          ? { 'content-type': 'application/json' }
          : {},
      },
    })
    if (response.ok) return response
    let said = await response.json()
      .catch(() => ({})) as { error?: { message?: string } }
    throw new ModelError(
      response.status == 429 ? 'rate' : `http ${response.status}`,
      `OpenAI ${path.split('/')[1]}: ${
        said?.error?.message ?? response.statusText
      }`,
      response.status == 429 || response.status >= 500 ? {} : undefined,
    )
  }
  let read = async (id: string) =>
    await (await call(`/batches/${encodeURIComponent(id)}`)).json() as {
      status: string
      output_file_id?: string | null
      error_file_id?: string | null
      errors?: { data?: { code?: string; message?: string }[] } | null
    }
  let lines = async (file?: string | null): Promise<Line[]> =>
    file
      ? (await (await call(`/files/${encodeURIComponent(file)}/content`))
        .text())
        .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
      : []
  return {
    submit: async (asked) => {
      let form = new FormData()
      form.append('purpose', 'batch')
      form.append(
        'file',
        new Blob([asked.map(lineOf).join('\n') + '\n'], {
          type: 'application/jsonl',
        }),
        'batch.jsonl',
      )
      let file: { id: string } =
        await (await call('/files', { method: 'POST', body: form })).json()
      let batch: { id: string } = await (await call('/batches', {
        method: 'POST',
        body: JSON.stringify({
          input_file_id: file.id,
          endpoint: '/v1/responses',
          completion_window: '24h',
        }),
      })).json()
      return batch.id
    },
    ended: async (id) => ENDED.includes((await read(id)).status),
    // Every request's line, from the output file and the error file. A batch
    // refused whole (`failed`) has neither, and its errors say why.
    results: async (id) => {
      let b = await read(id)
      let all = [
        ...await lines(b.output_file_id),
        ...await lines(b.error_file_id),
      ]
      if (!all.length && b.errors?.data?.length) {
        throw new ModelError(
          'batch failed',
          `OpenAI batch ${id} ${b.status}: ${
            b.errors.data.map((e) => e.message ?? e.code).join('; ')
          }`,
        )
      }
      return all.map(answerOf)
    },
  }
}
