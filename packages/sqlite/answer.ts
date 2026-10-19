// Query answers share their column names and scalar values. UUIDs occupy their
// sixteen content bytes, so a repeated projection fits the same byte bound as
// a small object answer without widening the cache.
import type { Row } from '@yaks/sql/core'

export type Answer =
  | { bytes: number; rows: Row[] }
  | {
    bytes: number
    cols: string[]
    values: unknown[]
    names: Uint8Array
    eids?: Uint8Array
    data: Uint16Array
  }
let uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
let negativeZero = Symbol('negative zero')
let hex = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))
let unpack = (bytes: Uint8Array, at: number) => {
  let text = ''
  for (let i = at * 16; i < (at + 1) * 16; i++) text += hex[bytes[i]]
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-` +
    `${text.slice(16, 20)}-${text.slice(20)}`
}

/** A copied answer and its retained value bytes, bounded by the caller. */
export let packed = (rows: Row[], limit = 16 << 10): Answer | undefined => {
  let text = JSON.stringify(
    rows,
    (_key, v) => typeof v == 'bigint' ? String(v) : v,
  )
  let plain = () =>
    text.length * 2 <= limit
      ? { bytes: text.length * 2, rows: structuredClone(rows) }
      : undefined
  if (text.length * 2 <= limit) return plain()
  let cols = Object.keys(rows[0])
  if (rows.length * cols.length * 2 > limit) return plain()
  let unique = new Set(rows.map((r) => r.eid))
  let inline = cols[0] == 'eid' && unique.size == rows.length &&
    rows.every((r) => typeof r.eid == 'string' && uuid.test(r.eid))
  let identity: number[] = []
  let ids = new Map<string, number>(), atoms = new Map<unknown, number>()
  let values: unknown[] = [], bytes: number[] = [], codes: number[] = []
  for (let row of rows) {
    let keys = Object.keys(row)
    if (keys.length != cols.length || keys.some((k, i) => k != cols[i])) {
      return plain()
    }
    for (let col of cols) {
      let value = row[col]
      if (inline && col == 'eid') {
        let raw = String(value).replaceAll('-', '')
        for (let i = 0; i < 32; i += 2) {
          identity.push(parseInt(raw.slice(i, i + 2), 16))
        }
        continue
      }
      if (
        value != null && typeof value == 'object' ||
        typeof value == 'function' || typeof value == 'symbol'
      ) return plain()
      if (typeof value == 'string' && uuid.test(value)) {
        let id = ids.get(value)
        if (id == null) {
          id = ids.size
          ids.set(value, id)
          let raw = value.replaceAll('-', '')
          for (let i = 0; i < 32; i += 2) {
            bytes.push(parseInt(raw.slice(i, i + 2), 16))
          }
        }
        codes.push(0x8000 | id)
      } else {
        let key = Object.is(value, -0) ? negativeZero : value
        let id = atoms.get(key)
        if (id == null) {
          id = values.length
          atoms.set(key, id)
          values.push(value)
        }
        codes.push(id)
      }
    }
    if (codes.length * 2 + bytes.length + identity.length > limit) {
      return plain()
    }
  }
  if (!inline && !ids.size || ids.size > 0x8000 || atoms.size > 0x8000) {
    return plain()
  }
  if (inline) cols = cols.slice(1)
  let eids = inline ? new Uint8Array(identity) : undefined
  let data = new Uint16Array(codes), names = new Uint8Array(bytes)
  let size = data.byteLength + names.byteLength + (eids?.byteLength ?? 0) +
    JSON.stringify(
        [cols, values],
        (_key, v) => typeof v == 'bigint' ? String(v) : v,
      ).length * 2
  if (size > limit || size >= text.length * 2) return plain()
  return { bytes: size, cols, values, names, data, eids }
}

/** A fresh answer: neither a row nor a nested value aliases the kept one. */
export let copied = (answer: Answer): Row[] => {
  if ('rows' in answer) return structuredClone(answer.rows)
  let { cols, values, names, data, eids } = answer
  let named = Array.from(
    { length: names.length / 16 },
    (_, i) => unpack(names, i),
  )
  return Array.from(
    { length: eids ? eids.length / 16 : data.length / cols.length },
    (_, i) => ({
      ...eids ? { eid: unpack(eids, i) } : {},
      ...Object.fromEntries(cols.map((col, j) => {
        let code = data[i * cols.length + j]
        return [col, code & 0x8000 ? named[code & 0x7fff] : values[code]]
      })),
    }),
  )
}
