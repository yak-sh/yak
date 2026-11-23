import { equal, test } from '@yaks/testing'
import { alarmKills, MARK } from './alarm-logs.ts'

test('a killed alarm names only jobs still active in its own request', async () => {
  let request = (requestId: string) => ({ requestId, traceId: requestId })
  let timestamp = Date.parse('2026-11-23T17:00:58Z')
  let event = {
    timestamp,
    $metadata: request('killed'),
    $workers: {
      durableObjectId: 'store',
      outcome: 'exceededMemory',
      scriptVersion: { id: 'version' },
    },
  }
  let mark = (
    requestId: string,
    job: string,
    phase: 'start' | 'end' = 'start',
    id = job,
  ) => ({
    timestamp,
    $metadata: request(requestId),
    source: { message: MARK, job, mark: id, phase },
  })
  let answers = [[event], [
    mark('killed', 'effects'),
    mark('retry', 'versions'),
    mark('killed', 'wakes', 'end'),
    mark('killed', 'wakes'),
    mark('killed', 'effects', 'end', 'other batch'),
  ]]
  let kills = await alarmKills({
    account: 'account',
    script: 'yak',
    token: 'token',
    since: '2026-11-23T17:00:00Z',
    until: '2026-11-23T17:02:00Z',
  }, () =>
    Promise.resolve(Response.json({
      success: true,
      result: { events: { events: answers.shift() } },
    })))
  equal(kills, [{
    object: 'store',
    minute: Date.parse('2026-11-23T17:00:00Z'),
    version: 'version',
    status: 'exceededMemory',
    jobs: ['effects'],
    trace: 'killed',
  }])
})
