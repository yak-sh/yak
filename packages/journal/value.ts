// How a property's value is written down. The journal has to hold values of
// every property type in two columns of its own, so each side of a delta is
// stored as JSON, with bytes marked by a non-JSON `binary:` prefix: `12` and `"12"` come back as a number and a string rather
// than as the same string twice, and a boolean survives an adapter that stores
// it as 0/1.
//
// Absence has one representation. A property with no value, a property a patch
// cleared, and a component that was not there are all `null` here — the same
// rule a client's JSON follows, where a `null` property is the cleared one.

/** A value as the journal stores it: JSON, marked base64 bytes, or `null`
 * for no value at all. JSON strings include their quotes and cannot collide
 * with the binary prefix. */
export let enc = (v: unknown): string | null =>
  v == null
    ? null
    : v instanceof Uint8Array
    ? `binary:${v.toBase64()}`
    : JSON.stringify(v)

/** A stored value read back. Text that is not JSON comes back as itself, so a
 * hand-written row never throws. */
export let dec = (v: unknown): unknown => {
  if (v == null) return null
  try {
    if (typeof v == 'string' && v.startsWith('binary:')) {
      return Uint8Array.fromBase64(v.slice(7))
    }
    return JSON.parse(String(v))
  } catch {
    return v
  }
}
