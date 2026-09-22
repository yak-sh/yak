/**
 * @yaks/mcp — the Model Context Protocol server for a yaks graph. It gives an
 * agent the same bundles every other interface onto the graph serves.
 *
 * It ships the generic tier and nothing else — five tools that work over any
 * vocabulary, rather than one tool per component:
 *
 * - **`graph_apply`** — bundles in, the transaction as applied out, one bundle
 *   per entity;
 * - **`graph_query`** — a query string in, bundles out;
 * - **`graph_show`** — whole entities, plus everything that references them, as
 *   bundles;
 * - **`graph_schema`** — the index of every component, or one component in
 *   full: each column's type and description, what references it, and an
 *   example bundle that writes it;
 * - **`search`** — ranked text results, when a {@link Search} is passed.
 *
 * ```ts
 * import { mcp } from '@yaks/mcp'
 * // let handler = mcp({ graph, authenticate })
 * // Deno.serve((request) => handler(request))
 * ```
 *
 * ## Bundles, in and out
 * A bundle already carries everything a hand-written tool would take — which
 * entity, which components, which columns — so an agent that knows the bundle
 * format can write anything the vocabulary declares. Every tool here accepts
 * and returns bundles, and a reply carries the answer twice: the text its
 * bundles hold as `content`, and the bundles themselves as
 * `structuredContent`. No tool declares an output schema, because the
 * vocabulary already describes what a bundle is; the one schema published is
 * `graph_apply`'s input, derived from that same vocabulary
 * ({@link bundleSchema}).
 *
 * ## A call is an entity
 * An MCP `tools/call` does not call a function directly. It writes a
 * `call{to, args}` entity into the graph, signed as the identity this server
 * authenticated, and waits for the result —
 * {@link https://jsr.io/@yaks/tools | @yaks/tools}' runner finds that call,
 * runs the tool as the caller, and applies the bundles the tool returned. So
 * every call this server handled is an entity somebody can read afterwards,
 * and a server whose graph should not record them writes the call and its
 * result into a separate graph ({@link Options.calls}).
 *
 * ## Two transports, one server
 * {@link mcp} is Streamable HTTP as a portable `Request` → `Response` handler,
 * mountable beside {@link https://jsr.io/@yaks/api | @yaks/api} on Deno, Node
 * or a Cloudflare Worker. `@yaks/mcp/stdio` is the same server on the
 * process's own stdin and stdout, kept in its own module so importing this one
 * never pulls a runtime dependency in with it.
 *
 * ## Trust
 * This server decides who is writing. {@link mcp} builds a server per HTTP
 * request around the identity its `authenticate` returned; the call entity is
 * written in that name, and the runner signs whatever the tool returned with
 * the same one — never with what the client claimed about itself.
 *
 * ## Plugins contribute tools
 * A {@link https://jsr.io/@yaks/graph | @yaks/graph} `Plugin` contributes
 * `tools` the same way it contributes components and hooks; they are listed
 * beside the generic tier, with the same signing and the same reply shape.
 *
 * ## A tool list goes stale
 * A client lists the tools once and caches that list. {@link roster} is the
 * names this server lists right now and {@link rosterVersion} hashes them; a
 * host that remembers the version a session connected under passes
 * {@link Options.roster}, and every result then carries one line naming what
 * changed ({@link rosterLine}). The write schema is open for the same reason:
 * the schema describes, the server decides.
 *
 * ## When a host serves more than tools
 * {@link Options.extend} is handed the SDK's own server object once the tools
 * are registered on it, so resources, prompts and the host's own capabilities
 * are registered on the same server rather than a second one beside it. A tool
 * may also carry `meta`, which the client is handed verbatim as `_meta`.
 *
 * @module
 */

export { mcp, type MountOptions } from './mount.ts'
export {
  annotated,
  COMMAND,
  inputSchemaOf,
  listing,
  type Options,
  roster,
  type Security,
  server,
  shapeOf,
} from './server.ts'
export { rosterLine, rosterVersion } from './roster.ts'
export { core, type CoreOpts, type Search } from './tools.ts'
export {
  type BundleOpts,
  bundleSchema,
  type Depth,
  schemaSchema,
} from './schema.ts'
// The vocabulary described as plain data belongs to @yaks/graph —
// `graph_schema` builds its result there — and a server that passes `guide`
// imports its type from the same place.
export type { Guide } from '@yaks/graph'
export type { Handler } from '@yaks/api'
