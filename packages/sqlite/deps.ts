// @db/sqlite's deps.ts, as this workspace runs it: the same two functions,
// without loading what the driver never uses. The driver imports
// @denosaurs/plug to download a prebuilt library where nothing names one, and
// ./sqlitepath.ts always names one, so the downloader runs only if somebody
// opens the driver some other way; and it imports all of @std/path for one
// function, which the posix form here does without asking the platform.
// Together they were 170 modules, most of what loading the driver cost a
// command. The workspace's import map puts this module in its place
// (deno.json `scopes`).

import type { dlopen as plugged } from 'jsr:@denosaurs/plug@1'

export { fromFileUrl } from '@std/path/posix/from-file-url'

/** plug's `dlopen`, imported the first time it is called. */
export let dlopen = async <S extends Deno.ForeignLibraryInterface>(
  options: Parameters<typeof plugged<S>>[0],
  symbols: Parameters<typeof plugged<S>>[1],
): Promise<Deno.DynamicLibrary<S>> =>
  (await import('jsr:@denosaurs/plug@1')).dlopen<S>(options, symbols)
