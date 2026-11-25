import { equal, test, throws } from '@yaks/testing'
import { affected } from '@yaks/testing/choose'
import { survey } from '@yaks/testing/deps'
import { changes } from './test-changes.ts'
import { prepare, ROOTS, RUNS } from './test.ts'

// A module graph with a runner consumer and an unrelated example page.
let helpers = [
  'bin/phases.ts',
  'bin/test-budget.ts',
  'bin/test-changes.ts',
  'bin/test-checks.ts',
  'bin/sqlite.ts',
]
let imports = {
  'bin/test_test.ts': ['bin/test.ts'],
  'bin/test.ts': helpers,
  'packages/fp/mod.ts': [],
  ...Object.fromEntries(helpers.map((f) => [f, []])),
}
let graph = (await survey(Object.keys(imports), () =>
  Promise.resolve({
    modules: Object.entries(imports).map(([file, deps]) => ({
      specifier: new URL(file, `file://${Deno.cwd()}/`).href,
      dependencies: deps.map((file) => ({
        code: { specifier: new URL(file, `file://${Deno.cwd()}/`).href },
      })),
    })),
    redirects: {},
  })))!

for (let file of ['bin/test.ts', ...helpers]) {
  test(`${file} selects its consumers without selecting unrelated tests`, () => {
    equal(affected(graph, ['bin/test_test.ts'], RUNS, [file]), true)
    equal(affected(graph, ['bin/test.ts'], RUNS, [file]), true)
    equal(affected(graph, ['packages/fp/mod.ts'], RUNS, [file]), false)
  })
}

test('an executor change still selects unrelated tests', () => {
  equal(
    affected(graph, ['packages/fp/mod.ts'], RUNS, ['packages/testing/run.ts']),
    true,
  )
})

let planned = async (
  args: string[],
  shallow = false,
  pass = true,
  touched = 'a.ts',
  edited: Record<string, string[]> = {},
) => {
  let git: string[][] = []
  let checked: string[][] = []
  let selected: { all: boolean; changed?: string[]; sources: string[] }[] = []
  let files = ['a_test.ts', 'a.ts']
  let plan = await prepare(args, '/sqlite.so', {
    edits: () =>
      Promise.resolve(Object.fromEntries(
        Object.entries(edited).map((
          [path, names],
        ) => [path, { names, bodies: false }]),
      )),
    changes: () =>
      changes({
        run: (args) => {
          git.push(args)
          if (args[0] == 'branch') return Promise.resolve('main\n')
          if (args[0] == 'rev-parse' && shallow) {
            throw new Error("fatal: ambiguous argument 'HEAD^'")
          }
          if (args[0] == 'rev-parse') return Promise.resolve('parent\n')
          return Promise.resolve(args[0] == 'diff' ? `${touched}\0` : '')
        },
      }),
    format: (paths) => Promise.resolve(paths),
    find: () => Promise.resolve({ tests: [files[0]], pages: [files[1]] }),
    chosen: (files, all, _also, changed, sources = []) => {
      selected.push({ all, changed, sources })
      return Promise.resolve({
        keys: new Map(files.map((f) => [f, f])),
        run: files,
        affected: files,
        sources: ['a.ts'],
        beyond: 0,
        reaches: () => false,
        read: () => undefined,
      })
    },
    check: (changed) => {
      checked.push(changed)
      return Promise.resolve(pass)
    },
  })
  return { plan, git, checked, selected }
}
let whole = await planned(['--all', '--verbose'], true)
let local = await planned([])
let failed = await planned([], false, false)

test('--all in a shallow checkout runs every file without git history or duplicate source checks', async () => {
  equal(whole.plan.run, ['a_test.ts', 'a.ts'])
  equal(await whole.plan.ok, true)
  equal(whole.selected, [{ all: true, changed: undefined, sources: [] }])
  equal(whole.git, [])
  equal(whole.checked, [])
})

test('local selection keeps consumer tests, checks changed sources and propagates failures', async () => {
  equal(local.selected, [{ all: false, changed: ['a.ts'], sources: ['a.ts'] }])
  equal(local.checked, [['a.ts']])
  equal(local.plan.run, ['a_test.ts', 'a.ts'])
  equal(await local.plan.ok, true)
  equal(await failed.plan.ok, false)
})

test('deployment comments still reach source checks and leave runtime consumers alone', async () => {
  let config = 'workers/yak/wrangler.toml'
  let comment = await planned([], false, true, config, { [config]: [] })
  equal(comment.checked, [[config]])
  equal(comment.selected[0].changed, [])
  let binding = await planned([], false, true, config, { [config]: ['*'] })
  equal(binding.selected[0].changed, [config])
})

test('dependency bookkeeping changes select their consumers without selecting unrelated tests', () => {
  for (let path of ['packages/testing/main.ts', 'packages/testing/reads.ts']) {
    equal(affected(graph, ['packages/fp/mod.ts'], RUNS, [path]), false)
  }
  equal(
    affected(graph, ['packages/fp/mod.ts'], RUNS, ['bin/test-runtime.ts']),
    true,
  )
})

// What a run given `args` looks among, and what it selects by.
let named = async (args: string[]) => {
  let found: string[][] = []
  let by: { files: string[]; changed?: string[] }[] = []
  await prepare(args, '/sqlite.so', {
    edits: () => Promise.resolve({}),
    changes: () => Promise.resolve(['c.ts']),
    format: (paths) => Promise.resolve(paths),
    find: (paths) => {
      found.push(paths)
      let tests = paths == ROOTS ? ['a_test.ts', 'b_test.ts'] : paths
      return Promise.resolve({ tests, pages: [] })
    },
    chosen: (files, _all, _also, changed) => {
      by.push({ files, changed })
      return Promise.resolve({
        keys: new Map(),
        run: files,
        affected: files,
        sources: [],
        beyond: 0,
        reaches: () => false,
        read: () => undefined,
      })
    },
    check: () => Promise.resolve(true),
  })
  return { found, by }
}

test('a source file named selects, among every file, the tests depending on it', async () => {
  let all = ['a_test.ts', 'b_test.ts']
  equal(await named(['a.ts']), {
    found: [ROOTS],
    by: [{ files: all, changed: ['a.ts'] }],
  })
  equal(await named(['a.ts', 'z_test.ts']), {
    found: [['z_test.ts'], ROOTS],
    by: [{ files: all, changed: ['a.ts', 'z_test.ts'] }],
  })
  equal(await named(['z_test.ts']), {
    found: [['z_test.ts']],
    by: [{ files: ['z_test.ts'], changed: undefined }],
  })
})

test('selection failures settle source checks waiting for the shared graph', async () => {
  let settled = false
  await throws(() =>
    prepare([], '/sqlite.so', {
      edits: () => Promise.resolve({}),
      changes: () => Promise.resolve(['worker.ts']),
      format: (files) => Promise.resolve(files),
      find: () => Promise.resolve({ tests: ['a_test.ts'], pages: [] }),
      chosen: () => {
        throw new Error('selection failed')
      },
      check: async (_changed, snapshot) => {
        try {
          await snapshot
          return true
        } catch {
          return false
        } finally {
          settled = true
        }
      },
    }), /selection failed/)
  equal(settled, true)
})

test('source planning and selection consume one command snapshot', async () => {
  let queried: string[][] = []
  let checked: unknown
  let scopes: boolean[] = []
  let chosen: unknown
  let result = await prepare([], '/sqlite.so', {
    edits: () => Promise.resolve({ 'a.ts': { names: ['a'], bodies: true } }),
    changes: () => Promise.resolve(['a.ts']),
    format: (paths) => Promise.resolve(paths),
    find: () => Promise.resolve({ tests: ['a_test.ts'], pages: [] }),
    chosen: async (files, _all, _also, _changed, _sources, inspect) => {
      chosen = await inspect!([...files, 'a.ts'])
      return {
        keys: new Map(),
        run: files,
        affected: files,
        sources: [],
        beyond: 0,
        reaches: () => false,
        read: () => undefined,
      }
    },
    check: async (_changed, snapshot, bodiesOnly) => {
      scopes.push(bodiesOnly ?? false)
      checked = await snapshot
      return true
    },
  }, (paths) => {
    queried.push(paths)
    return Promise.resolve(graph)
  })
  equal(await result.ok, true)
  equal(scopes, [true])
  equal(queried, [['a_test.ts', 'a.ts']])
  equal(chosen === graph && checked === graph, true)
})

test('selection receives the example snapshot from the same discovery', async () => {
  let parsed = new Map([['guide.md', { fenced: [], lines: [] }]])
  let received: unknown
  let result = await prepare(['--all'], '/sqlite.so', {
    edits: () => Promise.resolve({}),
    changes: () => Promise.resolve([]),
    format: (paths) => Promise.resolve(paths),
    find: () => Promise.resolve({ tests: [], pages: ['guide.md'], parsed }),
    chosen: (files, _all, _also, _changed, _sources, _inspect, examples) => {
      received = examples
      return Promise.resolve({
        keys: new Map(),
        run: files,
        affected: files,
        sources: [],
        beyond: 0,
        reaches: () => false,
        read: () => undefined,
      })
    },
    check: () => Promise.resolve(true),
  })
  equal(received === parsed, true)
  equal(result.run, ['guide.md'])
})
