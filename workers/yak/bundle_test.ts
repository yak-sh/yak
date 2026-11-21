// The kernel's modules load in the Worker: no chunk imports a node module
// the runtime lacks (bundle.ts `lacking`).
import { cleanup, test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { build, stop } from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lacking, options } from './bundle.ts'

cleanup(stop)

test('every door the kernel opens imports only node modules the Worker has', async () => {
  let root = dirname(fileURLToPath(import.meta.url))
  let { metafile } = await build({
    ...options(root),
    outdir: join(root, '.modules-test'),
    write: false,
    minify: false,
    sourcemap: false,
  })
  // esbuild reads the sources itself, where the runner cannot see, so a
  // pass would be kept while a door's imports change under it (bug
  // 520c372f). Each input is read here, through Deno, so it is one this
  // test depends on (@yaks/testing's observed reads).
  for (let input of Object.keys(metafile!.inputs)) {
    if (!input.includes(':')) Deno.statSync(join(root, input))
  }
  assertEquals(lacking(metafile!), {})
})

// A bundled module's import.meta.url is no address a relative URL resolves
// against, as a blob: URL's is not, so a module that resolves one when it
// loads throws "Invalid URL string." in the Worker. @yaks/ui's root carries
// every theme, skin and kit, and each names its stylesheets lazily.
test("@yaks/ui's root loads in the Worker's bundle", async () => {
  let root = dirname(fileURLToPath(import.meta.url))
  let { outputFiles } = await build({
    ...options(root),
    entryPoints: undefined,
    stdin: {
      contents: "export * from '@yaks/ui'",
      resolveDir: root,
      loader: 'ts',
    },
    splitting: false,
    write: false,
    minify: false,
    sourcemap: false,
  })
  let code = outputFiles![0].text
  let at = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  try {
    let ui = await import(at)
    assertEquals(typeof ui.themes.linen.css, 'function')
  } finally {
    URL.revokeObjectURL(at)
  }
})
