// The byte-store contract is independent of its adapters. R2 and a local
// directory both satisfy it, so a Worker's type graph must be able to name
// these methods without importing the Deno filesystem implementation.
export interface Blobs {
  has(key: string): Promise<boolean>
  put(key: string, bytes: Uint8Array): Promise<void>
  // A miss is one round trip, like a hit; `has` followed by `get` is two.
  read(key: string): Promise<Uint8Array<ArrayBuffer> | null>
  // For a caller that knows the key is there, a miss is an error.
  get(key: string): Promise<Uint8Array<ArrayBuffer>>
  delete(key: string): Promise<void>
  list(prefix: string): Promise<string[]>
  // The same listing with each object's age: key to the moment it landed, in
  // epoch milliseconds. A retention sweep needs it (versions.ts `pruned`) —
  // bytes written a minute ago may be a deploy whose row has not landed yet,
  // and deleting those would take a version's files out from under it.
  uploaded(prefix: string): Promise<Record<string, number>>
}
