import { choose } from './choose.ts'
import { survey } from './deps.ts'
import { equal, test } from './mod.ts'

let unchanged = await choose(['missing_test.ts'], { changed: [] })

test('no changed paths selects no tests without needing a dependency graph or cache', () => {
  equal(unchanged.run, [])
  equal(unchanged.keys.size, 0)
  equal(unchanged.reaches(['missing_test.ts']), false)
})

test('selection uses the supplied command snapshot and retains dependency keys', async () => {
  let roots = ['a_test.ts', 'a.ts']
  let s = (await survey(roots, () =>
    Promise.resolve({
      modules: roots.map((f, i) => ({
        specifier: new URL(f, `file://${Deno.cwd()}/`).href,
        dependencies: i ? [] : [{
          code: { specifier: new URL('a.ts', `file://${Deno.cwd()}/`).href },
        }],
      })),
      redirects: {},
    })))!
  let asked: string[][] = []
  let selected = await choose(['a_test.ts'], {
    changed: ['a.ts'],
    all: true,
    inspect: (paths) => {
      asked.push(paths)
      return Promise.resolve(s)
    },
  })
  equal(asked, [['a_test.ts']])
  equal(selected.run, ['a_test.ts'])
  equal(selected.reaches(['a.ts']), true)
  equal(selected.keys.size, 1)
})
