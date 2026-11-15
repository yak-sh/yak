// An image asked of a model (./image.ts): a call it can correct is refused
// before anything is asked.
import { assertRejects } from '@std/assert'
import { equal, test } from '@yaks/testing'
import { ModelError } from './mod.ts'
import { imageMade } from './image.ts'

test('a missing prompt or a model not offered is refused, and nothing is asked', async () => {
  let asked = 0
  let make = () => (asked++, Promise.resolve({ id: '', model: '', items: [] }))
  for (let args of [{}, { prompt: ' ' }, { prompt: 'x', model: 'other' }]) {
    let e = await assertRejects(
      () => imageMade(make, ['sketch'], args),
      ModelError,
    )
    equal(e.code, 'input')
  }
  equal(asked, 0)
})
