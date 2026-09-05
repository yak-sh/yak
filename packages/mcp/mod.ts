/**
 * @yaks/mcp — the MCP server for a yaks graph: an agent's door onto the same
 * bundles every other door speaks.
 *
 * It ships the GENERIC tier and nothing else — five tools over any vocabulary,
 * no tool per component:
 *
 * - **`graph_apply`** — bundles in, the batch as applied out, one bundle per
 *   entity;
 * - **`graph_query`** — a query line in, bundles out;
 * - **`graph_show`** — entities whole, with what points at them and the edges
 *   between them;
 * - **`graph_schema`** — the index of every component, or one of them in full:
 *   each column's type and meaning, what points at it, and a bundle that
 *   writes it;
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
 * ## A tool list goes stale
 * A client lists the tools once and holds that list. {@link roster} is what
 * this server is listing right now and {@link rosterVersion} names it; a host
 * that remembers the version a session connected under passes
 * {@link Options.roster}, and every result then carries the one line naming
 * what moved ({@link rosterLine}). The write schema is open for the same
 * reason: the schema describes, the server decides.
 *
 * ## When a host serves more than tools
 * {@link Options.extend} is handed the SDK's own server once the tools are on
 * it, so resources, prompts and a capability of the host's own go on the SAME
 * server rather than beside it. A tool whose words and value differ returns a
 * {@link Say}, and a tool may carry `meta` the client is handed verbatim.
 *
 * @module
 */

export { mcp, type MountOptions } from './mount.ts'
export { listing, type Options, roster, Say, server } from './server.ts'
export { rosterLine, rosterVersion } from './roster.ts'
export { core, type CoreOpts, type Search } from './tools.ts'
export { type Edge, edges } from './edges.ts'
export {
  type BundleOpts,
  bundleSchema,
  type Depth,
  edgeSchema,
  outputSchema,
  showSchema,
} from './schema.ts'
export {
  type Col,
  detail as compDetail,
  type Guide,
  index as compIndex,
  ofKind,
  type Said,
  schemaSchema,
  summary as compSummary,
  type Word,
} from './words.ts'
export type { Handler } from '@yaks/api'
