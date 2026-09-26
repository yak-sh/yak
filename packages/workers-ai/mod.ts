/**
 * @yaks/workers-ai implements @yaks/model's {@link Model} over Cloudflare
 * Workers AI, through the `AI` binding a Worker is given. The binding is the
 * authorization: there is no key, no endpoint and nothing to sign in to.
 *
 * ```ts
 * import { workersAi } from '@yaks/workers-ai'
 *
 * let ai = { run: () => Promise.resolve({ response: 'Hello' }) }
 * let reply = await workersAi(ai)({
 *   model: '@cf/zai-org/glm-5.3-flash',
 *   items: [{ kind: 'user', text: 'Hi' }],
 *   tools: [],
 * })
 * ```
 *
 * A request becomes chat `messages`, and the reply is read in either shape the
 * catalog answers: the binding's own (`response`, a flat `tool_calls`) or
 * OpenAI's (`choices[0].message`). Workers AI keeps nothing between requests,
 * so every request carries the whole conversation and the model has no anchor.
 *
 * A request asking typed questions goes to a structured model such as Jev
 * (`typesafe/jev`) as `{state, questions}`: the same messages are the state,
 * and the questions travel as they were asked. Its answers come back by
 * question, and a model that answered none refuses with a `ModelError` coded
 * `questions`.
 *
 * @module
 */

import {
  type Answer,
  type Item,
  type Model,
  ModelError,
  type Request,
  type Usage,
} from '@yaks/model'

/** The part of the `AI` binding this package calls. */
export type Binding = {
  run(model: string, input: unknown): Promise<unknown>
}

type Call = { id: string; name: string; arguments: string }

// One chat message, as the binding takes it.
type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: Call[]
  name?: string
  tool_call_id?: string
}

// A field of a value from outside, which may not be an object at all.
let at = (v: unknown, ...path: (string | number)[]): unknown =>
  path.reduce<unknown>(
    (o, k) => o && typeof o == 'object' ? Reflect.get(o, k) : undefined,
    v,
  )

let str = (v: unknown) => typeof v == 'string' ? v : ''

let count = (v: unknown) => typeof v == 'number' && v >= 0 ? v : undefined

// A request as chat messages. A call joins the assistant turn it follows,
// since a chat model reads its tool calls as part of what it said, and a
// result names the tool whose call it answers.
let messages = (req: Request): Message[] => {
  let out: Message[] = req.instructions
    ? [{ role: 'system', content: req.instructions }]
    : []
  let names = new Map<string, string>()
  for (let i of req.items) {
    let last = out.at(-1)
    if (i.kind == 'image') {
      throw new ModelError('image', 'Workers AI models are sent no images')
    } else if (i.kind == 'instruction') {
      out.push({ role: 'system', content: i.text })
    } else if (i.kind == 'user') out.push({ role: 'user', content: i.text })
    else if (i.kind == 'assistant') {
      out.push({ role: 'assistant', content: i.text })
    } else if (i.kind == 'call') {
      names.set(i.id, i.name)
      let call = { id: i.id, name: i.name, arguments: i.args }
      if (last?.role == 'assistant') {
        last.tool_calls = [...last.tool_calls ?? [], call]
      } else out.push({ role: 'assistant', content: '', tool_calls: [call] })
    } else {
      let name = names.get(i.id)
      out.push({
        role: 'tool',
        ...name ? { name } : {},
        tool_call_id: i.id,
        content: i.output,
      })
    }
  }
  return out
}

// The tool calls off an answer. The binding's own shape is a flat
// `{name, arguments}` with no id, OpenAI's is `{id, function: {name,
// arguments}}`, and arguments may arrive parsed. A call with no id is given
// one from the reply's, since a result finds its call by id.
let calls = (raw: unknown, reply: string): Item[] =>
  (Array.isArray(raw) ? raw : []).map((c, i) => {
    let fn = at(c, 'function') ?? c
    let args = at(fn, 'arguments')
    return {
      kind: 'call',
      id: str(at(c, 'id')) || `${reply}-${i + 1}`,
      name: str(at(fn, 'name')),
      args: typeof args == 'string' ? args : JSON.stringify(args ?? {}),
    }
  })

/**
 * The counts an answer from the binding reports, read off the whole answer: a
 * chat model's `prompt_tokens` and `completion_tokens`, or the `input_tokens`
 * and `output_tokens` a structured model says. One it leaves out is unknown,
 * not zero.
 *
 * ```ts
 * import { usageOf } from '@yaks/workers-ai'
 * import { assertEquals } from '@std/assert'
 *
 * assertEquals(
 *   usageOf({ usage: { input_tokens: 380, output_tokens: 45 } }),
 *   { input_tokens: 380, output_tokens: 45 },
 * )
 * ```
 */
export let usageOf = (answer: unknown): Usage => {
  let raw = at(answer, 'usage')
  let counts: [keyof Usage, number | undefined][] = [
    [
      'input_tokens',
      count(at(raw, 'prompt_tokens') ?? at(raw, 'input_tokens')),
    ],
    [
      'output_tokens',
      count(at(raw, 'completion_tokens') ?? at(raw, 'output_tokens')),
    ],
    ['total_tokens', count(at(raw, 'total_tokens'))],
    ['cached_tokens', count(at(raw, 'cached_tokens'))],
  ]
  return Object.fromEntries(counts.filter(([, n]) => n != undefined))
}

let num = (v: unknown) => typeof v == 'number' ? v : undefined

let TYPES = ['noul', 'choice', 'score'] as const

// One answer as the model gave it: the fields a question's type calls for, and
// nothing else.
let answer = (raw: unknown): Answer => {
  let type = TYPES.find((t) => t == at(raw, 'type'))
  let choice = at(raw, 'choice')
  let odds = at(raw, 'probabilities')
  let fields: Answer = {
    type,
    noul: num(at(raw, 'noul')),
    choice: typeof choice == 'string' ? choice : undefined,
    score: num(at(raw, 'score')),
    confidence: num(at(raw, 'confidence')),
    probabilities: odds && typeof odds == 'object' && !Array.isArray(odds)
      ? odds as Record<string, number>
      : undefined,
  }
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  )
}

// The answers off a structured model's reply, by question. A reply without
// them came from a model that answers no questions.
let answers = (out: unknown, model: string): Record<string, Answer> => {
  let raw = at(out, 'answers')
  if (!raw || typeof raw != 'object' || Array.isArray(raw)) {
    throw new ModelError('questions', `${model} answers no typed questions`)
  }
  return Object.fromEntries(
    Object.entries(raw).map(([name, a]) => [name, answer(a)]),
  )
}

let message = (e: unknown) => e instanceof Error ? e.message : String(e)

// How the binding says every model of this kind is busy: in its own words,
// or as the 429 it was answered.
let busy = (e: unknown) =>
  /\b429\b|too many requests|rate.?limit|capacity/i.test(message(e))

// What the binding is asked: a chat, or a structured model's questions about
// the same conversation.
let input = (req: Request) =>
  req.questions ? { state: messages(req), questions: req.questions } : {
    messages: messages(req),
    ...req.tools.length
      ? { tools: req.tools.map((f) => ({ type: 'function', function: f })) }
      : {},
    ...req.tokens ? { max_tokens: req.tokens } : {},
  }

/**
 * A model over the binding. A rate limit is a {@link ModelError} coded
 * `busy`, and a `ModelError` the binding throws itself (one that meters it,
 * say) is passed on as it is; anything else the binding throws is passed on as
 * it was thrown.
 */
export let workersAi = (ai: Binding): Model => async (req) => {
  req.signal?.throwIfAborted()
  let out = await ai.run(req.model, input(req)).catch((e) => {
    throw e instanceof ModelError || !busy(e)
      ? e
      : new ModelError('busy', message(e))
  })
  req.signal?.throwIfAborted()
  let id = str(at(out, 'id')) || crypto.randomUUID()
  let u = usageOf(out)
  let counted = Object.keys(u).length ? { usage: u } : {}
  if (req.questions) {
    return {
      id,
      model: req.model,
      items: [],
      answers: answers(out, req.model),
      ...counted,
    }
  }
  // Some models in the catalog answer the binding's own shape and some
  // answer OpenAI's; both are read, so a change of model is a change of id.
  let said = at(out, 'choices', 0, 'message')
  let text = String(at(out, 'response') ?? at(said, 'content') ?? '')
  if (text) req.onText?.({ index: 0, text })
  let words: Item[] = text ? [{ kind: 'assistant', text }] : []
  return {
    id,
    model: req.model,
    items: [
      ...words,
      ...calls(at(out, 'tool_calls') ?? at(said, 'tool_calls'), id),
    ],
    ...counted,
  }
}
