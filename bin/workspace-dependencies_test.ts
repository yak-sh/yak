import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { imports } from './workspace-dependencies.ts'

let dir = Deno.makeTempDirSync({ prefix: 'workspace-imports-' })
let root = new URL(`file://${dir}/`)
let write = (path: string, value: unknown) => {
  let url = new URL(path, root)
  Deno.mkdirSync(new URL('./', url), { recursive: true })
  Deno.writeTextFileSync(url, JSON.stringify(value))
}
write('package.json', { workspaces: ['packages/*', 'worker'] })
write('packages/file/package.json', {
  name: '@test/file',
  exports: { '.': './mod.ts', './io': './io.ts' },
})
write('packages/process/package.json', {
  name: '@test/process',
  exports: { './command': './command.ts' },
})
write('worker/package.json', { name: '@test/worker', exports: './main.ts' })
Deno.mkdirSync(new URL('packages/notes/', root))

test('bootstrap resolves every workspace member through its declared exports', () => {
  try {
    assertEquals(imports(root), {
      '@test/file': new URL('packages/file/mod.ts', root).href,
      '@test/file/io': new URL('packages/file/io.ts', root).href,
      '@test/process/command':
        new URL('packages/process/command.ts', root).href,
      '@test/worker': new URL('worker/main.ts', root).href,
    })
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})
