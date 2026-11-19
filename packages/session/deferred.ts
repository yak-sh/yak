// Tools a transcript is offered by name until it loads them. A runner that
// holds more tools than a turn needs marks the rest `deferred`: their schemas
// stay out of the request, and one tool, `tool_load`, lists them by name and
// title. A transcript that calls it is sent their schemas from then on, as
// long as the call is among the entries a step reads. A deferred tool runs
// whenever it is called, loaded or not, and once called it is sent too, so a
// request never replays a call to a tool it does not carry.
import type { Bundle } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import { CallError } from '@yaks/tools/errors'
import { toolEid } from '@yaks/tools/result'
import { validateToolInput } from '@yaks/vocab/tools'
import { CALL } from './native.ts'
import type { Tool } from './react.ts'

/** The name of the tool that loads deferred ones. */
export let LOAD = 'tool_load'

// A deferred tool as the catalog lists it: its title, or its description's
// first sentence.
let line = (t: Tool) =>
  `- ${t.name}: ${t.title ?? t.description.split(/(?<=\.)\s/)[0].slice(0, 120)}`

/**
 * The tool among `known` a loaded name means: the name itself, or the name
 * without the `<server>__` prefixes a caller wrote before it.
 *
 * ```ts
 * let known = new Set(['task_list'])
 * named('tasks__task_list', known) // 'task_list'
 * named('mcp__tasks__task_list', known) // 'task_list'
 * named('task_lists', known) // undefined
 * ```
 */
export let named = (name: string, known: Set<string>): string | undefined => {
  for (let n = name;; n = n.slice(n.indexOf('__') + 2)) {
    if (known.has(n)) return n
    if (!n.includes('__')) return undefined
  }
}

// What `tool_load` takes: the names of the tools to load.
let parameters = {
  type: 'object',
  properties: {
    names: {
      type: 'array',
      items: { type: 'string' },
      description: 'The tools to load.',
    },
  },
  required: ['names'],
}

// The names a `tool_load` call gives, read as its run is handed them
// (@yaks/vocab/tools `validateToolInput`), so a list a model wrote as a
// string of JSON loads what it names; arguments its run refuses load nothing.
let namesOf = (call: Bundle): string[] => {
  try {
    return validateToolInput({ inputSchema: parameters }, argsOf(call))
      .names as string[]
  } catch {
    return []
  }
}

/**
 * The tools a runner offers, with `tool_load` beside them when any is
 * deferred: its description lists each deferred one, and its call names
 * those to send from then on.
 *
 * ```ts
 * let tool = (name: string, deferred = false) =>
 *   ({ name, description: `${name}.`, parameters: {}, deferred, run: () => name })
 * loading([tool('search'), tool('buy', true)]).map((t) => t.name)
 * // ['search', 'buy', 'tool_load']
 * ```
 */
export let loading = (tools: Tool[]): Tool[] => {
  let later = tools.filter((t) => t.deferred)
  if (!later.length || tools.some((t) => t.name == LOAD)) return tools
  let known = new Set(later.map((t) => t.name))
  let load: Tool = {
    name: LOAD,
    title: 'Load tools',
    description:
      'Load tools you are not sent yet, by name, so you can call them: their schemas are sent with your next turn. Load every one a task needs in one call. These are the tools you can load:\n' +
      later.map(line).join('\n'),
    parameters,
    readOnly: true,
    run: (args) => {
      let names = (args.names ?? []) as string[]
      let missing = names.filter((n) => !named(n, known))
      if (missing.length) {
        throw new CallError(
          'tool',
          `There is no tool to load called ${
            missing.join(', ')
          }. Load one by a name ${LOAD} lists.`,
        )
      }
      return `Loaded ${
        names.map((n) => named(n, known)).join(', ')
      }. Call them directly.`
    },
  }
  return [...tools, load]
}

/**
 * The tools a request sends: every one not deferred, and the deferred ones a
 * `tool_load` call among `entries` named or a call among them called.
 *
 * ```ts
 * import { toolEid } from '@yaks/tools/result'
 *
 * let tool = (name: string, deferred = false) =>
 *   ({ name, description: name, parameters: {}, deferred, run: () => name })
 * let load = {
 *   entity: { eid: 'c' },
 *   call: { to: toolEid('tool_load'), args: { names: ['shop__buy'] } },
 * }
 * let sold = { entity: { eid: 'd' }, call: { to: toolEid('sell') } }
 * let tools = [tool('search'), tool('buy', true), tool('sell', true)]
 * schemas(tools, [load]).map((t) => t.name) // ['search', 'buy']
 * schemas(tools, [sold]).map((t) => t.name) // ['search', 'sell']
 * let quoted = { ...load, call: { ...load.call, args: { names: '["buy"]' } } }
 * schemas(tools, [quoted]).map((t) => t.name) // ['search', 'buy']
 * let wrong = { ...load, call: { ...load.call, args: { names: 7 } } }
 * schemas(tools, [wrong]).map((t) => t.name) // ['search']
 * ```
 */
export let schemas = (tools: Tool[], entries: Bundle[]): Tool[] => {
  if (!tools.some((t) => t.deferred)) return tools
  let known = new Set(tools.filter((t) => t.deferred).map((t) => t.name))
  let load = toolEid(LOAD)
  let loaded = new Set(
    entries.flatMap((b) => {
      let to = (b[CALL] as { to?: unknown } | undefined)?.to
      if (to != load) return to ? [to] : []
      return namesOf(b).map((n) => toolEid(named(n, known) ?? n))
    }),
  )
  return tools.filter((t) => !t.deferred || loaded.has(toolEid(t.name)))
}
