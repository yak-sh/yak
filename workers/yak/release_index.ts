// The private release's path-to-byte index. Its key sits beside the release
// prefix, leaving every path inside that prefix available to the app.
import type { Objects } from '@yaks/blob'

export let META = '.json'
export type File = { key: string; sha?: string }
export type Index = Record<string, File>

export let encode = (index: Index) =>
  new TextEncoder().encode(JSON.stringify(index))

export let indexOf = async (
  blobs: Objects,
  prefix: string,
): Promise<Index | null> => {
  let bytes = await blobs.read(prefix.slice(0, -1) + META)
  return bytes ? JSON.parse(new TextDecoder().decode(bytes)) as Index : null
}
