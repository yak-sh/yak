// What a precondition compares, defined ONCE. `apply()` hashes the stored
// value and the caller hashes the value it read; if the two ends computed the
// hash with different code, a guard could pass or refuse for no reason the
// caller can see. db.ts owns the rule and mcp.ts hands agents their token, so
// the function lives here rather than in either — mcp.ts is io-agnostic and
// must not pull SQLite in over stdio just to hash a string.
//
// A column holds text, a number or a bool in one slot, so String() is the
// single normalization both ends apply. null is never hashed: it IS the
// sentinel for "I read no value", which is how expected-absent compares equal
// without colliding with the hash of some value.
import { createHash } from 'node:crypto'

export let sha = (v: unknown) =>
  createHash('sha256').update(String(v)).digest('hex')
