/**
 * @yaks/mcp — the MCP server for a yaks graph: an agent's door onto the same
 * bundles every other door speaks.
 *
 * It ships the GENERIC tier and nothing else — five tools over any vocabulary,
 * no tool per component:
 *
 * - **`graph_apply`** — bundles in, the batch as applied out;
 * - **`graph_query`** — a query line in, bundles out;
 * - **`graph_show`** — entities whole, with what points at them and the edges
 *   between them;
 * - **`vocab`** — the loaded vocabulary as JSON Schema, so an agent can learn
 *   the shape before it writes;
 * - **`search`** — words, ranked, when a {@link Search} is passed.
 *
 * ```ts
 * import { mcp } from '@yaks/mcp'
 * // let door = mcp({ graph, authenticate })
 * // Deno.serve((request) => door(request))
 * ```
 *
 * ## Bundles, in and out
 * A bundle already says everything a hand-written tool would say — which
 * entity, which components, which columns — so an agent that knows the wire can
 * write anything the vocabulary declares. Every tool here takes and answers
 * them, and each declares an `outputSchema` DERIVED from the vocabulary
 * ({@link bundleSchema}), so a caller reads a described value instead of
 * parsing prose.
 *
 * ## Two doors, one server
 * {@link mcp} is Streamable HTTP as a portable `Request` → `Response` handler,
 * mountable beside {@link https://jsr.io/@yaks/api | @yaks/api} on Deno, Node
 * or a Worker. `@yaks/mcp/stdio` is the same server on a process's own streams,
 * kept in its own module so importing this one never drags a runtime in.
 *
 * ## Trust
 * The door decides who is writing. {@link mcp} builds a server per request
 * around the identity its `authenticate` returned, and every batch a tool
 * applies is signed with it — never with what the client said about itself.
 *
 * ## Plugins bring tools
 * A {@link https://jsr.io/@yaks/graph | @yaks/graph} `Plugin` contributes
 * `tools` the same way it contributes components and hooks; they are listed
 * beside the generic tier, with the same signing and the same reply shape.
 *
 * @module
 */

export { mcp, type MountOptions } from './mount.ts'
export { type Options, server } from './server.ts'
export { core, type CoreOpts, type Search } from './tools.ts'
export { type Edge, edges } from './edges.ts'
export {
  type BundleOpts,
  bundleSchema,
  type Depth,
  edgeSchema,
  outputSchema,
  showSchema,
  vocabSchema,
} from './schema.ts'
export type { Handler } from '@yaks/api'
