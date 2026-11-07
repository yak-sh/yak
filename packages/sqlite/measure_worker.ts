/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />
// The thread a file is measured on (./measure.ts): a read-only connection of
// its own, the walk, and the answer, once.
import { open } from './db.ts'
import { type Measured, walk } from './measure.ts'

self.onmessage = async ({ data: file }: MessageEvent<string>) => {
  let tell = (said: Measured) => self.postMessage(said)
  let db = open(file, { readOnly: true })
  try {
    tell({ value: (await walk(db))! })
  } catch (e) {
    tell({ error: e instanceof Error ? e.stack ?? e.message : String(e) })
  } finally {
    db.close()
  }
}
