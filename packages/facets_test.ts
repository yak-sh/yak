// One check over the packages as a set: a plugin is a package whose `exports`
// map names one subpath per facet it has, and a host takes each facet from its
// own subpath (@yaks/cli `compose`). Nothing a compiler sees says the set is
// consistent — that every package with words exports them, that every subpath
// resolves, that what comes back is shaped the way a host reads it. This does.
//
// The browser half of the same statement is `deno task check:browser`, which
// type-checks `./vocab` and `./views` of every package with only the web
// platform in scope: the web door (T-37583) imports those two of every package
// and must reach no storage, no SQL and no runtime through either. That check
// is what "fits neatly" means, and it is a gate rather than a test because a
// second TypeScript program is the only thing that can prove it.

import { assert, assertEquals } from '@std/assert'
import { compose, FACETS } from '@yaks/cli/host'
import { type Keywords, loadVocab, type VocabDoc } from '@yaks/vocab'
import { idKeywords } from '@yaks/id'
import { nameKeywords } from '@yaks/names'

let here = new URL('./', import.meta.url)

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
    // @yaks/render's document describes a property schema rather than a
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

Deno.test("every package's words load beside every other package's", async () => {
  // A word has one home (packages/README.md). `bin/transition_test.ts` says
  // that of the `vocab.json` files; this says it of the facet a host actually
  // imports, which is where a package can still fold another's words into its
  // own document and make the two uncomposable.
  let home = new Map<string, string>()
  // An `extends: true` entry adds properties to somebody else's word rather
  // than saying one: @yaks/id keeps the number on @yaks/kernel's `entity` row.
  // It owns no word, so it is checked against the homes instead of taking one.
  let added: [string, string][] = []
  let docs: VocabDoc[] = []
  let keywords: Keywords[] = []
  for (let p of packages) {
    if (!has(p, 'vocab')) continue
    let mod = await import(file(p, 'vocab').href) as {
      docs?: VocabDoc[]
      keywords?: Keywords[]
    }
    for (let doc of mod.docs ?? []) {
      for (let [word, said] of Object.entries(doc.$defs ?? {})) {
        if (said?.extends === true) {
          added.push([word, p.name])
          continue
        }
        let held = home.get(word)
        assert(!held, `'${word}' is ${held}'s word and ${p.name} says it too`)
        home.set(word, p.name)
      }
      docs.push(doc)
    }
    keywords.push(...(mod.keywords ?? []))
  }
  for (let [word, pkg] of added) {
    assert(home.has(word), `${pkg} extends '${word}', which no package says`)
  }
  assert(home.size > 60, `only ${home.size} words walked`)
  // And they load as one vocabulary — the host's own keywords registered, since
  // a `prefix` or a `by_name` nobody reads is silently dropped (@yaks/cli
  // `understood`).
  let vocab = loadVocab(docs, [...keywords, idKeywords, nameKeywords])
  assert(vocab.all.includes('task'), 'no task')
  assert(vocab.all.includes('session'), 'no session')
})

Deno.test('every other facet a package exports is shaped the way a host reads it', async () => {
  // What each facet's module has to say. `routes` has three, because it says
  // three things: the HTTP a plugin adds, who is calling, and — for the one
  // plugin in a host that hosts them — what answers a request at all
  // (@yaks/api). A module with any of them is that facet.
  let shapes: Record<string, string[]> = {
    rules: ['rules'],
    tools: ['runs'],
    effects: ['effects'],
    routes: ['routes', 'authenticate', 'handler'],
    service: ['service'],
    views: ['views'],
  }
  let seen = new Set<string>()
  for (let p of packages) {
    // Words are not what makes a plugin: `@yaks/embedding` composes as one
    // whose whole job is the vector table and the `.near` compiler, and
    // declares no component at all — the only word in its vocabulary is its
    // check. So every package's facets are walked. The one exemption is
    // `./tools` on a package with no words:
    // the core's `@yaks/vocab/tools` is the tool mechanism under that name and
    // predates the facets, and nobody composes it as a plugin. (`@yaks/graph`
    // has words now — the generic tier — so its `./tools` carries the runs
    // behind them like any other.) See packages/README.md, the misfit list.
    let words = true
    try {
      Deno.statSync(new URL(`${p.dir}/vocab.json`, here))
    } catch {
      words = false
    }
    for (let [facet, names] of Object.entries(shapes)) {
      if (!has(p, facet) || (facet == 'tools' && !words)) continue
      let mod = await import(file(p, facet).href) as Record<string, unknown>
      assert(
        names.some((name) => name in mod),
        `${p.name}/${facet} exports no \`${names.join('` or `')}\``,
      )
      seen.add(facet)
    }
    if (!words) continue
    // A subpath outside the facet list is a package's own business, but a
    // facet name must mean the facet: nothing may export `./rules` meaning
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
    'service',
    'tools',
    'views',
  ])
})

Deno.test('compose takes every facet of the plugins a config names', async () => {
  // The harness beside the words it runs over: a config naming packages, read
  // the way `yak serve` reads it.
  let plugins = [
    '@yaks/kernel',
    '@yaks/id',
    '@yaks/edge',
    '@yaks/doc',
    '@yaks/task',
    '@yaks/session',
    '@yaks/harness',
  ]
  let host = await compose({ db: ':memory:', plugins, numbers: false })
  try {
    // Every facet arrived: the words, a computed property only ./vocab
    // declares, the rules, and a tool only ./tools implements.
    assert(host.vocab.all.includes('session'), host.vocab.all.join(' '))
    assert(host.vocab.all.includes('task'), host.vocab.all.join(' '))
    assert(host.tools.length > 0, 'no tools')
    let applied = await host.graph.apply([
      { entity: { eid: 'facet-one' }, session: { id: 'one' } },
    ])
    assertEquals(applied.length, 1)
    let found = await host.graph.read('.session')
    // A derived property only ./vocab declares, answered by the store.
    assertEquals((found[0].session as { status?: string }).status, 'empty')
  } finally {
    host.close()
  }
})
