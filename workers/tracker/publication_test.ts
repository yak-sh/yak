import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { platform } from './core.ts'
import { type State, Tracker } from './object.ts'
import { durable } from '../../packages/durable-object/testing.ts'

let fixture = async (error: Error, failures: number) => {
  let held = new Map<string, unknown>(), sent: Bundle[][] = []
  let calls: [string, string, boolean | undefined][] = [], pauses: number[] = []
  let stubs = 0, attempts = 0
  let state: State = {
    id: { name: crypto.randomUUID() },
    getWebSockets: () => [],
    acceptWebSocket: () => {},
    storage: {
      ...durable(),
      get: <T>(key: string) => Promise.resolve(held.get(key) as T),
      put: (key, value) => Promise.resolve(void held.set(key, value)),
    },
  }
  let env = {
    ERRORS: { send: (rows: Bundle[]) => Promise.resolve(void sent.push(rows)) },
    TRACKERS: {
      getByName: (scope: string) => {
        equal(scope, platform)
        stubs++
        return {
          ingestTrace: () => Promise.resolve(false),
          settle: () => Promise.resolve(0),
          changed: (scope: string, tag: string, populated?: boolean) => {
            calls.push([scope, tag, populated])
            return ++attempts <= failures
              ? Promise.reject(error)
              : Promise.resolve()
          },
        }
      },
    },
  }
  let object = () =>
    new Tracker(state, env, Date.now, undefined, (ms) => {
      pauses.push(ms)
      return Promise.resolve()
    })
  let target = object()
  await target.boot()
  return { target, object, sent, calls, pauses, stubs: () => stubs }
}

let opaque = () =>
  Error('internal error; reference = n50qn4c7rtb2lsp95lcbiqmh', {
    cause: { overloaded: true },
  })
let recovered = await fixture(opaque(), 1)
let reset = await fixture(Error('Network connection lost.'), 1)
let exhausted = await fixture(opaque(), 6)
let broken = await fixture(Error('publication unavailable'), 1)

for (
  let [name, f] of [['opaque runtime failure', recovered], [
    'reset',
    reset,
  ]] as const
) {
  test(`scope publication retries a ${name} before reporting and survives hibernation`, async () => {
    await f.target.alarm()
    equal(f.stubs(), 2)
    equal(f.calls[0], f.calls[1])
    equal(f.calls[0][0], f.target.scope)
    equal(f.pauses, [100])
    equal(f.sent.length, 0)
    await f.object().alarm()
    equal(f.stubs(), 2)
  })
}

test('publication reports an exhausted runtime failure and keeps it owed after hibernation', async () => {
  await exhausted.target.alarm()
  equal(exhausted.stubs(), 6)
  equal(exhausted.sent.length, 1)
  equal(exhausted.pauses, [100, 500, 2000, 5000, 15000])
  await exhausted.object().alarm()
  equal(exhausted.stubs(), 7)
  equal(exhausted.sent.length, 1)
  equal(exhausted.calls[0], exhausted.calls[6])
  await exhausted.object().alarm()
  equal(exhausted.stubs(), 7)
})

test('publication reports an ordinary failure immediately and still recovers', async () => {
  await broken.target.alarm()
  equal([broken.stubs(), broken.sent.length, broken.pauses.length], [1, 1, 0])
  await broken.object().alarm()
  equal([broken.stubs(), broken.sent.length], [2, 1])
})
