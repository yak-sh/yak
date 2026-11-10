// A connector call can return a running task without stopping its work.
import { clock, equal, ok, test } from '@yaks/testing'
import { type Bundle, mint } from '@yaks/graph'
import type { Reply } from '@yaks/model'
import { statusOf } from '@yaks/session'
import { platform } from './directory-rows-probe.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { watched, within } from './defects.ts'

let fixture = async (name: string) => {
  let time = clock(Date.now()), reports: Bundle[][] = []
  let p = platform(name, {
    CLOCK: time,
    ERRORS: {
      send: (rows) => {
        reports.push(rows)
        return Promise.resolve()
      },
    },
  })
  let person = mint()
  let space = await p.dir.mint(person, name, name, {
    'x-yak-person': person,
    'x-yak-role': 'owner',
  })
  let began = Promise.withResolvers<void>()
  let reply = Promise.withResolvers<Reply>()
  let service = operatorService(p.env, { person, space, role: 'owner' }, {
    directory: () => p.dir,
    ...operatorModel(() => {
      began.resolve()
      return reply.promise
    }),
  })
  let retained: Promise<void>[] = []
  let ask = (path: string, args: object) =>
    within(
      p.env,
      { request: 'Builder fetch' },
      () =>
        watched(() =>
          service.binding.get(space).fetch(
            new Request('https://builder/operator/' + path, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-space-eid': space,
                'x-yak-person': person,
              },
              body: JSON.stringify(args),
            }),
          ), time),
      time,
      { retain: (work) => retained.push(work) },
    )
  let finish = () =>
    reply.resolve({
      id: mint(),
      model: 'test-model',
      items: [{ kind: 'assistant', text: 'Finished the work.' }],
      cost: 0.001,
    })
  return { time, reports, began, service, retained, ask, finish }
}

let slow = await fixture('operator-slow-run')
let answered = false
let pending = slow.ask('run', { say: 'Do the work.' })
  .then((response) => (answered = true, response))
await slow.began.promise
test('a long connector run answers with its task while work continues and its final reply remains readable', async () => {
  try {
    await slow.time.advance(24_999)
    equal(answered, false)
    await slow.time.advance(1)
    await slow.time.advance(0)
    equal(answered, true)
    let response = await pending
    equal(response.status, 200)
    let progress = await response.json()
    equal(progress.status, 'running')
    equal(progress.cost, 0)
    ok(progress.text.includes('operator_read'))
    ok(progress.text.includes(progress.task))
    ok(!progress.text.includes('ended without an answer'))
    await slow.time.advance(60_000)
    equal(slow.reports, [])
    slow.finish()
    await Promise.all(slow.retained)
    await slow.service.drain()
    let read = await (await slow.ask('read', { task: progress.task })).json()
    equal(read.sessions[0].entity.eid, progress.session)
    equal(statusOf(read.entries), 'settled')
    ok(
      read.entries.some((row: Bundle) =>
        row.output &&
        (row.content as { body?: string })?.body == 'Finished the work.'
      ),
    )
  } finally {
    slow.finish()
    await pending
    await Promise.all(slow.retained)
    await slow.service.drain()
  }
})

let quick = await fixture('operator-quick-run')
quick.finish()
let response = await quick.ask('run', { say: 'Do the work.' })
let result = await response.json()
test('a quick connector run still returns its final reply and cancels its response timer', async () => {
  equal(result.text, 'Finished the work.')
  equal(result.status, 'settled')
  equal(result.cost, 0.001)
  equal(quick.time.pending(), 0)
  await quick.time.advance(60_000)
  equal(quick.reports, [])
})
