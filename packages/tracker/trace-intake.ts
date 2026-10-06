/** Bounded trace admission. Only a complete, value-free capture has a bounded
 * write plan; arbitrary reporter bundles keep the error intake contract. */
import type { Bundle } from '@yaks/graph'

export let TRACE_CEILING = 42_000
// The accepted vocabulary writes at most 46 component/index/spine/stamp rows
// per bundle; 64 reserves margin. Never accept arbitrary graph properties here.
export let TRACE_ROW_BOUND = 64
// Two durable meta upserts: reservation and successful completion.
export let TRACE_RESERVATION_WRITES = 8
export let TRACE_MAX_BUNDLES = 201

export type TraceBatch = { scope: string; rows: Bundle[]; cost: number }
let uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
let properties: Record<string, readonly string[]> = {
  entity: ['eid'],
  trace: ['op', 'name', 'at'],
  span: ['trace', 'parent', 'op', 'name', 'plugin', 'package', 'outcome'],
  during: ['entity', 'app', 'space', 'process', 'request', 'kind'],
  elapsed: ['start', 'ms'],
  rows_read: ['n'],
  rows_written: ['n'],
  statements: ['n'],
  repeats: ['n'],
}
let object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v == 'object' && !Array.isArray(v)
let own = (row: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(row).every((key) => allowed.includes(key))
let id = (v: unknown): v is string => typeof v == 'string' && uuid.test(v)

/** Refuse to admit a partial/chunked tree. This bounds reference spines and
 * prevents a ceiling drop halfway through a capture from storing a fake tree. */
export let traceBatch = (body: unknown): TraceBatch | undefined => {
  if (!Array.isArray(body) || !body.length || body.length > TRACE_MAX_BUNDLES) {
    return
  }
  let root: string | undefined, scope: string | undefined
  let spans = new Map<string, { trace: string; parent?: string }>()
  let ids = new Set<string>()
  for (let row of body) {
    if (!object(row) || !own(row, Object.keys(properties))) return
    for (let [comp, value] of Object.entries(row)) {
      if (!object(value) || !own(value, properties[comp])) return
      for (let [prop, v] of Object.entries(value)) {
        if (
          comp == 'entity' || (comp == 'during' && prop != 'kind') ||
          (comp == 'span' && ['trace', 'parent'].includes(prop))
        ) {
          if (!id(v)) return
        } else if (
          ['elapsed', 'rows_read', 'rows_written', 'statements', 'repeats']
            .includes(comp)
        ) {
          if (typeof v != 'number' || !Number.isFinite(v) || v < 0) return
        } else if (typeof v != 'string' || v.length > 512) return
      }
    }
    if (!object(row.entity) || !id(row.entity.eid) || ids.has(row.entity.eid)) {
      return
    }
    ids.add(row.entity.eid)
    if (!object(row.during) || !id(row.during.space)) return
    if (scope && scope != row.during.space) return
    scope = row.during.space
    if (object(row.trace)) {
      if (
        root || row.span || !row.trace.op || !row.trace.name ||
        typeof row.trace.at != 'string' ||
        !Number.isFinite(Date.parse(row.trace.at))
      ) return
      root = row.entity.eid
    } else if (object(row.span)) {
      if (!id(row.span.trace) || !row.span.op || !row.span.name) return
      spans.set(row.entity.eid, {
        trace: row.span.trace,
        parent: row.span.parent as string | undefined,
      })
    } else return
  }
  if (!root || !scope || !spans.size) return
  let roots = 0
  for (let [eid, span] of spans) {
    if (span.trace != root) return
    if (!span.parent) roots++
    let seen = new Set([eid]), parent = span.parent
    while (parent) {
      if (seen.has(parent) || !spans.has(parent)) return
      seen.add(parent)
      parent = spans.get(parent)!.parent
    }
  }
  if (roots != 1) return
  return {
    scope,
    rows: body as Bundle[],
    cost: body.length * TRACE_ROW_BOUND + TRACE_RESERVATION_WRITES,
  }
}

export type TraceReservation = { reserved: number; until: number | null }
export type TraceBudget = { slots: TraceReservation[] }
/** Parse durable reservations fail-closed; corrupt metadata never reopens a
 * budget or turns rejected tracing into a recursively reported tracker error. */
export let traceBudget = (
  text: string | undefined,
): TraceBudget | undefined => {
  if (text == null) return { slots: [] }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return
  }
  if (
    !object(value) || !Array.isArray(value.slots) ||
    value.slots.length > Math.floor(
        TRACE_CEILING / (2 * TRACE_ROW_BOUND + TRACE_RESERVATION_WRITES),
      )
  ) return
  let slots: TraceReservation[] = []
  for (let slot of value.slots) {
    if (
      !object(slot) || typeof slot.reserved != 'number' ||
      !Number.isFinite(slot.reserved) ||
      slot.reserved <= 0 || slot.reserved > TRACE_CEILING ||
      (slot.until !== null &&
        (typeof slot.until != 'number' || !Number.isFinite(slot.until)))
    ) return
    slots.push({ reserved: slot.reserved, until: slot.until as number | null })
  }
  if (slots.reduce((n, slot) => n + slot.reserved, 0) > TRACE_CEILING) return
  return { slots }
}
/** A pending reservation never expires after a crash. A completed one stays
 * charged for a full hour from completion, including across clock rollback. */
export let reserveTrace = (
  held: TraceBudget | undefined,
  now: number,
  cost: number,
): TraceBudget | undefined => {
  let slots = (held?.slots ?? []).filter((slot) =>
    slot.until == null || slot.until > now
  )
  let reserved = slots.reduce((n, slot) => n + slot.reserved, 0)
  if (cost > TRACE_CEILING - reserved) return
  return { slots: [...slots, { reserved: cost, until: null }] }
}
