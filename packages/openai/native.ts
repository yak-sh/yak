// OpenAI's own door for a host that passes a caller's chat input on as it is
// (@yaks/model `Native`): one Chat Completions call, quoted from the model's
// list price and published window before it is made, held to what the host's
// spending affords, and settled at what its usage cost.
//
// It answers only the names its options alias, each to the OpenAI model that
// answers it, so a host can give names its callers already use to OpenAI. The
// input is a chat request in the dialect OpenAI-compatible servers share:
// `prompt` beside `messages`, `max_tokens`, flat tools, a bare JSON schema,
// sampling and template settings, each made into what OpenAI's reasoning
// models take. The answer is OpenAI's completion with the dialect's own
// fields beside it: the text as `response`, and its calls flat.

import {
  affordable,
  charged,
  type Lent,
  ModelError,
  type Native,
  promptBound,
  type Spending,
  type Usage,
} from '@yaks/model'
import { OPENAI } from './credential.ts'
import { described } from './info.ts'

/** What the door is given: the names it answers, each the OpenAI model that
 * answers it, and where and with what key it calls. */
export type Door = {
  aliases?: Record<string, string>
  base?: string
  key?: string
  headers?: Record<string, string>
}

type Body = Record<string, unknown>

// What a reasoning model takes of a chat request; the rest (temperature,
// penalties, template settings, streaming) it refuses or the door can't pass.
let KEPT = [
  'messages',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'response_format',
  'reasoning_effort',
  'stop',
  'seed',
]

// A tool as OpenAI takes it, from either shape the dialect allows.
let tool = (t: unknown) =>
  t && typeof t == 'object' && !('function' in t)
    ? { type: 'function', function: t }
    : t

// A JSON schema as OpenAI takes it: named, where the dialect gives it bare.
let format = (f: unknown) => {
  let schema = f && typeof f == 'object' ? Reflect.get(f, 'json_schema') : null
  return schema && typeof schema == 'object' && !('schema' in schema)
    ? { type: 'json_schema', json_schema: { name: 'answer', schema } }
    : f
}

/** A chat request in the shared dialect, as OpenAI's Chat Completions takes
 * it, asking `model` for at most `tokens`. Without an effort it reasons none,
 * so the tokens a caller sized for its answer go to the answer. Calls of one
 * `conversation` share OpenAI's prompt cache. */
export let request = (
  sent: Body,
  model: string,
  tokens: number,
  conversation?: string,
): Body => {
  let thinks = Reflect.get(Object(sent.chat_template_kwargs), 'enable_thinking')
  let body: Body = Object.fromEntries(
    KEPT.filter((k) => sent[k] != null).map((k) => [k, sent[k]]),
  )
  return {
    model,
    ...body,
    messages: Array.isArray(sent.messages)
      ? sent.messages
      : [{ role: 'user', content: String(sent.prompt ?? '') }],
    ...Array.isArray(sent.tools) ? { tools: sent.tools.map(tool) } : {},
    ...sent.response_format
      ? { response_format: format(sent.response_format) }
      : {},
    reasoning_effort: sent.reasoning_effort ?? (thinks ? 'low' : 'none'),
    max_completion_tokens: tokens,
    ...conversation ? { prompt_cache_key: conversation } : {},
  }
}

/** OpenAI's completion with the dialect's fields beside it. */
export let answer = (out: Body): Body => {
  let message = Reflect.get(
    Object(Reflect.get(Object(out.choices), 0)),
    'message',
  )
  let calls = Reflect.get(Object(message), 'tool_calls')
  return {
    ...out,
    response: String(Reflect.get(Object(message), 'content') ?? ''),
    ...Array.isArray(calls)
      ? {
        tool_calls: calls.map((c) => ({
          name: c.function?.name,
          arguments: JSON.parse(c.function?.arguments || '{}'),
        })),
      }
      : {},
  }
}

let count = (v: unknown) => typeof v == 'number' ? v : undefined

/** A completion's usage as @yaks/model counts it. */
export let usage = (out: Body): Usage => {
  let u = Object(out.usage)
  let n: Usage = {
    input_tokens: count(u.prompt_tokens),
    output_tokens: count(u.completion_tokens),
    total_tokens: count(u.total_tokens),
    cached_tokens: count(u.prompt_tokens_details?.cached_tokens),
    cache_write_tokens: count(u.prompt_tokens_details?.cache_write_tokens),
    reasoning_tokens: count(u.completion_tokens_details?.reasoning_tokens),
  }
  return Object.fromEntries(
    Object.entries(n).filter(([, v]) => v != null),
  ) as Usage
}

// How OpenAI's refusal is heard: the caller's input (400), a model the
// project may not use (404, 403 on the allow-list), the account's own credit
// spent, or OpenAI busy; anything else is the host's.
let refused = async (res: Response, model: string) => {
  let error = Object((await res.json().catch(() => ({}))).error)
  let said = String(error.message ?? `OpenAI says ${res.status}`)
  if (res.status == 400) {
    return new ModelError('bad_request', `${model} refused this input: ${said}`)
  }
  if (res.status == 404 || error.code == 'model_not_found') {
    return new ModelError('model', said)
  }
  if (error.code == 'insufficient_quota') return new ModelError('limit', said)
  if (res.status == 429 || res.status >= 500) {
    return new ModelError('busy', said, {})
  }
  return new Error(`OpenAI says ${res.status}: ${said}`)
}

/**
 * The door. A name it doesn't alias is not its to answer (`serves`). A model
 * OpenAI lists no price for is refused before anything is spent, and a
 * request over what `spending` holds is refused with its `ModelError` coded
 * `limit`. Nothing OpenAI refused is paid for. A model that answered is said
 * to the host by OpenAI's name for it.
 */
export let native = (lent: Lent, door: Door, spending: Spending): Native => {
  let aliases = door.aliases ?? {}
  return {
    serves: (model) => Object.hasOwn(aliases, model),
    run: async (asked, input, opts) => {
      let model = aliases[asked]
      if (!model) throw new ModelError('model', `OpenAI answers no ${asked}`)
      let info = await described({ name: model }, lent.fetch)
      if (!info.price || !info.context) {
        throw new ModelError('model', `No published price for ${model}`)
      }
      let sent = Object(input) as Body
      let { tools, ...prompt } = sent
      let hold = await spending.hold((remaining) =>
        affordable(
          info.price!,
          promptBound(prompt, info.context!, tools),
          remaining,
          Number(sent.max_completion_tokens ?? sent.max_tokens ?? 4096),
        )
      )
      let res = await lent.fetch(
        `${(door.base ?? OPENAI).replace(/\/+$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: {
            ...door.headers,
            'content-type': 'application/json',
            ...door.key ? { authorization: `Bearer ${door.key}` } : {},
          },
          body: JSON.stringify(
            request(
              sent,
              model,
              hold.value.tokens,
              opts?.extraHeaders?.['x-session-affinity'],
            ),
          ),
        },
      ).catch(async (e) => {
        await hold.settle(0, false)
        throw new ModelError('busy', String(e?.message ?? e), {})
      })
      if (!res.ok) {
        await hold.settle(0, false)
        let e = await refused(res, model)
        if (e instanceof ModelError && e.code == 'limit') {
          spending.report?.(e, model)
        }
        throw e
      }
      let out = await res.json() as Body
      await spending.answered?.(model, info)
      let cost = charged({ usage: usage(out) }, info.price, hold.value.dollars)
      await hold.settle(cost.dollars, false)
      return answer(out)
    },
  }
}
