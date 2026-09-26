#!/usr/bin/env -S deno run --allow-read --allow-write=apps/yak-sh-v2 --allow-net=api.jsr.io
// bin/package-map — the @yaks packages, which of the others each one imports,
// read from the workspace, and the version jsr.io holds of each, for the map
// yak.sh draws (apps/yak-sh-v2/packages.json).
//
//   deno run --allow-read --allow-write=apps/yak-sh-v2 --allow-net=api.jsr.io \
//     bin/package-map.ts
//
// An import is a `from '@yaks/<name>…'` or an `import('@yaks/<name>…')` in a
// package's own source. Its tests, benchmarks and test helpers are not what it
// depends on, so they are not read.

import { API } from './jsr.ts'
import { configs } from './release.ts'

let SOURCE = /\.(ts|tsx|js|mjs)$/
let ASIDE = /(_test|_bench)\.(ts|tsx|js)$|\/testing\.ts$|\/node_modules\//

// A comment's example imports are not the file's: `* import { mint } from
// '@yaks/graph'` in a doc comment names a package the file never loads.
let COMMENT = /\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm

/// imported("import { a } from '@yaks/graph'\nexport * from '@yaks/vocab/tools'") -> ['graph', 'vocab']
/// imported("let m = await import('@yaks/tui/print')") -> ['tui']
/// imported("/** import { mint } from '@yaks/graph' */\nimport { x } from './graph.ts'") -> []
export let imported = (source: string): string[] => [
  ...new Set(
    [
      ...source.replace(COMMENT, '')
        .matchAll(/(?:from|import\()\s*['"]@yaks\/([a-z0-9-]+)/g),
    ].map((m) => m[1]),
  ),
]

let files = async function* (dir: string): AsyncGenerator<string> {
  for await (let e of Deno.readDir(dir)) {
    let path = `${dir}/${e.name}`
    if (e.isDirectory && e.name != 'node_modules') yield* files(path)
    else if (e.isFile && SOURCE.test(path) && !ASIDE.test(path)) yield path
  }
}

/** One package: its name without the scope, what its deno.json says it is,
 * the newest version on jsr.io (null where JSR has none), and the other
 * packages it imports. */
export type Package = {
  name: string
  description: string
  jsr: string | null
  imports: string[]
}

// The newest version jsr.io holds of `@yaks/<name>`, or null when it holds
// none. Only a 404 says that: any other failure is jsr.io's, and is thrown
// rather than drawn as a package that was never published.
let latest = async (
  name: string,
  get: typeof fetch,
): Promise<string | null> => {
  let res = await get(`${API}/scopes/yaks/packages/${name}`)
  if (res.status == 404) return (await res.body?.cancel(), null)
  if (!res.ok) {
    throw new Error(`jsr.io @yaks/${name}: ${res.status} ${await res.text()}`)
  }
  return (await res.json()).latestVersion ?? null
}

/** Every @yaks package in the workspace under `root`, with what it imports
 * and what JSR holds of it. */
export let packages = async (
  root = '.',
  get: typeof fetch = fetch,
): Promise<Package[]> => {
  let out: Package[] = []
  for (let path of await configs(root)) {
    let config = JSON.parse(await Deno.readTextFile(path))
    let name = String(config.name ?? '')
    if (!name.startsWith('@yaks/')) continue
    let short = name.slice('@yaks/'.length)
    let said = new Set<string>()
    for await (let file of files(path.replace(/\/deno\.json$/, ''))) {
      for (let dep of imported(await Deno.readTextFile(file))) said.add(dep)
    }
    said.delete(short)
    out.push({
      name: short,
      description: String(config.description ?? ''),
      jsr: await latest(short, get),
      imports: [...said].sort(),
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

if (import.meta.main) {
  let map = await packages()
  await Deno.writeTextFile(
    'apps/yak-sh-v2/packages.json',
    JSON.stringify(map, null, 2) + '\n',
  )
  console.log(`${map.length} packages`)
}
