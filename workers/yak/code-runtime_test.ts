import { equal, test, throws } from '@yaks/testing'
import { evaluator, type Loader } from './code-runtime.ts'
import type { Evaluate } from '@yaks/code-mode'

type Bridge = Parameters<Evaluate>[1]
let bridge: Bridge = { call: () => Promise.resolve({ content: [] }) }
let fixture = (run: (bridge: Bridge) => Promise<string>) => {
  let disposed = 0
  let loader: Loader = {
    load: () => ({
      getEntrypoint: () => ({
        run: (bridge) =>
          Object.assign(run(bridge as Bridge), {
            [Symbol.dispose]: () => disposed++,
          }),
      }),
    }),
  }
  return {
    evaluate: evaluator(loader, (bridge) => bridge),
    disposed: () => disposed,
  }
}

test('evaluator runs through non-disposable loader handles and disposes the RPC call', async () => {
  let f = fixture(async (bridge) =>
    JSON.stringify(await bridge.call('a', 'b', '{}'))
  )
  let abort = new AbortController()
  equal(await f.evaluate({}, bridge, abort.signal), '{"content":[]}')
  equal(f.disposed(), 1)
  abort.abort()
  equal(f.disposed(), 1)
})

test('evaluator disposes the pending RPC on abort and removes its listener', async () => {
  let reject!: (reason: Error) => void
  let f = fixture(() => new Promise((_, no) => reject = no))
  let abort = new AbortController()
  let result = f.evaluate({}, bridge, abort.signal)
  abort.abort()
  equal(f.disposed(), 1)
  reject(new Error('RPC canceled'))
  await throws(() => result, 'execution has ended')
  equal(f.disposed(), 2)
})

test('evaluator refuses an expired invocation before loading code', async () => {
  let f = fixture(() => {
    throw new Error('must not run')
  })
  await throws(
    () => f.evaluate({}, bridge, AbortSignal.abort()),
    'execution has ended',
  )
  equal(f.disposed(), 0)
})
