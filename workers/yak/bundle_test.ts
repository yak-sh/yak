// The kernel's modules load in the Worker: every `node:` module a chunk
// imports is one the runtime provides under wrangler.toml's compatibility_date
// and flags. At 2025-05-08 with nodejs_compat, workerd 1.20261104 has no
// node:fs, node:os or node:child_process (node:fs/promises it has). A door
// whose chunk imports one fails each time it is opened, after a deploy that
// uploaded fine.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { build, stop } from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { options } from './bundle.ts'

let ABSENT = new Set(['node:fs', 'node:os', 'node:child_process'])

// Opened only with a `cwd` (@yaks/mcp/skills), which a box passes and the
// Worker never does.
let HOST = new Set(['../../packages/mcp/skills-host.ts'])

test('every door the kernel opens imports only node modules the Worker has', async () => {
  let root = dirname(fileURLToPath(import.meta.url))
  try {
    let { metafile } = await build({
      ...options(root),
      outdir: join(root, '.modules-test'),
      write: false,
      minify: false,
      sourcemap: false,
    })
    let failing: Record<string, string[]> = {}
    for (let [file, chunk] of Object.entries(metafile!.outputs)) {
      if (chunk.entryPoint && HOST.has(chunk.entryPoint)) continue
      let absent = [...new Set(chunk.imports.map((i) => i.path))]
        .filter((path) => ABSENT.has(path))
      if (!absent.length) continue
      let from = Object.keys(chunk.inputs).filter((input) =>
        metafile!.inputs[input]?.imports.some((i) => ABSENT.has(i.path))
      )
      failing[chunk.entryPoint ?? file] = [...absent, ...from]
    }
    assertEquals(failing, {})
  } finally {
    await stop()
  }
})
