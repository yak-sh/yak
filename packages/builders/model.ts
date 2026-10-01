// The model is one registered builder tool. It opens an ordinary transcript;
// its completed entry is adapted to the same output value code tools return.

import {
  type Binding,
  type Bundle,
  type Comp,
  type Eid,
  type Graph,
  type Tool,
  type Tx,
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
    for (let group of row.collections ?? []) {
      if (!group.members.length) {
        for (let name of group.vars) {
          if (!(name in row.vars) && !out.has(name)) out.set(name, [])
        }
      }
      for (let child of group.members) walk(child)
    }
  }
  walk(binding)
  return out
}

// A collection's members, by the variable each binds its entity to: every
// member as the variables it binds and its parent does not. A value variable
// inside a bracket says its distinct values and loses which member held one;
// the member variable keeps each member's values together.
let members = (binding: Binding): Map<string, Record<string, unknown>[]> => {
  let out = new Map<string, Record<string, unknown>[]>()
  let walk = (row: Binding) => {
    for (let group of row.collections ?? []) {
      if (!group.members.length) {
        for (let name of group.entityVars) {
          if (!(name in row.vars) && !out.has(name)) out.set(name, [])
        }
      }
      for (let member of group.members) {
        let own = Object.fromEntries(
          Object.entries(member.vars).filter(([name]) => !(name in row.vars)),
        )
        for (let [name, value] of Object.entries(own)) {
          if (!member.entities.includes(value as Eid)) continue
          out.set(name, [...out.get(name) ?? [], own])
        }
        walk(member)
      }
    }
  }
  walk(binding)
  return out
}

/** Fill $var from the frozen binding tree; $$ is a literal dollar sign. A
 * variable naming a bracket's members says them as a JSON list, each member
 * the variables it binds: `[$p .note, doc.body=$body]` makes `$p`
 * `[{"p": "n1", "body": "…"}, …]`. */
export let render = (template: string, binding: Binding): string => {
  let vars = values(binding)
  let rows = members(binding)
  return template.replace(/\$\$|\$([a-zA-Z_][\w]*)/g, (_part, name) => {
    if (!name) return '$'
    let listed = rows.get(name)
    if (listed) return JSON.stringify(listed, null, 1)
    let held = vars.get(name)
    if (!held) throw new Error(`builder template has no $${name} binding`)
    let value = held.length == 1 ? held[0] : held
    return typeof value == 'string' ? value : JSON.stringify(value)
  })
}

let contract =
  'Answer with JSON: {"outputs": [...]}, one output for each the ' +
  'request asks for, each {"slot":"stable-name",' +
  '"inputs":["input-id"],"components":{"doc":{"body":"text"}}}, ' +
  'or {"outputs": []} where it asks for none. ' +
  'Cite only selected input ids.'

let instructions = (base: unknown): string => {
  let text = str(base)
  return text.endsWith(contract)
    ? text
    : [text, contract].filter(Boolean).join('\n\n')
}
let request = (template: string, binding: Binding): string =>
  `${render(template, binding)}\n\nInputs: ${
    ids(binding).join(', ') || '(none)'
  }\n`

/** Run the adapter through @yaks/tools; no model execution lives here. */
export let modelTool = (desk: Desk = {}): Tool => ({
  name: MODEL,
  description: 'Build one query binding through an ordinary model session',
  revision: '2',
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
        using: { ...using, instructions: instructions(using.instructions) },
      },
      ...(desk.persona ? [link(session, 'references', desk.persona)] : []),
    ]
  },
})

/** Convert one transcript answer into the shared builder output value. */
export let adapted = async (
  tx: Pick<Tx, 'get' | 'read'>,
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
    // Prose a model writes beside the tool calls it asks for is the model at
    // work; its answer is the output of an ask that asked for nothing more.
    let ask = str(comp(said, 'output')?.source)
    if (ask && (await tx.read(`.call.source=${ask}&.limit=1`)).length) return
    // Its outputs alone: what a model session spent is its entries', never
    // what its answer says (./cost.ts). A reply that is not the contract (JSON
    // cut short, prose) is still answered, as the text it said, so the build
    // refuses it and leaves its key clear to be asked again.
    let text = textOf(said)
    try {
      let told = JSON.parse(text)
      value = told && typeof told == 'object' && !Array.isArray(told)
        ? { outputs: told.outputs }
        : { said: text }
    } catch {
      value = { said: text }
    }
  } else return
  return {
    entity: { eid: crypto.randomUUID() },
    output: { source: call, value },
  }
}
