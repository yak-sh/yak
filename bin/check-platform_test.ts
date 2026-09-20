import { assertEquals, assertThrows } from '@std/assert'
import { type Config, mergeConfigs, platformConfig } from './check-platform.ts'

let config = (imports = {}, lib = ['dom', 'esnext']): Config => ({
  compilerOptions: { lib, strict: true },
  imports,
})
let a = new URL('file:///repo/packages/a/browser.json')
let b = new URL('file:///repo/packages/b/browser.json')

Deno.test('platform maps resolve at their own config, then share one program', () => {
  assertEquals(
    mergeConfigs([
      { url: a, config: config({ '@yaks/a': './mod.ts' }) },
      {
        url: b,
        config: config({
          '@yaks/a': '../a/mod.ts',
          external: 'jsr:@example/package@1',
        }, ['dom', 'dom.asynciterable', 'esnext']),
      },
    ]),
    {
      compilerOptions: {
        strict: true,
        lib: ['dom', 'dom.asynciterable', 'esnext'],
      },
      imports: {
        '@yaks/a': 'file:///repo/packages/a/mod.ts',
        external: 'jsr:@example/package@1',
      },
    },
  )
})

Deno.test('platform merging refuses conflicts, hidden options and runtime libs', () => {
  assertThrows(() => mergeConfigs([]), Error, 'No platform configs')
  assertThrows(
    () =>
      mergeConfigs([
        { url: a, config: config({ x: './mod.ts' }) },
        { url: b, config: config({ x: './mod.ts' }) },
      ]),
    Error,
    'conflicting platform import x',
  )
  assertThrows(
    () =>
      mergeConfigs([
        { url: a, config: config() },
        {
          url: b,
          config: { compilerOptions: { lib: ['dom'], strict: false } },
        },
      ]),
    Error,
    'incompatible platform compiler options',
  )
  assertThrows(
    () =>
      mergeConfigs([
        { url: a, config: { ...config(), scopes: {} } },
      ]),
    Error,
    'unsupported platform config field scopes',
  )
  assertThrows(
    () =>
      mergeConfigs([
        { url: a, config: config({}, ['deno.ns']) },
      ]),
    Error,
    'non-web platform lib deno.ns',
  )
})

Deno.test('platform entrypoints cover every standalone config and the tail Worker', async () => {
  let root = new URL('../', import.meta.url)
  for (let platform of ['browser', 'workers']) {
    let { config, entries } = await platformConfig(root, platform)
    let expected: string[] = []
    for (let parent of ['packages', 'workers']) {
      for await (let dir of Deno.readDir(new URL(`${parent}/`, root))) {
        if (!dir.isDirectory) continue
        let base = new URL(`${parent}/${dir.name}/`, root)
        let files = [...Deno.readDirSync(base)].map((file) => file.name)
        if (!files.includes(`${platform}.json`)) continue
        if (platform !== 'browser') {
          expected.push(new URL('conform.ts', base).href)
          continue
        }
        // The browser program checks a package's browser-facing EXPORTS: what
        // its browser.json names (default `.`), plus `./vocab` and `./views`
        // whenever the package exports them — the web door imports those two
        // of every package and must reach nothing server-side through either.
        let said = JSON.parse(
          Deno.readTextFileSync(new URL('browser.json', base)),
        ).entries as string[] | undefined
        let exports = JSON.parse(
          Deno.readTextFileSync(new URL('deno.json', base)),
        ).exports as string | Record<string, string>
        let map = typeof exports === 'string' ? { '.': exports } : exports
        for (let key of new Set([...(said ?? ['.']), './vocab', './views'])) {
          if (key in map) expected.push(new URL(map[key], base).href)
        }
      }
    }
    if (platform === 'workers') {
      expected.push(new URL('workers/yak-tail/conform.ts', root).href)
    }
    assertEquals(entries, expected.sort())
    for (let entry of entries) await Deno.stat(new URL(entry))
    assertEquals(config.compilerOptions.strict, true)
    assertEquals(config.compilerOptions.lib.includes('deno.ns'), false)
    if (platform === 'browser') {
      assertEquals(config.imports?.['@cloudflare/workers-types'], undefined)
    }
  }
})
