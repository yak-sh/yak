import { assertEquals } from '@std/assert'
import { mapFor, shellFor } from './bundle.ts'

let roots = { src: '/r/src/', repo: '/r/' }

Deno.test('the shell import map resolves packages to the repo and the rest to src', () => {
  assertEquals(
    mapFor({
      '@yaks/query': '/packages/query/mod.ts',
      preact: '/vendor/preact.module.js',
    }, roots),
    {
      '@yaks/query': '/r/packages/query/mod.ts',
      preact: '/r/src/vendor/preact.module.js',
    },
  )
})

Deno.test('the shell points its entry script at the bundle and nothing else', () => {
  let html = '<script type="importmap">{}</script>\n' +
    '<script type="module" src="/main.tsx"></script>'
  assertEquals(
    shellFor(html, '/main.tsx', '/main.bundle.js'),
    '<script type="importmap">{}</script>\n' +
      '<script type="module" src="/main.bundle.js"></script>',
  )
  assertEquals(shellFor(html, '/other.tsx', '/x.js'), html)
})
