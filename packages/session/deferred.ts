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
import { CALL } from './native.ts'
import type { Tool } from './react.ts'

/** The name of the tool that loads deferred ones. */
export let LOAD = 'tool_load'

// A deferred tool as the catalog lists it: its title, or its description's
// first sentence.
let line = (t: Tool) =>
  `- ${t.name}: ${t.title ?? t.description.split(/(?<=\.)\s/)[0].slice(0, 120)}`

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
  let named = new Set(later.map((t) => t.name))
  let load: Tool = {
    name: LOAD,
    title: 'Load tools',
    description:
      'Load tools you are not sent yet, by name, so you can call them: their schemas are sent with your next turn. Load every one a task needs in one call. These are the tools you can load:\n' +
      later.map(line).join('\n'),
    parameters: {
      type: 'object',
      properties: {
        names: {
          type: 'array',
          items: { type: 'string' },
          description: 'The tools to load.',
        },
      },
      required: ['names'],
    },
    readOnly: true,
    run: (args) => {
      let names = (args.names ?? []) as string[]
      let missing = names.filter((n) => !named.has(n))
      if (missing.length) {
        throw new CallError(
          'tool',
          `There is no tool to load called ${missing.join(', ')}.`,
        )
      }
      return `Loaded ${names.join(', ')}. Call them directly.`
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
 *   call: { to: toolEid('tool_load'), args: { names: ['buy'] } },
 * }
 * let sold = { entity: { eid: 'd' }, call: { to: toolEid('sell') } }
 * let tools = [tool('search'), tool('buy', true), tool('sell', true)]
 * schemas(tools, [load]).map((t) => t.name) // ['search', 'buy']
 * schemas(tools, [sold]).map((t) => t.name) // ['search', 'sell']
 * ```
 */
export let schemas = (tools: Tool[], entries: Bundle[]): Tool[] => {
  if (!tools.some((t) => t.deferred)) return tools
  let load = toolEid(LOAD)
  let loaded = new Set(
    entries.flatMap((b) => {
      let to = (b[CALL] as { to?: unknown } | undefined)?.to
      if (to != load) return to ? [to] : []
      return ((argsOf(b).names ?? []) as string[]).map(toolEid)
    }),
  )
  return tools.filter((t) => !t.deferred || loaded.has(toolEid(t.name)))
}
