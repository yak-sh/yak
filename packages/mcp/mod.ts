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
 * - **`graph_show`** — entities whole, with what points at them, as bundles;
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
 * them, and a reply says the answer both ways: the prose its bundles carry as
 * text, the bundles themselves as `structuredContent`. Nothing declares an
 * output schema, because what a bundle is the vocabulary already says; the one
 * schema published is the WRITE door's input, derived from that same
 * vocabulary ({@link bundleSchema}).
 *
 * ## A call is an entity
 * `tools/call` does not call a function. It writes `call{to, args}` into the
 * graph, signed as the identity the door authenticated, and awaits what
 * answers it — {@link https://jsr.io/@yaks/tools | @yaks/tools}' runner finds
 * that call, runs the tool with the CALLER's actor, and lands its bundles. So
 * every call this door served is an entity somebody can read afterwards, and a
 * door whose graph cannot take one keeps a ledger of its own
 * ({@link Options.calls}).
 *
 * ## Two doors, one server
 * {@link mcp} is Streamable HTTP as a portable `Request` → `Response` handler,
 * mountable beside {@link https://jsr.io/@yaks/api | @yaks/api} on Deno, Node
 * or a Worker. `@yaks/mcp/stdio` is the same server on a process's own streams,
 * kept in its own module so importing this one never drags a runtime in.
 *
 * ## Trust
 * The door decides who is writing. {@link mcp} builds a server per request
 * around the identity its `authenticate` returned; the call is written in that
 * name, and the runner signs what the tool answered with the same one — never
 * with what the client said about itself.
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
 * an intent's `msg`, and a tool may carry `meta` the client is handed verbatim.
 *
 * @module
 */

export { mcp, type MountOptions } from './mount.ts'
export {
  annotated,
  listing,
  type Options,
  roster,
  type Security,
  server,
  shapeOf,
} from './server.ts'
export { rosterLine, rosterVersion } from './roster.ts'
export { core, type CoreOpts, type Search } from './tools.ts'
export { type BundleOpts, bundleSchema, type Depth } from './schema.ts'
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
