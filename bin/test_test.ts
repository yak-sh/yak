import { equal, test } from '@yaks/testing'
import { affected } from '@yaks/testing/choose'
import { survey } from '@yaks/testing/deps'
import { changes } from './test-changes.ts'
import { prepare, RUNS } from './test.ts'

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

test('a runtime change still selects unrelated tests', () => {
  equal(
    affected(graph, ['packages/fp/mod.ts'], RUNS, ['bin/test-runtime.ts']),
    true,
  )
})

let planned = async (args: string[], shallow = false, pass = true) => {
  let git: string[][] = []
  let checked: string[][][] = []
  let selected: { all: boolean; changed?: string[] }[] = []
  let files = ['a_test.ts', 'a.ts']
  let plan = await prepare(args, '/sqlite.so', {
    changes: () =>
      changes((args) => {
        git.push(args)
        if (args[0] == 'branch') return Promise.resolve('main\n')
        if (args[0] == 'diff' && shallow) {
          throw new Error("fatal: ambiguous argument 'HEAD^'")
        }
        return Promise.resolve(args[0] == 'diff' ? 'a.ts\0' : '')
      }),
    format: (paths) => Promise.resolve(paths),
    find: () => Promise.resolve({ tests: [files[0]], pages: [files[1]] }),
    walk: () => Promise.resolve([files[1]]),
    chosen: (files, all, _also, changed) => {
      selected.push({ all, changed })
      return Promise.resolve({
        keys: new Map(files.map((f) => [f, f])),
        run: files,
        affected: files,
        sources: ['a.ts'],
        reaches: () => false,
      })
    },
    check: (changed, affected) => {
      checked.push([changed, affected])
      return Promise.resolve(pass)
    },
    ready: () => Promise.resolve(),
  })
  return { plan, git, checked, selected }
}
let whole = await planned(['--all', '--verbose'], true)
let local = await planned([])
let failed = await planned([], false, false)

test('--all in a shallow checkout runs every file without git history or duplicate source checks', () => {
  equal(whole.plan.run, ['a_test.ts', 'a.ts'])
  equal(whole.plan.ok, true)
  equal(whole.selected, [{ all: true, changed: undefined }])
  equal(whole.git, [])
  equal(whole.checked, [])
})

test('local selection checks changed sources and consumers and propagates failures', () => {
  equal(local.selected, [{ all: false, changed: ['a.ts'] }])
  equal(local.checked, [[['a.ts'], ['a_test.ts', 'a.ts', 'a.ts']]])
  equal(local.plan.ok, true)
  equal(failed.plan.ok, false)
})
