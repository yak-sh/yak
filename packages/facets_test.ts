// One check over the packages as a SET: a plugin is a package whose `exports`
// map names one subpath per FACET it has, and a host takes each facet from its
// own subpath (@yaks/cli `compose`). Nothing a compiler sees says the set is
// consistent — that every package with words exports them, that every subpath
// resolves, that what comes back is shaped the way a host reads it. This does.
//
// The browser half of the same statement is `deno task check:browser`, which
// type-checks `./vocab` and `./views` of every package with only the web
// platform in scope: the web door (T-37583) imports those two of every package
// and must reach no storage, no SQL and no runtime through either. That check
// is what "fits neatly" MEANS, and it is a gate rather than a test because a
// second TypeScript program is the only thing that can prove it.

import { assert, assertEquals } from '@std/assert'
import { compose, FACETS } from '@yaks/cli/serve'
import type { VocabDoc } from '@yaks/vocab'

let here = new URL('./', import.meta.url)
let root = new URL('../', here)

type Pkg = { name: string; dir: string; exports: Record<string, string> }

// The walk: every workspace package, with its exports map normalized to the
// object form so a single-export package and a faceted one read alike.
let packages: Pkg[] = []
for (let e of Deno.readDirSync(here)) {
  if (!e.isDirectory) continue
  let text: string
  try {
    text = Deno.readTextFileSync(new URL(`${e.name}/deno.json`, here))
  } catch {
    continue
  }
  let json = JSON.parse(text) as { name: string; exports: unknown }
  let exports = typeof json.exports == 'string'
    ? { '.': json.exports }
    : json.exports as Record<string, string>
  packages.push({ name: json.name, dir: e.name, exports })
}

let has = (p: Pkg, facet: string) => `./${facet}` in p.exports
let file = (p: Pkg, facet: string) =>
  new URL(`${p.dir}/${p.exports[`./${facet}`].slice(2)}`, here)

Deno.test('a package with words exports them at ./vocab, and they load', async () => {
  let said: string[] = []
  for (let p of packages) {
    let words = false
    try {
      Deno.statSync(new URL(`${p.dir}/vocab.json`, here))
      words = true
    } catch { /* no vocabulary to export */ }
    // @yaks/render's document describes a COLUMN schema rather than a
    // component domain; it is the one vocab.json no host composes.
    if (!words || p.dir == 'render') continue
    assert(has(p, 'vocab'), `${p.name} has vocab.json and no ./vocab export`)
    let mod = await import(file(p, 'vocab').href) as { docs?: VocabDoc[] }
    assert(Array.isArray(mod.docs), `${p.name}/vocab exports no docs array`)
    assert(mod.docs.length > 0, `${p.name}/vocab declares nothing`)
    for (let doc of mod.docs) {
      assert(!!doc.$defs, `${p.name}: a doc with no $defs`)
    }
    said.push(p.name)
  }
  // The set is not empty, and it is the domain packages, not a stray one.
  assert(said.length > 25, said.join(' '))
  assert(said.includes('@yaks/task'), said.join(' '))
  assert(said.includes('@yaks/tmux'), said.join(' '))
})

Deno.test('every other facet a package exports is shaped the way a host reads it', async () => {
  let shapes: Record<string, string> = {
    rules: 'rules',
    tools: 'runs',
    effects: 'effects',
    routes: 'routes',
    views: 'views',
  }
  let seen = new Set<string>()
  for (let p of packages) {
    // Words are not what makes a plugin: `@yaks/embedding` composes as one —
    // the vector table and the `.near` compiler — and declares no vocabulary,
    // because a vector is not a word anybody writes. So every package's facets
    // are walked. The one exemption is `./tools` on a package with no words:
    // the core's `@yaks/graph/tools` and `@yaks/vocab/tools` are the tool
    // MECHANISM under that name and predate the facets, and nobody composes
    // either as a plugin. See packages/README.md, the misfit list.
    let words = true
    try {
      Deno.statSync(new URL(`${p.dir}/vocab.json`, here))
    } catch {
      words = false
    }
    for (let [facet, name] of Object.entries(shapes)) {
      if (!has(p, facet) || (facet == 'tools' && !words)) continue
      let mod = await import(file(p, facet).href) as Record<string, unknown>
      assert(name in mod, `${p.name}/${facet} exports no \`${name}\``)
      seen.add(facet)
    }
    // A subpath outside the facet list is a package's own business, but a
    // facet NAME must mean the facet: nothing may export `./rules` meaning
    // something else.
    for (let key of Object.keys(p.exports)) {
      let facet = key.slice(2)
      if (key != '.' && FACETS.includes(facet as 'vocab')) {
        assert(facet in shapes || facet == 'vocab', `${p.name}: ${key}`)
      }
    }
  }
  assertEquals([...seen].sort(), [
    'effects',
    'routes',
    'rules',
    'tools',
    'views',
  ])
})

Deno.test('compose takes every facet of the plugins a config names', async () => {
  // The fleet's own config when the transition has written one, and the
  // harness otherwise — either way a config file naming packages, read the way
  // `yak serve` reads it.
  let path = new URL('etc/yak.json', root)
  let plugins: string[]
  try {
    plugins = JSON.parse(Deno.readTextFileSync(path)).plugins as string[]
  } catch {
    plugins = ['@yaks/harness']
  }
  let host = await compose({ db: ':memory:', plugins, numbers: false })
  try {
    // Every facet arrived: the words, a computed column only ./vocab declares,
    // the rules, and a tool only ./tools implements.
    assert(host.vocab.all.includes('session'), host.vocab.all.join(' '))
    assert(host.vocab.all.includes('task'), host.vocab.all.join(' '))
    assert(host.tools.length > 0, 'no tools')
    let applied = await host.graph.apply([
      { entity: { eid: 'facet-one' }, session: { id: 'one' } },
    ])
    assertEquals(applied.length, 1)
    let found = await host.graph.read('.session')
    // A derived column only ./vocab declares, answered by the store.
    assertEquals((found[0].session as { status?: string }).status, 'empty')
  } finally {
    host.close()
  }
})
