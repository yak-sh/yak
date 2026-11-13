import { equal, test, throws } from '@yaks/testing'
import { deferred } from './deferred.ts'

class Base {
  constructor(readonly ctx: string) {}
}

type Said = Record<string, (name?: string) => Promise<string>>

// A loader that counts its loads and the objects its class makes, and fails
// as many times as it is told to first.
let loader = (failing = 0) => {
  let seen = { loads: 0, made: [] as unknown[][] }
  let load = () => {
    seen.loads++
    if (failing-- > 0) return Promise.reject(Error('not loaded'))
    return Promise.resolve((...args: unknown[]) => {
      seen.made.push(args)
      return {
        hello: (name: string) => `hello ${name}`,
        later: () => Promise.resolve('later'),
      }
    })
  }
  return { seen, load }
}

test('a deferred object is made once, on its first call, from its arguments', async () => {
  let { seen, load } = loader()
  let Lazy = deferred(Base, load, ['hello', 'later'])
  let o = new Lazy('ctx', 'env') as Base & Said
  equal([o.ctx, seen.loads, seen.made], ['ctx', 0, []])
  equal(await o.hello('ada'), 'hello ada')
  equal(await o.later(), 'later')
  new Lazy('other')
  equal([seen.loads, seen.made], [1, [['ctx', 'env']]])
})

test('a load that fails is tried again by the next call', async () => {
  let { seen, load } = loader(1)
  let o = new (deferred(Base, load, ['hello']))('ctx') as Said
  await throws(() => o.hello('ada'), 'not loaded')
  equal(await o.hello('ada'), 'hello ada')
  equal(seen.loads, 2)
})

test('each call runs inside around, given the constructor arguments', async () => {
  let { load } = loader()
  let runs: unknown[] = []
  let Lazy = deferred(
    Base,
    load,
    ['hello'],
    async (args, method, call, given) => {
      runs.push([args, method, given])
      return `(${await call()})`
    },
  )
  let o = new Lazy('ctx', 'env') as Said
  equal(await o.hello('ada'), '(hello ada)')
  equal(runs, [[['ctx', 'env'], 'hello', ['ada']]])
})
