import { equal, test, throws } from '@yaks/testing'
import { checkoutBase } from './checkout.ts'

test('a repeated checkout keeps its original commit after its base moves', async () => {
  let refs = { main: 'first' }
  let resolve = (name: string) => Promise.resolve(refs[name as 'main'])
  let base = await checkoutBase(undefined, 'main', resolve)
  refs.main = 'next'
  equal(
    await checkoutBase({ requested: 'main', base }, 'main', resolve),
    'first',
  )
  equal(
    await checkoutBase({ requested: 'main', base }, undefined, resolve),
    'first',
  )
})

test('a checkout accepts an equivalent base and refuses a different commit', async () => {
  let intent = { requested: 'main', base: 'first' }
  let resolve = (name: string) => Promise.resolve(name)
  equal(await checkoutBase(intent, 'first', resolve), 'first')
  await throws(
    () => checkoutBase(intent, 'next', resolve),
    'pinned base intent',
  )
})

test('a checkout interrupted before pinning resolves its original request', async () => {
  let resolve = (name: string) => Promise.resolve(name + '-commit')
  equal(
    await checkoutBase({ requested: 'main' }, undefined, resolve),
    'main-commit',
  )
})
