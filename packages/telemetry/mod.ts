/**
 * @yaks/telemetry — RETIRED. The graph now holds what this log held: a tool
 * call is a `call` entity, claimed by an `execution` and completed as a
 * `result` carrying its `ms` and its `created.by`, and a failure is the `error`
 * or `exception` component beside it
 * ({@link https://jsr.io/@yaks/tools | @yaks/tools}). `/telemetry` is a graph
 * query now. No package in `packages/` uses this one; it remains only until the
 * fleet server that imports it is deleted, and it exports no plugin entry
 * points.
 *
 * What the tools are doing: every call, whichever entry point it arrived
 * through, who made it, how long it took, and whether it worked.
 *
 * The errors callers hit are the documentation not yet written, and the errors
 * nobody hits are the ones that quietly break and are repaired by hand months
 * later. This log shows both. It is stored BESIDE a graph, deliberately outside
 * it: rows carry no entity id and no component, nothing references them, and no
 * client cache ever holds them. They only accumulate.
 *
 * Four small pieces:
 *
 * - {@link schema} returns the statements that create the one table;
 * - {@link record} inserts a {@link Call} and never throws, since a telemetry
 *   failure must never break what it is measuring;
 * - {@link recent} reads newest first with repeated errors grouped into counted
 *   cohorts ({@link fingerprint}), and {@link stats} gives latency percentiles
 *   per source and tool;
 * - {@link toolCall} and {@link outcome} read an MCP request and reply as a
 *   call and its outcome.
 *
 * ```ts
 * import { record, recent, schema } from '@yaks/telemetry'
 *
 * for (let stmt of schema()) db.exec(stmt)
 * record(db, { source: 'mcp', name: 'task_list', ok: true, ms: 12 })
 * recent(db, { only: 'errors' }) // the view you want most days
 * ```
 *
 * Free text is scrubbed on the way in ({@link scrub}): home directory paths,
 * URLs, ids and long tokens are replaced and the field is truncated, so the log
 * is already clean before it is served and identical crashes share a
 * fingerprint.
 *
 * The database is a two-method {@link Driver}; the caller passes in the `query`
 * and `exec` it already has.
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
