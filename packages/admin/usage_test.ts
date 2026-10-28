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
// Those hours: `normal` each, then the run, its last at `at`.
let run = (normal: number, ...ran: number[]) => [
  ...Array(49 - ran.length).fill(normal),
  ...ran,
]
// A tracker object that read and wrote these rows those hours, answering 3,100
// fetches and 98 RPCs in the last.
let answer = (read: number[], wrote = run(1)): Answer => {
  let object = { scriptName: 'yak-tracker', namespaceId: 'ns', objectId: 'o1' }
  return {
    viewer: {
      accounts: [{
        workers: [],
        stored: hours.map((h, i) => ({
          dimensions: {
            namespaceId: 'ns',
            objectId: 'o1',
            datetimeHour: h,
          },
          sum: { rowsRead: read[i], rowsWritten: wrote[i], duration: 1 },
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
let found = (read: number[], wrote?: number[]) => {
  let { series, who } = readings(answer(read, wrote))
  return jumps(series, at).map((j) => report(j, who.get(j.subject)))
}

test('an hour far past its normal is a jump that names the object and its entry points', () => {
  let [jump, ...rest] = found(run(3.3e6, 423.8e6))
  equal(rest, [])
  match(
    jump.error.message,
    /^yak-tracker's Durable Object o1 \(named platform\) read 423\.8M rows in the hour from 2026-10-17T12:00:00\.000Z, 128\.4 times its normal of 3\.3M .* Its entry points: 3,100 http, 98 jsrpc\.$/,
  )
  equal(jump.context.fault, 'usage jump|object ns o1|rowsRead')
  equal(jump.context.tags.normal, '3300000')
})

test('an hour near its normal, or past it by less than a look is worth, is no jump', () => {
  equal(found(run(300e6, 420e6)), [])
  equal(found(run(1e3, 5e6)), [])
})

test('an hour of work that finished is no jump, though far past its normal', () => {
  // yak-trash's daily sweep in the directory, 2026-10-28 04:00Z
  equal(found(run(2e3), run(300, 74_519)), [])
})

test('a burst worth a look even once is a jump, saying how long it ran', () => {
  // the platform tracker's writes, 2026-10-17 11:00Z and 12:00Z
  let [jump, ...rest] = found(run(2e3), run(164, 422e3, 785e3))
  equal([rest, jump.context.tags.metric], [[], 'rowsWritten'])
  match(jump.error.message, /It has been past its normal 2 hours running\./)
})

test('a rise that stays is a jump each hour it stays', () => {
  // the platform tracker's reads, from 2026-10-17 11:00Z
  let stayed = (hours: number) =>
    found(run(1e6, 518e6, 423.8e6, ...Array(hours).fill(17e6)))
      .map((j) => j.context.tags.running)
  equal([stayed(1), stayed(10)], [['3'], ['12']])
})

test("an hour's report lands once however often it is sent", () => {
  equal(
    found(run(3.3e6, 423.8e6))[0].context.eid,
    found(run(3e6, 400e6))[0].context.eid,
  )
})

test('a look reports every jump it finds', async () => {
  let sent: string[] = []
  let jumped = await look(
    () => Promise.resolve(answer(run(3.3e6, 423.8e6))),
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
