// Run the emitted Builder's first Updates read in a fresh Deno process.
// The module hook records the chunks the read opens, including dynamic imports.
import '../workers/yak/runtime-resolve.ts'
import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { durable } from '../packages/durable-object/testing.ts'

type Chunk = { file: string; bytes: number }

let measure = async (output: string) => {
  let files = new Set<string>()
  let root = pathToFileURL(resolve(output) + '/')
  let hooks = registerHooks({
    load(url, context, next) {
      if (url.startsWith(root.href)) files.add(url.slice(root.href.length))
      return next(url, context)
    },
  })
  using storage = durable()
  let space = crypto.randomUUID()
  let request = new Request('https://builder/operator/updates', {
    method: 'POST',
    headers: {
      'x-yak-person': crypto.randomUUID(),
      'x-space-eid': space,
      'x-yak-role': 'owner',
      'x-yak-seat': encodeURIComponent(JSON.stringify({
        eid: space,
        slug: 'checks',
        operator: 'Operator',
      })),
    },
    body: '{}',
  })
  let start = performance.now()
  try {
    let { Builder } = await import(new URL('index.js', root).href)
    let state = { storage, id: { name: space }, getWebSockets: () => [] }
    let response: Response = await new Builder(state, {}).fetch(request)
    let answer = await response.json()
    if (!response.ok || !Array.isArray(answer.updates)) {
      throw new Error(`Builder Updates read failed (${response.status})`)
    }
    return { files: [...files], readMs: Math.round(performance.now() - start) }
  } finally {
    hooks.deregister()
  }
}

let load = async (output: string, files: string[]) => {
  let root = pathToFileURL(resolve(output) + '/')
  let start = performance.now()
  for (let file of files) await import(new URL(file, root).href)
  return { loadMs: Math.round(performance.now() - start) }
}

if (import.meta.main) {
  let [output, manifest, replay] = Deno.args
  if (replay == '--load') {
    let { files } = JSON.parse(await Deno.readTextFile(manifest))
    console.log(JSON.stringify(await load(output, files)))
  } else {
    let chunks: Chunk[] = JSON.parse(await Deno.readTextFile(manifest))
    let { files, readMs } = await measure(output)
    let reached = new Set(files)
    let bytes = chunks.filter((c) => reached.has(c.file))
      .reduce((n, c) => n + c.bytes, 0)
    console.log(JSON.stringify({ chunks: files.length, bytes, readMs, files }))
  }
}
