// A report of the plans alone is each plan limit against its pace.
import { equal, test } from '@yaks/testing'
import { compose } from '@yaks/cli/host'
import { report } from './tools.ts'

test('the plans report is each limit against its pace, a line each', async () => {
  let { graph } = await compose({
    db: ':memory:',
    person: 'owner',
    plugins: ['@yaks/kernel', '@yaks/id', '@yaks/model', '@yaks/spend'],
  }, ['graph'])
  let now = Date.parse('2026-11-10T12:00:00Z')
  equal(
    await report(graph, { plans: true, now }),
    'No plan limit has been read.',
  )
  let limit = (
    alias: string,
    window: number,
    used: number,
    resets: string,
  ) => ({
    entity: { eid: alias },
    rate_limit: { provider: '$p', account: '$a', window, used, resets },
  })
  await graph.apply([
    { entity: { eid: '$p' }, provider: { name: 'claude' } },
    { entity: { eid: '$a' }, account: { home: '/h/.claude', provider: '$p' } },
    limit('$week', 10080, 17.4, '2026-11-17T12:00:00Z'),
    limit('$five', 300, 40, '2026-11-10T14:30:00Z'),
  ])
  equal((await report(graph, { plans: true, now })).split('\n'), [
    'claude week: 17% used, 0% of it gone, resets 2026-11-17 12:00 UTC',
    'claude five hours: 40% used, 50% of it gone, resets 2026-11-10 14:30 UTC',
  ])
})
