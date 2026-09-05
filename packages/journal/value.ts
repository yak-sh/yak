// How a column's value is written down. A journal has to hold values of every
// column type in two columns of its own, so each side of a delta is JSON: `12`
// and `"12"` come back as a number and a string rather than as one string
// twice, and a boolean survives an adapter that stores it as 0/1.
//
// Absence has one spelling. A column with no value, a column a patch cleared,
// and a component that was not there are all `null` here — the same rule the
// wire uses, where a `null` column IS the cleared one.

/** A value as the journal stores it: JSON, or `null` for no value at all. */
export let enc = (v: unknown): string | null =>
  v == null ? null : JSON.stringify(v)

/** A stored value read back. Text that is not JSON comes back as itself, so a
 * hand-written row is never a thrown error. */
export let dec = (v: unknown): unknown => {
  if (v == null) return null
  try {
    return JSON.parse(String(v))
  } catch {
    return v
  }
}
