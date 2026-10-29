import { choose } from './choose.ts'
import { equal, test } from './mod.ts'

let unchanged = await choose(['missing_test.ts'], { changed: [] })

test('no changed paths selects no tests without needing a dependency graph or cache', () => {
  equal(unchanged.run, [])
  equal(unchanged.keys.size, 0)
  equal(unchanged.reaches(['missing_test.ts']), false)
})
