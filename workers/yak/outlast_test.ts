import { equal, test } from '@yaks/testing'
import { type Ended, type Keep, outlasted, outlasting } from './outlast.ts'

let memory = (): Keep & { held: Map<string, unknown> } => {
  let held = new Map<string, unknown>()
  return {
    held,
    get: <T>(key: string) => Promise.resolve(held.get(key) as T | undefined),
    put: (key, value) => Promise.resolve(void held.set(key, value)),
    delete: (key) => Promise.resolve(held.delete(key)),
  }
}

let body = (text: string): Ended & { said: unknown } => ({
  said: [{ entity: { eid: '$said' }, content: { body: text } }],
})

// A run the test ends when it likes, counting how many were begun.
let runs = () => {
  let begun = 0
  let end = (_: Ended) => {}
  let run = () => {
    begun++
    return new Promise<Ended>((done) => end = done)
  }
  return { run, end: (out: Ended) => end(out), begun: () => begun }
}

let tick = () => new Promise((done) => setTimeout(done, 5))
let at = (ms: number) => () => ms

test('a call within patience is answered with its own answer', async () => {
  let call = outlasting(memory(), { patience: 50, now: at(0) })
  let heard = await call(() => Promise.resolve(body('deployed v42')))
  equal(heard, { ...body('deployed v42'), asked: '1970-01-01T00:00:00.000Z' })
})

test('a call past patience is still running; the next joins it and hears how it ended', async () => {
  let keep = memory()
  let call = outlasting(keep, { patience: 20, now: at(0) })
  let r = runs()
  equal(await call(r.run), { running: '1970-01-01T00:00:00.000Z' })
  let joined = call(r.run)
  await tick()
  r.end(body('deployed v42'))
  equal((await joined as { said: unknown }).said, body('deployed v42').said)
  await tick()
  equal([r.begun(), keep.held.size], [1, 0])
})

test('an answer nobody heard goes to the next call, once, then calls run again', async () => {
  let keep = memory()
  let now = 0
  let call = outlasting(keep, { patience: 10, now: () => now })
  let r = runs()
  await call(r.run)
  r.end({ refused: { code: 'arguments', text: 'could not compile' } })
  await tick()
  equal(await call(r.run), {
    refused: { code: 'arguments', text: 'could not compile' },
    asked: '1970-01-01T00:00:00.000Z',
    late: true,
  })
  await tick()
  let again = call(r.run)
  await tick()
  r.end(body('deployed v43'))
  equal(((await again) as { late?: true }).late, undefined)
  equal(r.begun(), 2)
})

test('an answer kept past its time is dropped and the call runs', async () => {
  let keep = memory()
  let now = 0
  let call = outlasting(keep, { patience: 10, now: () => now })
  let r = runs()
  await call(r.run)
  r.end(body('deployed v42'))
  await tick()
  now = 16 * 60_000
  let fresh = call(r.run)
  await tick()
  r.end(body('deployed v43'))
  equal(((await fresh) as { said: unknown }).said, body('deployed v43').said)
})

test('the door says a late answer was asked earlier, and a refusal stays one', async () => {
  let objects = (heard: unknown) => ({
    idFromName: (name: string) => name,
    get: () => ({ call: () => Promise.resolve(heard as never) }),
  })
  let asked = { tool: 'app_deploy', args: { app: 'yak-sh' }, person: 'p' }
  let [late] = await outlasted(
    objects({ ...body('deployed v42'), asked: 'T', late: true }),
    'k',
    asked,
  )
  equal(
    (late.content as { body: string }).body,
    'This answers the app_deploy asked at T, which was still running when ' +
      'it answered:\ndeployed v42',
  )
  let [running] = await outlasted(objects({ running: 'T' }), 'k', asked)
  equal((running.output as { value: unknown }).value, {
    running: true,
    asked: 'T',
  })
  let refused = await outlasted(
    objects({ refused: { code: 'limit', text: 'no' }, asked: 'T' }),
    'k',
    asked,
  ).catch((e) => [e.name, e.code, e.message])
  equal(refused, ['CallError', 'limit', 'no'])
})
