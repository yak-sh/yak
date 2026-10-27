import { equal, match, test } from '@yaks/testing'
import { type Answer, HOUR, jumps, readings, report } from './usage.ts'
import { analytics, look } from './service.ts'

let at = Date.parse('2026-10-17T12:00:00Z')
// The 48 hours before `at`, then `at`, as analytics stamps them.
let hours = Array.from(
  { length: 49 },
  (_, i) => new Date(at - (48 - i) * HOUR).toISOString(),
)
let last = hours[48]
// A tracker object that read `before` rows each of the 48 hours before `at`
// and `now` rows in it, answering 3,100 fetches and 98 RPCs that hour.
let answer = (before: number, now: number): Answer => {
  let object = { scriptName: 'yak-tracker', namespaceId: 'ns', objectId: 'o1' }
  return {
    viewer: {
      accounts: [{
        workers: [],
        stored: hours.map((h) => ({
          dimensions: {
            namespaceId: 'ns',
            objectId: 'o1',
            datetimeHour: h,
          },
          sum: {
            rowsRead: h == last ? now : before,
            rowsWritten: 1,
            duration: 1,
          },
        })),
        called: [{
          dimensions: { ...object, datetimeHour: last },
          sum: { requests: 3198 },
        }],
        entries: [
          {
            dimensions: { ...object, name: 'platform', type: 'jsrpc' },
            sum: { requests: 98 },
          },
          {
            dimensions: { ...object, name: 'platform', type: 'http' },
            sum: { requests: 3100 },
          },
        ],
      }],
    },
  }
}
let found = (before: number, now: number) => {
  let { series, who } = readings(answer(before, now))
  return jumps(series, at).map((j) => report(j, who.get(j.subject)))
}

test('an hour far past its normal is a jump that names the object and its entry points', () => {
  let [jump, ...rest] = found(3.3e6, 423.8e6)
  equal(rest, [])
  match(
    jump.error.message,
    /^yak-tracker's Durable Object o1 \(named platform\) read 423\.8M rows in the hour from 2026-10-17T12:00:00\.000Z, 128\.4 times its normal of 3\.3M .* Its entry points: 3,100 http, 98 jsrpc\.$/,
  )
  equal(jump.context.fault, 'usage jump|object ns o1|rowsRead')
  equal(jump.context.tags.normal, '3300000')
})

test('an hour near its normal, or past it by less than a look is worth, is no jump', () => {
  equal(found(300e6, 420e6), [])
  equal(found(1e3, 5e6), [])
})

test("an hour's report lands once however often it is sent", () => {
  equal(found(3.3e6, 423.8e6)[0].context.eid, found(3e6, 400e6)[0].context.eid)
})

test('a look reports every jump it finds', async () => {
  let sent: string[] = []
  let jumped = await look(
    () => Promise.resolve(answer(3.3e6, 423.8e6)),
    (error) => void sent.push(String(error)),
    at,
  )
  equal([jumped.length, sent.length], [1, 1])
  match(sent[0], /^UsageJump: yak-tracker's Durable Object o1/)
})

test('a look with no token to read analytics with passes its hour quietly', async () => {
  let sent: unknown[] = []
  let usage = analytics({ account: 'a', analytics: undefined })!
  equal(await look(usage, (error) => void sent.push(error), at), [])
  equal(sent, [])
})
