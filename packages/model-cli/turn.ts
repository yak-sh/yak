import { type Item, ModelError, type Request } from '@yaks/model'

type Fields = Record<string, unknown>

export let object = (value: unknown): Fields | undefined =>
  value && typeof value == 'object' && !Array.isArray(value)
    ? value as Fields
    : undefined

export let json = (text: string): Fields | undefined => {
  try {
    return object(JSON.parse(text))
  } catch {
    return undefined
  }
}

// A CLI returns a turn as structured output. JSON text for the arguments
// allows every harness tool to keep its own schema without a schema union.
export let schema: string = JSON.stringify({
  type: 'object',
  properties: {
    text: { type: 'string' },
    calls: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, args: { type: 'string' } },
        required: ['name', 'args'],
        additionalProperties: false,
      },
    },
  },
  required: ['text', 'calls'],
  additionalProperties: false,
})

export let instructions = [
  'Continue the authoritative transcript in the request. Its items are ordered oldest first. Assistant messages, calls and results there are history.',
  'Follow the system instructions from the request. Return a single turn with text and calls. Use an empty string for no text and an empty calls array for no calls.',
  'Request tools only through the calls array, naming a tool from the request and encoding its argument object as JSON text in args. The graph harness executes these calls and sends their results later.',
].join('\n')

export let prompt = (req: Request): string =>
  JSON.stringify({
    instructions: req.instructions,
    items: [...req.items, ...req.turnContext ?? []],
    tools: req.tools,
  })

export let items = (
  output: unknown,
  id: string,
  name: string,
): Item[] => {
  let turn = object(output)
  let invalid = () =>
    new ModelError('cli_protocol', `${name} returned an invalid model turn`)
  if (typeof turn?.text != 'string' || !Array.isArray(turn.calls)) {
    throw invalid()
  }
  let calls = turn.calls.map((value, i): Item => {
    let call = object(value)
    if (
      typeof call?.name != 'string' || !call.name ||
      typeof call.args != 'string' || !json(call.args)
    ) throw invalid()
    return { kind: 'call', id: `${id}:${i}`, name: call.name, args: call.args }
  })
  if (!turn.text && !calls.length) throw invalid()
  return [
    ...turn.text ? [{ kind: 'assistant' as const, text: turn.text, id }] : [],
    ...calls,
  ]
}
