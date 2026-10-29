// Runtime provider snapshots: one catalog and lookup for every tool door.
import type { NamedTool, Tool } from '@yaks/graph'
import { namedTool } from '@yaks/graph/call'
import { toolEid } from './result.ts'
import { answerSchema, inputSchemaOf } from './schema.ts'

/** One runtime source's complete catalog, with names unchanged. */
export type Provider = { name: string; tools: readonly Tool[] }

/** A discovery result carries schemas and its source, never executable code. */
export type Description =
  & Omit<NamedTool, 'run' | 'input' | 'inputSchema' | 'outputSchema'>
  & {
    provider: string
    inputSchema: ReturnType<typeof inputSchemaOf>
    outputSchema: NonNullable<Tool['outputSchema']>
  }

export type Registry = {
  list: () => NamedTool[]
  providers: () => { name: string; tools: NamedTool[] }[]
  get: (nameOrEid: string) => NamedTool | undefined
  describe: (nameOrEid: string) => Description | undefined
  search: (words: string) => Description[]
  /** Replace a complete provider snapshot, or remove it with null. A collision
   * leaves the previous catalog intact and sends no notification. */
  replace: (name: string, tools: readonly Tool[] | null) => void
  subscribe: (changed: () => void) => () => void
}

let snapshot = ({ name, tools }: Provider) => ({
  name,
  tools: tools.map(namedTool),
})

let indexed = (sources: ReturnType<typeof snapshot>[]) => {
  let names = new Map<string, { provider: string; tool: NamedTool }>()
  let eids = new Map<string, NamedTool>()
  for (let source of sources) {
    for (let tool of source.tools) {
      let prior = names.get(tool.name)
      if (prior) {
        throw new Error(
          `tool ${tool.name} is supplied by both ${prior.provider} and ${source.name}`,
        )
      }
      let eid = toolEid(tool.name)
      let shadow = eids.get(tool.name) ?? names.get(eid)?.tool
      if (shadow) {
        throw new Error(
          `tool name/identity collision: ${tool.name} and ${shadow.name}`,
        )
      }
      names.set(tool.name, { provider: source.name, tool })
      eids.set(eid, tool)
    }
  }
  return { names, eids }
}

/** Build a registry from runtime adapters. Replacement publishes one complete
 * snapshot; callers holding a tool keep that implementation for their call. */
export let registry = (providers: readonly Provider[] = []): Registry => {
  let sources = new Map<string, ReturnType<typeof snapshot>>()
  for (let source of providers) {
    if (sources.has(source.name)) {
      throw new Error(`provider ${source.name} is supplied twice`)
    }
    sources.set(source.name, snapshot(source))
  }
  let index = indexed([...sources.values()])
  let listeners = new Set<() => void>()
  let list = () => [...index.names.values()].map(({ tool }) => tool)
  let get = (id: string) => index.names.get(id)?.tool ?? index.eids.get(id)
  let describe = (id: string): Description | undefined => {
    let tool = get(id)
    if (!tool) return undefined
    let { run: _, input: _input, inputSchema: _schema, ...rest } = tool
    return {
      ...rest,
      provider: index.names.get(tool.name)!.provider,
      inputSchema: inputSchemaOf(tool),
      outputSchema: tool.outputSchema ?? answerSchema,
    }
  }
  return {
    list,
    get,
    describe,
    providers: () =>
      [...sources.values()].map((s) => ({
        name: s.name,
        tools: [...s.tools],
      })),
    search: (words) => {
      let terms = words.toLowerCase().split(/\s+/).filter(Boolean)
      return list().filter((t) => {
        let text = `${t.name} ${t.description} ${
          index.names.get(t.name)!.provider
        }`
          .toLowerCase()
        return terms.every((term) => text.includes(term))
      }).map((t) => describe(t.name)!)
    },
    replace: (name, tools) => {
      let next = new Map(sources)
      if (tools == null) next.delete(name)
      else next.set(name, snapshot({ name, tools }))
      let ready = indexed([...next.values()])
      sources = next
      index = ready
      for (let changed of listeners) changed()
    },
    subscribe: (changed) => {
      listeners.add(changed)
      return () => {
        listeners.delete(changed)
      }
    },
  }
}

/** Existing tool arrays are one local provider; a supplied registry is shared. */
export let registryOf = (tools: Tool[] | Registry): Registry =>
  Array.isArray(tools) ? registry([{ name: 'local', tools }]) : tools
