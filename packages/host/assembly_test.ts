/** Portable assembly binds the same facets over storage with no box resources. */
import { memoryBlobs } from '@yaks/blob'
import { effects } from '@yaks/effects'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { ramVault } from '@yaks/secrets'
import { equal, test, throws } from '@yaks/testing'
import type { VocabDoc } from '@yaks/vocab'
import { toolEid } from '@yaks/tools'
import { assembly, type Binding } from './assembly.ts'
import type { Config } from './config.ts'
import type { Facets, Load } from './facets.ts'

let facets: Partial<Facets> = {
  vocab: {
    docs: [{
      $defs: {
        book: {
          component: true,
          type: 'object',
          properties: { title: { type: 'string' } },
        },
        book_list: {
          tool: true,
          description: 'List books',
          input: {},
          readOnly: true,
        },
      },
    }],
  },
  graph: {
    plugins: () => [{
      name: 'punctuation',
      hooks: {
        normalize: (bundles) =>
          bundles.map((b) =>
            b.book ? { ...b, book: { title: `${(b.book as Comp).title}!` } } : b
          ),
      },
    }],
  },
  tools: { runs: () => ({ book_list: (_, g) => g.read('.book') }) },
}
let loading = (imported: string[]): Load => (_, name) => {
  imported.push(name)
  return Promise.resolve(facets[name] ?? null)
}
let blobs = memoryBlobs()
let vault = ramVault()
let stopping = new AbortController().signal
let binding = (): Binding => ({
  host: {
    me: 'host',
    vault,
    blobs,
    artifacts: blobs,
    stopping,
    duties: () => Promise.resolve(),
    end: () => Promise.resolve(),
    bury: () => Promise.resolve([]),
    gone: () => Promise.resolve(false),
  },
  storage: (host) => ram(host.vocab),
  effects: (host, disabled) =>
    effects(host.vocab, {
      disabled,
      owes: host.roles.includes('effects') ? 'handled' : 'declared',
      write: (bundles) => host.graph.apply(bundles),
    }),
})
let config = { plugins: ['library'] }
// Warm the shared vocabulary independently of the behavior being measured.
await assembly(config, ['graph'], loading([]))

test('portable assembly imports only the facets of its served roles', async () => {
  let imported: string[] = []
  await assembly(config, ['graph'], loading(imported))
  equal(imported, ['vocab', 'graph'])
})

let toolImports: string[] = []
let lazy =
  (await assembly(config, ['graph'], loading(toolImports))).bind(binding()).host
await lazy.graph.apply([{ entity: { eid: 'b' }, book: { title: 'Dune' } }])
test('portable assembly loads tool code once on its first call', async () => {
  equal(toolImports, ['vocab', 'graph'])
  let asked: Bundle = {
    entity: { eid: 'ask' },
    call: { to: toolEid('book_list'), args: {} },
  }
  equal((await lazy.runner.read(asked))[0].book, { title: 'Dune!' })
  equal(toolImports, ['vocab', 'graph', 'tools'])
  await lazy.runner.read(asked)
  equal(toolImports, ['vocab', 'graph', 'tools'])
})

test('portable assembly lets its host surround contributed graph hooks', async () => {
  let plan = await assembly(config, ['graph'], loading([]))
  let { host } = plan.bind({
    ...binding(),
    graph: (options) =>
      graph({
        ...options,
        plugins: [{
          name: 'uppercase',
          hooks: {
            normalize: (bundles) =>
              bundles.map((b) =>
                b.book
                  ? {
                    ...b,
                    book: {
                      title: String((b.book as Comp).title).toUpperCase(),
                    },
                  }
                  : b
              ),
          },
        }, ...options.plugins ?? []],
      }),
  })
  await host.graph.apply([{ entity: { eid: 'b' }, book: { title: 'Dune' } }])
  equal((await host.graph.get(['b']))[0].book, { title: 'DUNE!' })
})

let selectedConfig = { plugins: [{ use: 'library', words: ['book'] }] }
let selectedPlan = await assembly(selectedConfig, ['graph'], loading([]))
let selectedHost = selectedPlan.bind(binding()).host
test('chosen words admit writes and omit unselected tools from declarations and bindings', async () => {
  let host = selectedHost
  await host.graph.apply([{ entity: { eid: 'b' }, book: { title: 'Dune' } }])
  equal((await host.graph.get(['b']))[0].book, { title: 'Dune!' })
  equal(selectedPlan.words.tools().some((t) => t.name == 'book_list'), false)
  equal(host.tools.some((t) => t.name == 'book_list'), false)
  // The same imported facet may be used again with a different selection.
  equal(
    (await assembly(config, ['graph'], loading([]))).words.tools().some((t) =>
      t.name == 'book_list'
    ),
    true,
  )
})

let own: VocabDoc[] = [{
  package: 'catalogue',
  $defs: {
    book: {
      component: true,
      properties: { author: { type: 'string' } },
    },
    shelf: { component: true, properties: { number: { type: 'integer' } } },
  },
}]
let plain: Load = (_, name) =>
  Promise.resolve(name == 'vocab' ? facets.vocab! : null)
let owned = await assembly(config, ['graph'], plain, { docs: own })
let ownedHost = owned.bind(binding()).host
let otherHost = (await assembly(config, ['graph'], plain)).bind(binding()).host
test('graph-owned words replace plugin components and admit their own properties', async () => {
  let host = ownedHost
  await host.graph.apply([{
    entity: { eid: 'b' },
    book: { author: 'Herbert' },
    shelf: { number: 2 },
  }])
  equal((await host.graph.get(['b']))[0].book, { author: 'Herbert' })
  await throws(() =>
    host.graph.apply([{
      entity: { eid: 'b' },
      book: { title: 'Dune' },
    }]), 'title')
  // Sharing facets must not leak a graph's own definition into another graph.
  let other = otherHost
  await other.graph.apply([{ entity: { eid: 'b' }, book: { title: 'Dune' } }])
  equal((await other.graph.get(['b']))[0].book, { title: 'Dune' })
})

test('a graph-owned shadow cannot conceal duplicate plugin declarations', async () => {
  await throws(() =>
    assembly({ plugins: ['one', 'two'] }, ['graph'], plain, {
      docs: own,
    }), "component 'book' is declared twice")
})

test('a chosen word must be declared by that plugin', async () => {
  await throws(() =>
    assembly(
      {
        plugins: [{ use: 'library', words: ['bok'] }],
      },
      ['graph'],
      plain,
    ), "library declares no word 'bok'")
})

let seen: string[] = []
let watched: Partial<Facets> = {
  vocab: {
    docs: [{
      $defs: {
        book: facets.vocab!.docs![0].$defs!.book,
        book_seen: { effect: true, created: ['book'] },
        book_sent: { effect: true, created: ['book'] },
      },
    }],
  },
  effects: {
    effects: () => ({
      book_seen: () => void seen.push('seen'),
      book_sent: () => void seen.push('sent'),
    }),
  },
}
let watch: Load = (_, name) => Promise.resolve(watched[name] ?? null)
let watchPlan = await assembly(
  {
    plugins: [{ use: 'library', words: ['book', 'book_seen'] }],
  },
  ['graph', 'effects'],
  watch,
)
let watchingHost = watchPlan.bind(binding()).host
test('effect word selection runs only the selected handler after a write', async () => {
  await watchingHost.graph.apply([{
    entity: { eid: 'b' },
    book: { title: 'Dune' },
  }])
  equal(seen, ['seen'])
  seen.length = 0
})

let bad: Load = (_, name) =>
  Promise.resolve(
    name == 'effects'
      ? { effects: () => ({ book_sene: () => {} }) }
      : watched[name] ?? null,
  )
let badPlan = await assembly(
  {
    plugins: [{ use: 'library', words: ['book', 'book_seen'] }],
  },
  ['graph', 'effects'],
  bad,
)
test('word selection still refuses an undeclared effect handler', async () => {
  await throws(() => badPlan.bind(binding()), 'library handles book_sene')
})

let repeatedPlan = await assembly(
  {
    plugins: [
      { use: 'library', words: ['book'] },
      { use: 'library', words: ['book_list'] },
    ],
  },
  ['graph'],
  loading([]),
)
let repeatedHost = repeatedPlan.bind(binding()).host
test('separate selections of one package bind each tool once', () => {
  equal(repeatedHost.tools.filter((t) => t.name == 'book_list').length, 1)
})

let sender: Partial<Facets> = { effects: watched.effects }
let omittedPlan = await assembly(
  {
    plugins: [{ use: 'library', words: ['book'] }, 'sender'],
  },
  ['graph', 'effects'],
  (plugin, name) =>
    Promise.resolve((plugin == 'library' ? watched : sender)[name] ?? null),
)
let omittedHost = omittedPlan.bind(binding()).host
test('a handler lent by another plugin is omitted with its declaration', async () => {
  await omittedHost.graph.apply([{
    entity: { eid: 'b' },
    book: { title: 'Dune' },
  }])
  equal(seen, [])
})

let optional: Partial<Facets> = {
  ...watched,
  vocab: {
    docs: [{
      $defs: {
        ...watched.vocab!.docs![0].$defs!,
        book_seen: { effect: true, created: ['book'], option: 'notes' },
      },
    }],
  },
}
let repeatedEffects = (await assembly(
  {
    plugins: [
      { use: 'library', words: ['book', 'book_seen'], with: { notes: true } },
      { use: 'library', words: ['book_sent'] },
    ],
  },
  ['graph', 'effects'],
  (_, name) => Promise.resolve(optional[name] ?? null),
))
  .bind(binding()).host
test('separate selections retain their own effect options and handlers', async () => {
  await repeatedEffects.graph.apply([{
    entity: { eid: 'b' },
    book: { title: 'Dune' },
  }])
  equal(seen, ['seen', 'sent'])
  seen.length = 0
})

let extended: Partial<Facets> = {
  vocab: {
    docs: [{
      $defs: {
        book: {
          component: true,
          extends: true,
          properties: { isbn: { type: 'string' } },
        },
      },
    }],
  },
}
let ownedBase = (await assembly(
  config,
  ['graph'],
  (_, name) => Promise.resolve(extended[name] ?? null),
  { docs: own },
)).bind(binding()).host
test('graph-owned declarations supply a base and replace plugin extensions', async () => {
  await ownedBase.graph.apply([{
    entity: { eid: 'b' },
    book: { author: 'Herbert' },
  }])
  await throws(() =>
    ownedBase.graph.apply([{
      entity: { eid: 'b' },
      book: { isbn: '123' },
    }]), 'isbn')
})

let decoded = (await assembly(config, ['graph'], plain, {
  docs: JSON.parse(JSON.stringify(own)),
})).bind(binding()).host
let decodedAgain = (await assembly(config, ['graph'], plain, {
  docs: JSON.parse(JSON.stringify(own)),
})).bind(binding()).host
let revised = (await assembly(config, ['graph'], plain, {
  docs: [{
    $defs: {
      book: { component: true, properties: { pages: { type: 'integer' } } },
    },
  }],
})).bind(binding()).host

test('decoded graph-owned words keep independent storage and changed declarations', async () => {
  await decoded.graph.apply([{
    entity: { eid: 'copy' },
    book: { author: 'Herbert' },
  }])
  equal(await decodedAgain.graph.get(['copy']), [])
  await decodedAgain.graph.apply([{
    entity: { eid: 'copy' },
    book: { author: 'Le Guin' },
  }])
  equal((await decoded.graph.get(['copy']))[0].book, { author: 'Herbert' })
  equal((await decodedAgain.graph.get(['copy']))[0].book, { author: 'Le Guin' })
  await revised.graph.apply([{ entity: { eid: 'copy' }, book: { pages: 412 } }])
  equal((await revised.graph.get(['copy']))[0].book, { pages: 412 })
  await throws(
    () =>
      revised.graph.apply([{
        entity: { eid: 'copy' },
        book: { author: 'Herbert' },
      }]),
    'author',
  )
})

let legacyDoc: VocabDoc = {
  $defs: {
    book: facets.vocab!.docs![0].$defs!.book,
    book_named: { rule: true, match: '.book.title!=Plugin +book.title=Plugin' },
  },
}
let legacy: Load = (_, name) =>
  Promise.resolve(
    name == 'vocab'
      ? { docs: [legacyDoc] }
      : name == 'graph'
      ? { plugins: () => [{ name: 'library', vocab: [legacyDoc] }] }
      : null,
  )
let ruleSelection = await assembly(
  { plugins: [{ use: 'library', words: ['book'] }] },
  ['graph'],
  legacy,
)
let ruleSelected = ruleSelection.bind(binding()).host
test('chosen words omit rules from a graph plugin’s original vocabulary', async () => {
  await ruleSelected.graph.apply([{
    entity: { eid: 'b' },
    book: { title: 'Dune' },
  }])
  equal((await ruleSelected.graph.get(['b']))[0].book, { title: 'Dune' })
})
let ruleShadow = await assembly(
  { plugins: [{ use: 'library', words: ['book'] }] },
  ['graph'],
  legacy,
  {
    docs: [{
      $defs: {
        book: {
          component: true,
          type: 'object',
          properties: { author: { type: 'string' } },
        },
        book_authored: {
          rule: true,
          match: '.book.author!=Herbert +book.author=Herbert',
        },
      },
    }],
  },
)
let ruleOwned = ruleShadow.bind(binding()).host
test('graph-owned rules run against shadows without original plugin rules returning', async () => {
  await ruleOwned.graph.apply([{
    entity: { eid: 'b' },
    book: { author: 'Unknown' },
  }])
  equal((await ruleOwned.graph.get(['b']))[0].book, { author: 'Herbert' })
})

let twiceConfigured = (await assembly(
  {
    plugins: [
      { use: 'library', words: [], with: { prefix: 'a' } },
      { use: 'library', words: [], with: { prefix: 'b' } },
    ],
  },
  ['graph'],
  (_, name) =>
    Promise.resolve(
      name == 'vocab' ? facets.vocab! : name == 'graph'
        ? {
          plugins: (_host, options) => [{
            name: String(options.prefix),
            hooks: {
              normalize: (bundles) =>
                bundles.map((bundle) => ({
                  ...bundle,
                  book: {
                    title: `${options.prefix}${(bundle.book as Comp).title}`,
                  },
                })),
            },
          }],
        }
        : null,
    ),
  { docs: facets.vocab!.docs },
)).bind(binding()).host

test('repeated selections bind each configured occurrence’s options', async () => {
  await twiceConfigured.graph.apply([{
    entity: { eid: 'b' },
    book: { title: 'Dune' },
  }])
  equal((await twiceConfigured.graph.get(['b']))[0].book, { title: 'baDune' })
})

let facetConfig: Config = {
  plugins: [{ use: 'library', facets: ['vocab'] }],
}
let facetImports: string[] = []
let prefetched: string[] = []
let selectedLoad = loading(facetImports)
selectedLoad.together = (requests) => {
  prefetched = requests.map(([, facet]) => facet)
  return Promise.resolve()
}
let vocabOnly = (await assembly(
  facetConfig,
  ['graph', 'effects', 'web', 'library'],
  selectedLoad,
)).bind(binding()).host
await vocabOnly.graph.apply([{ entity: { eid: 'b' }, book: { title: 'Dune' } }])
let vocabOnlyAnatomy = vocabOnly.anatomy()
test('facet selection excludes hooks, tools and preloads across served roles', async () => {
  equal(prefetched, ['vocab'])
  equal(facetImports, ['vocab'])
  let anatomy = vocabOnlyAnatomy
  let state = (name: string) => {
    let facet = anatomy.facets.find((f) =>
      f.package == 'library' && f.name == name
    )!
    return [facet.selected, facet.attempted, facet.loaded, facet.bound]
  }
  equal(state('vocab'), [true, true, true, true])
  equal(state('graph'), [false, false, false, false])
  equal(state('tools'), [false, false, false, false])
  equal(state('effects'), [false, false, false, false])
  equal(state('service'), [false, false, false, false])
  equal((await vocabOnly.graph.get(['b']))[0].book, { title: 'Dune' })
  equal(vocabOnly.tools.some((t) => t.name == 'book_list'), false)
  await throws(() =>
    vocabOnly.runner.read({
      entity: { eid: 'excluded' },
      call: { to: toolEid('book_list'), args: {} },
    }), 'read-only tool')
  equal(facetImports, ['vocab'])
})

let distinctFacets = (await assembly(
  {
    plugins: [
      { use: 'library', facets: ['vocab'], with: { prefix: 'a' } },
      { use: 'library', facets: ['graph'], with: { prefix: 'b' } },
    ],
  },
  ['graph'],
  (_, name) =>
    Promise.resolve(
      name == 'vocab' ? facets.vocab! : name == 'graph'
        ? {
          plugins: (_host, options) => [{
            name: String(options.prefix),
            hooks: {
              normalize: (bundles) =>
                bundles.map((bundle) => ({
                  ...bundle,
                  book: {
                    title: `${options.prefix}${(bundle.book as Comp).title}`,
                  },
                })),
            },
          }],
        }
        : null,
    ),
)).bind(binding()).host
test('different facet selections retain their own factory options', async () => {
  await distinctFacets.graph.apply([{
    entity: { eid: 'b' },
    book: { title: 'Dune' },
  }])
  equal((await distinctFacets.graph.get(['b']))[0].book, { title: 'bDune' })
})
