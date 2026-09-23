// A property holding a JSON value — @yaks/vocab's `jsonb` scalar, declared
// `object`, `array` or a union of types — kept as SQLite's binary JSON. This
// file is the one place that says how such a value crosses the boundary, so
// every SQLite-shaped adapter (this package, @yaks/d1, a Durable Object's)
// writes and reads it the same way:
//
//   in    the value's JSON text, bound through `jsonb(?)`
//   out   `json(col)`, read as text and parsed here
//
// The `|| ''` on the way out is deliberate. `json()` marks its result with
// SQLite's JSON subtype, and a driver that honors the subtype (@db/sqlite)
// parses the value itself, so a JSON string would come back as the text it
// holds and be parsed a second time here. Concatenation drops the subtype, and
// every engine then returns the same text.
//
// `decoded` is also where a boolean comes back. SQLite has no boolean type, so
// a boolean property stores as the 0/1 of an integer column (./write.ts), and
// reads back as `false`/`true`, the type its vocabulary declares. `projected`
// reads a `.fields` projection in a query's raw rows the same way, so a value
// comes back as one type whichever door asked for it.

import type { Vocab } from '@yaks/vocab'
import type { Param } from './driver.ts'

/** Whether `comp.prop` holds a JSON value. */
export let isJsonb = (v: Vocab, comp: string, prop: string): boolean =>
  v.prop(comp, prop)?.scalar == 'jsonb'

/** A JSON value as the parameter `jsonb(?)` binds; null clears the column. */
export let jsonIn = (value: unknown): Param =>
  value == null ? null : JSON.stringify(value)

/** The SQL reading a stored JSON value back as its JSON text. */
export let jsonOut = (expr: string): string => `(json(${expr}) || '')`

// One value as read: a JSON column's text parsed back into its value, a
// boolean's 0/1 as `false`/`true`, anything else as stored.
let value = (v: Vocab, comp: string, prop: string, raw: unknown): unknown => {
  let scalar = v.prop(comp, prop)?.scalar
  return typeof raw == 'string' && scalar == 'jsonb'
    ? JSON.parse(raw)
    : raw != null && scalar == 'bool'
    ? !!Number(raw)
    : raw
}

/** A component row as read, each JSON column parsed back into its value and
 * each boolean column read as `true`/`false`. */
export let decoded = <R extends Record<string, unknown>>(
  v: Vocab,
  comp: string,
  row: R,
): R => {
  for (let [k, raw] of Object.entries(row)) {
    ;(row as Record<string, unknown>)[k] = value(v, comp, k, raw)
  }
  return row
}

/** A row of a query's raw answer, each `.fields` projection read as
 * {@link decoded} reads it in a component. A projected column is named by its
 * path, `comp.prop`; the rest of the row (`eid`, an aggregate's `value` and
 * `n`) is left as the statement returned it. */
export let projected = <R extends Record<string, unknown>>(
  v: Vocab,
  row: R,
): R => {
  for (let [k, raw] of Object.entries(row)) {
    let dot = k.indexOf('.')
    if (dot > 0) {
      ;(row as Record<string, unknown>)[k] = value(
        v,
        k.slice(0, dot),
        k.slice(dot + 1),
        raw,
      )
    }
  }
  return row
}
