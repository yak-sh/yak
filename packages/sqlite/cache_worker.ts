/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />
// The thread a cache is trimmed on (./cache.ts): its file checks, vacuum and
// lock waits hold this thread, never its caller's.
import { type Cache, trim, type Trimmed } from './cache.ts'

self.onmessage = async (
  { data: { path, cache } }: MessageEvent<{ path: string; cache: Cache }>,
) => {
  let tell = (said: Trimmed) => self.postMessage(said)
  try {
    tell({ value: await trim(path, cache) })
  } catch (e) {
    tell({ error: e instanceof Error ? e.stack ?? e.message : String(e) })
  }
}
