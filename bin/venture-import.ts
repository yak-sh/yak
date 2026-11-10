// Legacy exports stay in the importing process. This inventory assigns stable
// identities and resolves references before an app-specific projection writes
// through its graph; it neither reads a live account nor starts fulfillment.
import { derivedEid } from '@yaks/graph/identity'

export type Row = Record<string, unknown>
export type Tables = Record<string, Row[]>
export type Owner = { owner?: string; via?: string }
export type Reference = { table: string; optional?: boolean }
export type Table = {
  key: string[]
  refs?: Record<string, Reference>
  optional?: boolean
}
export type Catalog = Record<string, Table>
export type Imported = {
  eid: string
  table: string
  key: unknown[]
  data: Row
  refs: Record<string, string>
}
export type Inventory = {
  source: string
  counts: Record<string, number>
  unavailable: string[]
  unmapped: string[]
  rows: Imported[]
}

let present = (value: unknown): boolean => value != null && value !== ''
let keyValue = (value: unknown): boolean =>
  (typeof value === 'string' && value !== '') ||
  (typeof value === 'number' && Number.isSafeInteger(value))
let tuple = (row: Row, props: string[]): unknown[] => props.map((p) => row[p])
let address = (table: string, values: unknown[]): string =>
  JSON.stringify([table, ...values.map(String)])

/** An export's identity namespace names the source installation, not its date. */
export let importedEid = (
  source: string,
  table: string,
  values: unknown[],
): string =>
  derivedEid(JSON.stringify(['venture-import', source, address(table, values)]))

let indexed = (tables: Tables, catalog: Catalog): Map<string, Row> => {
  let index = new Map<string, Row>()
  for (let [name, spec] of Object.entries(catalog)) {
    if (!(name in tables) && spec.optional) continue
    if (!Array.isArray(tables[name])) {
      throw Error(`Missing source table: ${name}`)
    }
    for (let row of tables[name]) {
      let values = tuple(row, spec.key)
      if (!values.every(keyValue)) {
        throw Error(`Missing or unsafe source key: ${name}`)
      }
      let key = address(name, values)
      if (index.has(key)) throw Error(`Duplicate source key: ${name}`)
      index.set(key, row)
    }
  }
  return index
}

let references = (
  source: string,
  row: Row,
  table: string,
  spec: Table,
  index: Map<string, Row>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(spec.refs ?? {}).flatMap(([prop, ref]) => {
      let value = row[prop]
      if (!present(value) && ref.optional) return []
      if (!present(value) || !index.has(address(ref.table, [value]))) {
        throw Error(`Missing source reference: ${table}.${prop} → ${ref.table}`)
      }
      return [[prop, importedEid(source, ref.table, [value])]]
    }),
  )

/** Every declared table must be present: an absent export never means zero. */
export let inventory = (
  source: string,
  tables: Tables,
  catalog: Catalog,
): Inventory => {
  if (!source) throw Error('A source installation is required')
  let index = indexed(tables, catalog)
  return {
    source,
    counts: Object.fromEntries(
      Object.entries(tables).map(([name, rows]) => [name, rows.length]),
    ),
    unavailable: Object.keys(catalog).filter((t) => !(t in tables)),
    unmapped: Object.keys(tables).filter((t) => !(t in catalog)),
    rows: Object.entries(catalog).flatMap(([table, spec]) =>
      (tables[table] ?? []).map((data) => ({
        eid: importedEid(source, table, tuple(data, spec.key)),
        table,
        key: tuple(data, spec.key),
        data: structuredClone(data),
        refs: references(source, data, table, spec, index),
      }))
    ),
  }
}

/** Checks child ownership through its referenced parent without merging guests. */
export let ownership = (
  imported: Inventory,
  child: string,
  parent: string,
  owner: string,
): void => {
  let byId = new Map(imported.rows.map((r) => [r.eid, r]))
  for (let row of imported.rows.filter((r) => r.table === child)) {
    if (!(parent in row.refs)) continue
    let ancestor = byId.get(row.refs[parent])
    if (!ancestor || row.refs[owner] !== ancestor.refs[owner]) {
      throw Error(`Source ownership mismatch: ${child}.${parent}`)
    }
  }
}

export type Copy<T> = {
  project: (row: Imported) => T | undefined
  get: (eid: string) => T | undefined | Promise<T | undefined>
  put: (eid: string, value: T) => unknown | Promise<unknown>
  same: (a: T, b: T) => boolean
}

/** A rerun updates changed source rows and leaves matching destination rows alone. */
export let copy = async <T>(
  imported: Inventory,
  target: Copy<T>,
): Promise<{ written: number; unchanged: number; skipped: number }> => {
  let counts = { written: 0, unchanged: 0, skipped: 0 }
  for (let row of imported.rows) {
    let value = target.project(row)
    if (value === undefined) {
      counts.skipped++
      continue
    }
    let existing = await target.get(row.eid)
    if (existing !== undefined && target.same(existing, value)) {
      counts.unchanged++
    } else {
      await target.put(row.eid, value)
      counts.written++
    }
    let read = await target.get(row.eid)
    if (read === undefined || !target.same(read, value)) {
      throw Error(`Destination reconciliation failed: ${row.table}`)
    }
  }
  return counts
}
