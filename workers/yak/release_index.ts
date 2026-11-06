// The private release's path-to-byte index. Its key sits beside the release
// prefix, leaving every path inside that prefix available to the app. A file
// a first view reads may carry its `text` (release.ts `packed`), so a reader
// holding no index reads one object for it, not the index and then the bytes.

export let META = '.json'
export type File = { key: string; sha: string; text?: string }
export type Index = Record<string, File>

export let encode = (index: Index) =>
  new TextEncoder().encode(JSON.stringify(index))

export let decode = (bytes: Uint8Array): Index =>
  JSON.parse(new TextDecoder().decode(bytes))
