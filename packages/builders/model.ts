// The model is one registered builder tool. It opens an ordinary transcript;
// its completed entry is adapted to the same output value code tools return.

import {
  type Binding,
  type Bundle,
  type Comp,
  type Eid,
  type Graph,
  type Tool,
} from '@yaks/graph'
import { link } from '@yaks/edge'
import { kindOf, textOf } from '@yaks/session'
import { toolEid } from '@yaks/tools'
import { ids } from './build.ts'

export let MODEL = 'builder_model'
export let modelToolEid = (): Eid => toolEid(MODEL)

export type Desk = {
  persona?: string
  actor?: string
}

let comp = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined
let str = (v: unknown): string => v == null ? '' : String(v)

let values = (binding: Binding): Map<string, unknown[]> => {
  let out = new Map<string, unknown[]>()
  let walk = (row: Binding) => {
    for (let [name, value] of Object.entries(row.vars)) {
      let list = out.get(name) ?? []
      if (!list.some((one) => JSON.stringify(one) == JSON.stringify(value))) {
        list.push(value)
      }
      out.set(name, list)
    }
    for (let members of row.collections ?? []) {
      for (let child of members) walk(child)
    }
  }
  walk(binding)
  return out
}

/** Fill $var from the frozen binding tree; $$ is a literal dollar sign. */
export let render = (template: string, binding: Binding): string => {
  let vars = values(binding)
  return template.replace(/\$\$|\$([a-zA-Z_][\w]*)/g, (_part, name) => {
    if (!name) return '$'
    let held = vars.get(name)
    if (!held) throw new Error(`builder template has no $${name} binding`)
    let value = held.length == 1 ? held[0] : held
    return typeof value == 'string' ? value : JSON.stringify(value)
  })
}

let request = (template: string, binding: Binding): string =>
  `${render(template, binding)}\n\nInputs: ${
    ids(binding).join(', ') || '(none)'
  }\n` +
  'Return JSON with {"outputs":[{"slot":"stable-name",' +
  '"inputs":["input-id"],"components":{"doc":{"body":"text"}}}]}. ' +
  'Cite only selected input ids.'

/** Run the adapter through @yaks/tools; no model execution lives here. */
export let modelTool = (desk: Desk = {}): Tool => ({
  name: MODEL,
  description: 'Build one query binding through an ordinary model session',
  revision: '1',
  inputSchema: {
    type: 'object',
    properties: {
      binding: { type: 'object' },
      key: { type: 'string' },
      template: { type: 'string' },
      using: { type: 'object' },
    },
    required: ['binding', 'key'],
  },
  run: (call: Bundle, _graph: Graph): Bundle[] => {
    let args = comp(call, 'call')?.args as {
      binding: Binding
      template?: string
      using?: Comp
    }
    let using = args.using ?? {}
    if (!using.model) throw new Error('model builder has no using.model')
    let session: Eid = crypto.randomUUID()
    let prompt = request(args.template ?? '', args.binding)
    return [
      {
        entity: { eid: session },
        session: {
          source: call.entity.eid,
          ...(desk.actor ? { actor: desk.actor } : {}),
        },
      },
      {
        entity: { eid: crypto.randomUUID() },
        entry: { session, seq: 1 },
        content: { body: prompt },
        using,
      },
      ...(desk.persona ? [link(session, 'references', desk.persona)] : []),
    ]
  },
})

/** Convert one transcript answer into the shared builder output value. */
export let adapted = async (
  tx: { get: (ids: Eid[]) => Bundle[] | Promise<Bundle[]> },
  said: Bundle,
): Promise<Bundle | undefined> => {
  let session = str(comp(said, 'entry')?.session)
  if (!session || !said.output) return
  let [transcript] = await tx.get([session])
  let call = str(comp(transcript, 'session')?.source)
  if (!call) return
  let value: unknown
  if (said.attachment) {
    let artifact = str(comp(said, 'attachment')?.artifact)
    let [asked] = await tx.get([call])
    let binding = (comp(asked, 'call')?.args as { binding?: Binding })?.binding
    if (!artifact || !binding) {
      throw new Error('model builder attachment has no binding')
    }
    value = {
      outputs: [{
        slot: 'main',
        inputs: ids(binding),
        components: {},
        artifact,
      }],
    }
  } else if (kindOf(said) == 'output') {
    // Its outputs alone: what a model session spent is its entries', never
    // what its answer says (./cost.ts).
    try {
      let told = JSON.parse(textOf(said))
      value = told && typeof told == 'object' && !Array.isArray(told)
        ? { outputs: told.outputs }
        : told
    } catch {
      value = textOf(said)
    }
  } else return
  return {
    entity: { eid: crypto.randomUUID() },
    output: { source: call, value },
  }
}
