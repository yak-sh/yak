// A file spool appends immutable JSONL segments. The newline publishes one
// complete record; only committed intake removes it. Writers share no offsets.

import type { Bundle } from '@yaks/graph'
import type { Source } from './service.ts'

// Every write and sync is asynchronous: a host reporting into the spool keeps
// its thread while a busy disk takes seconds over an fsync.
let sync = async (dir: string) => {
  let file = await Deno.open(dir, { read: true })
  try {
    await file.sync()
  } finally {
    file.close()
  }
}

export let files = (dir: string): {
  append: (line: string) => Promise<void>
  source: Source
} => ({
  append: async (line) => {
    await Deno.mkdir(dir, { recursive: true, mode: 0o700 })
    let name = `${dir}/${Date.now()}-${crypto.randomUUID()}`
    let file = await Deno.open(`${name}.jsonl`, {
      write: true,
      createNew: true,
      mode: 0o600,
    })
    try {
      let bytes = new TextEncoder().encode(line)
      let at = 0
      while (at < bytes.length) at += await file.write(bytes.subarray(at))
      await file.sync()
    } finally {
      file.close()
    }
    await sync(dir)
  },
  source: async function* () {
    let names: string[] = []
    try {
      for await (let entry of Deno.readDir(dir)) {
        if (entry.isFile && entry.name.endsWith('.jsonl')) {
          names.push(entry.name)
        }
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return
      throw error
    }
    for (let name of names.sort()) {
      let path = `${dir}/${name}`
      let text: string
      try {
        text = await Deno.readTextFile(path)
      } catch (error) {
        // Another intake can acknowledge a segment after this directory read.
        if (error instanceof Deno.errors.NotFound) continue
        throw error
      }
      // A writer may still be filling this segment. Neither a partial tail
      // nor a crash before its newline can hold later complete records back.
      if (!text.endsWith('\n')) continue
      let rows: Bundle[] = text.trimEnd().split('\n').flatMap((line) =>
        JSON.parse(line)
      )
      yield {
        rows,
        ack: async () => {
          try {
            await Deno.remove(path)
          } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error
          }
          await sync(dir)
        },
      }
    }
  },
})
