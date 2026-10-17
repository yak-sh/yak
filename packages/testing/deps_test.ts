import { equal, test } from './mod.ts'
import { forget, passed, remember } from './deps.ts'

test('a pass forgotten is no longer kept, and the others stay', () => {
  let store = `${Deno.makeTempDirSync()}/passed.json`
  remember(['a', 'b', 'c'], store)
  forget(['a', 'c', 'never'], store)
  equal(Object.keys(passed(store)), ['b'])
})
