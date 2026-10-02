// A file spool appends immutable JSONL segments. The newline publishes one
// complete record; only committed intake removes it. Writers share no offsets.

import type { Bundle } from '@yaks/graph'
import type { Source } from './service.ts'

let sync = (dir: string) => {
  let file = Deno.openSync(dir, { read: true })
  try {
    file.syncSync()
  } finally {
    file.close()
  }
}

export let files = (dir: string): {
  append: (line: string) => void
  source: Source
} => ({
  append: (line) => {
    Deno.mkdirSync(dir, { recursive: true, mode: 0o700 })
    let name = `${dir}/${Date.now()}-${crypto.randomUUID()}`
    let file = Deno.openSync(`${name}.jsonl`, {
      write: true,
      createNew: true,
      mode: 0o600,
    })
    try {
      let bytes = new TextEncoder().encode(line)
      let at = 0
      while (at < bytes.length) at += file.writeSync(bytes.subarray(at))
      file.syncSync()
    } finally {
      file.close()
    }
    sync(dir)
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
      let text = await Deno.readTextFile(path)
      // A writer may still be filling this segment. Neither a partial tail
      // nor a crash before its newline can hold later complete records back.
      if (!text.endsWith('\n')) continue
      let rows: Bundle[] = text.trimEnd().split('\n').flatMap((line) =>
        JSON.parse(line)
      )
      yield {
        rows,
        ack: async () => {
          await Deno.remove(path)
          sync(dir)
        },
      }
    }
  },
})
