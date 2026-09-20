/**
 * @yaks/telemetry — RETIRED. The graph holds what this log held: a tool call is
 * a `call` entity claimed by an `execution` and settled as a `result` with its
 * `ms` and its `created.by`, and a failure is the `error` or `exception` beside
 * it ({@link https://jsr.io/@yaks/tools | @yaks/tools}). `/telemetry` is a
 * query. Nothing in `packages/` composes this; it stands until the fleet server
 * that imports it is deleted, and it gets no plugin facets.
 *
 * What the tools are doing: every call through a door, who made it, how long it
 * took, whether it worked.
 *
 * The errors callers hit are the docs not yet written, and the errors nobody
 * hits are the ones that decay into a hand repair months on. This is the log
 * that shows both. It sits BESIDE a graph, deliberately outside it: rows carry
 * no entity id and no component, nothing links them, no client cache ever
 * carries them. They accrete.
 *
 * Four small pieces:
 *
 * - {@link schema} emits the one table;
 * - {@link record} appends a {@link Call} and never throws, since a telemetry
 *   failure must never break the thing it watches;
 * - {@link recent} reads newest-first with repeated errors folded into counted
 *   cohorts ({@link fingerprint}), and {@link stats} gives latency percentiles
 *   per door and tool;
 * - {@link toolCall} and {@link outcome} read an MCP exchange as a call.
 *
 * ```ts
 * import { record, recent, schema } from '@yaks/telemetry'
 *
 * for (let stmt of schema()) db.exec(stmt)
 * record(db, { source: 'mcp', name: 'task_list', ok: true, ms: 12 })
 * recent(db, { only: 'errors' }) // the view you want most days
 * ```
 *
 * Free text is scrubbed on the way in ({@link scrub}): home paths, URLs, ids
 * and long tokens are replaced and the field is capped, so a served log is
 * already clean and identical crashes share a fingerprint.
 *
 * The database is a two-method {@link Driver}; a host hands over the query
 * and exec it already has.
 *
 * @module
 */

export * from './driver.ts'
export * from './ddl.ts'
export * from './scrub.ts'
export * from './record.ts'
export * from './cohort.ts'
export * from './read.ts'
export * from './mcp.ts'
