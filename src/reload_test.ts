// The handoff boundary is a path predicate: server imports restart the process,
// while browser modules stay inside the existing hot-swap loop. serverFile is
// WALKED from server.ts (reload.ts), so the teeth here are an INDEPENDENT walk:
// this file finds server.ts's imports with its own regex and asserts the
// predicate covers every one — it fails the moment a real server import is not
// recognized, the class a sampled list could never catch. (The old test named
// this claim but sampled eight paths that all happened to be present, which is
// how eight modules went missing beneath a green suite.)
import { assert, assertEquals } from '@std/assert'
import { devFile, serverClassifier, serverFile } from './reload.ts'

// A second, independent copy of the walk — the oracle. If reload.ts's graph()
// ever under-walks, this still finds the module and the assert below fails.
let specifiers = /\bimport\b(\s+type\b)?(?:[^'"]*?\bfrom\s*)?(["'])([^"']+)\2/g
let isRelative = (s: string) => s.startsWith('./') || s.startsWith('../')

let walk = async (entry: string, root: URL): Promise<Set<string>> => {
  let queue = [new URL(entry, root)]
  let seen = new Set<string>()
  let paths = new Set<string>([new URL(entry, root).pathname])
  while (queue.length) {
    let file = queue.shift()!
    if (seen.has(file.href)) continue
    seen.add(file.href)
    let source = await Deno.readTextFile(file)
    for (let match of source.matchAll(specifiers)) {
      if (match[1]) continue // import type … — erased by sucrase
      let spec = match[3]
      if (!isRelative(spec)) continue
      let child = new URL(spec, file)
      child.search = ''
      if (!child.href.startsWith(root.href)) continue
      if (!/\.[jt]sx?$/.test(child.pathname)) continue
      paths.add(child.pathname)
      queue.push(child)
    }
  }
  return paths
}

Deno.test('serverFile: covers every module server.ts imports', async () => {
  let root = new URL('.', import.meta.url)
  let reached = await walk('server.ts', root)
  assert(reached.size > 40, `walk found only ${reached.size} modules`)
  for (let path of reached) {
    assert(serverFile(path), `not a server file: ${path}`)
  }
})

// serverFile matches a path SUFFIX, not a substring: a browser module and a
// `.old` sibling of a server file are both outside the graph.
Deno.test('serverFile: matches on path suffix, so browser and .old files are out', () => {
  for (
    let [path, want] of [
      ['/repo/src/server.ts', true],
      ['/repo/src/reload.ts', true],
      ['/repo/src/components/Card.tsx', false],
      ['/repo/src/styles.css', false],
      ['/repo/src/server.ts.old', false],
    ] as [string, boolean][]
  ) assertEquals(serverFile(path), want, path)
})

Deno.test('serverFile: sees imports added after the classifier was made', () => {
  let dir = Deno.makeTempDirSync({ prefix: 'tasks-reload-' })
  let root = new URL(`file://${dir}/`)
  try {
    Deno.writeTextFileSync(
      `${dir}/server.ts`,
      "import { first } from './first.ts'\nvoid first\n",
    )
    Deno.writeTextFileSync(`${dir}/first.ts`, 'export let first = 1\n')
    let classify = serverClassifier('server.ts', root)
    assertEquals(classify(`${dir}/later.ts`), false)

    Deno.writeTextFileSync(
      `${dir}/server.ts`,
      "import { first } from './first.ts'\n" +
        "import { later } from './later.ts'\nvoid first\nvoid later\n",
    )
    Deno.writeTextFileSync(`${dir}/later.ts`, 'export let later = 1\n')
    assertEquals(classify(`${dir}/later.ts`), true)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

// The supervisor's graph is small enough to keep by hand, so its completeness
// is guarded the cheap way: whatever dev.ts imports IS its source, and devFiles
// must name all of it or a landed supervisor change never asks for a relaunch.
Deno.test('devFile: covers everything the supervisor imports', async () => {
  let dev = await Deno.readTextFile(new URL('./dev.ts', import.meta.url))
  let imports = [...dev.matchAll(/from '\.\/([\w.]+)'/g)].map((m) => m[1])
  assertEquals(imports.length > 0, true) // the regex still finds them
  for (let name of [...imports, 'dev.ts']) {
    assertEquals(devFile(`/repo/src/${name}`), true, name)
  }
  assertEquals(devFile('/repo/src/server.ts'), false)
})
