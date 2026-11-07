import { clock, equal, test } from '@yaks/testing'
import {
  type Ended,
  type Keep,
  KEPT,
  outlasted,
  outlasting,
} from './outlast.ts'

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

// The object's calls, on a clock the test advances.
let calls = (keep: Keep, patience: number) => {
  let c = clock()
  return { c, call: outlasting(keep, { patience, now: c.now, after: c.after }) }
}

let zero = '1970-01-01T00:00:00.000Z'

test('a call within patience is answered with its own answer', async () => {
  let { call } = calls(memory(), 50)
  let heard = await call(() => Promise.resolve(body('deployed v42')))
  equal(heard, { ...body('deployed v42'), asked: zero })
})

test('a call past patience is still running; the next joins it and hears how it ended', async () => {
  let keep = memory()
  let { c, call } = calls(keep, 20)
  let r = runs()
  let first = call(r.run)
  await c.advance(20)
  equal(await first, { running: zero })
  let joined = call(r.run)
  await c.advance(0)
  r.end(body('deployed v42'))
  equal((await joined as { said: unknown }).said, body('deployed v42').said)
  await c.advance(0)
  equal([r.begun(), keep.held.size], [1, 0])
})

test('an answer nobody heard goes to the next call, once, then calls run again', async () => {
  let { c, call } = calls(memory(), 10)
  let r = runs()
  let first = call(r.run)
  await c.advance(10)
  await first
  r.end({ refused: { code: 'arguments', text: 'could not compile' } })
  await c.advance(0)
  equal(await call(r.run), {
    refused: { code: 'arguments', text: 'could not compile' },
    asked: zero,
    late: true,
  })
  await c.advance(0)
  let again = call(r.run)
  await c.advance(0)
  r.end(body('deployed v43'))
  equal(((await again) as { late?: true }).late, undefined)
  equal(r.begun(), 2)
})

test('an answer kept past its time is dropped and the call runs', async () => {
  let { c, call } = calls(memory(), 10)
  let r = runs()
  let first = call(r.run)
  await c.advance(10)
  await first
  r.end(body('deployed v42'))
  await c.advance(0)
  await c.advance(KEPT)
  let fresh = call(r.run)
  await c.advance(0)
  r.end(body('deployed v43'))
  equal(((await fresh) as { said: unknown }).said, body('deployed v43').said)
  equal(r.begun(), 2)
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
