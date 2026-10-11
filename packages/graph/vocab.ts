// The generic tier's own declarations: the `./vocab` subpath of this package
// (`@yaks/graph/vocab`) — the five tools every graph answers, declared in
// ./vocab.json and implemented in ./tools.ts, which @yaks/mcp `core` shapes
// for one server.
//
// They are declared the same way any other package declares its tools:
// `graph apply`, `graph query`, `graph show`, `graph schema` and `search`,
// written `graph_apply` and the rest on a transport that gives a tool one flat
// name. Declaring them here rather than writing them into each listing is what
// makes the command line and an MCP tool list describe the same tools — and
// they belong to this package, because what they do is the graph itself, not
// whatever transport carried the call.
//
// No component is declared here: the tier describes a store, it does not add
// anything to one.

import { extendMeta, type Keywords, type VocabDoc } from '@yaks/vocab/runtime'
import { toolsSaid } from '@yaks/vocab/tools'
import type { NamedTool } from './tool_meta.ts'
export { offered, type ToolId, toolName } from './tool_meta.ts'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** The tool declarations the generic tier is listed and typed from. */
export let graphDoc: VocabDoc = doc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this package declares. */
export let docs: VocabDoc[] = [graphDoc]

// An answer describes a composed vocabulary, including internal and UX
// components. The authoring meta-schema reserves those names for the host;
// its name restriction does not constrain what the host reports.
let reports = new WeakMap<Keywords[], Record<string, unknown>>()
let reported = (keywords: Keywords[]): Record<string, unknown> => {
  let held = reports.get(keywords)
  if (held) return held
  let { $schema: _, ...meta } = extendMeta(keywords)
  let properties = meta.properties as Record<string, unknown>
  let { propertyNames: __, ...defs } = properties.$defs as Record<
    string,
    unknown
  >
  // Tool schemas are already read as 2020-12. Omit the dialect line, which
  // clients defaulting to an older draft can refuse before checking a value.
  let schema = { ...meta, properties: { ...properties, $defs: defs } }
  reports.set(keywords, schema)
  return schema
}

/** The generic tools a graph offers, without their implementations. Search
 * appears only where the host has that capability. The schema answer admits
 * the extension keywords and internal component names that host reports.
 * Authored declarations are read without checking them again at startup. */
export let declared = (
  { keywords = [], search = false }: {
    keywords?: Keywords[]
    search?: boolean
  } = {},
): Omit<NamedTool, 'run'>[] =>
  toolsSaid(graphDoc)
    .filter((decl) => decl.name != 'search' || search)
    .map((decl) => ({
      ...decl,
      name: decl.name!,
      // The keywords come from this graph, so no authored tool declaration
      // could state the complete schema before composition.
      ...(decl.name == 'graph_schema'
        ? { outputSchema: reported(keywords) }
        : {}),
    }))
