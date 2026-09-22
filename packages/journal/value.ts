// How a column's value is written down. The journal has to hold values of every
// column type in two columns of its own, so each side of a delta is stored as
// JSON: `12` and `"12"` come back as a number and a string rather than as the
// same string twice, and a boolean survives an adapter that stores it as 0/1.
//
// Absence has one representation. A column with no value, a column a patch
// cleared, and a component that was not there are all `null` here — the same
// rule a client's JSON follows, where a `null` column is the cleared one.

/** A value as the journal stores it: JSON, or `null` for no value at all. */
export let enc = (v: unknown): string | null =>
  v == null ? null : JSON.stringify(v)

/** A stored value read back. Text that is not JSON comes back as itself, so a
 * hand-written row never throws. */
export let dec = (v: unknown): unknown => {
  if (v == null) return null
  try {
    return JSON.parse(String(v))
  } catch {
    return v
  }
}
