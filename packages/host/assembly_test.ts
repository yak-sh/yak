/** Portable assembly binds the same facets over storage with no box resources. */
import { memoryBlobs } from '@yaks/blob'
import { effects } from '@yaks/effects'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { ramVault } from '@yaks/secrets'
import { equal, test } from '@yaks/testing'
import { toolEid } from '@yaks/tools'
import { assembly, type Binding } from './assembly.ts'
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
