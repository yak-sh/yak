/** Worker pressure includes all worker threads and children in its cgroup. */
import { equal, test, throws } from '@yaks/testing'
import { run, suite, usage } from './worker-health.ts'

test('worker CPU reads total usage, not only its main thread', () => {
  equal(usage('usage_usec 102\nuser_usec 73\nsystem_usec 29\n'), 102)
  throws(() => usage('user_usec 73\n'))
})

test('live worker occupation is diagnostic even when a check is requested', async () => {
  let wrote: string[] = []
  let result = await run({
    mode: 'check',
    figure: 'cpu',
    output: 'worker-health.results.json',
    baseline: 'worker-health.baseline.json',
    host: () => ({
      config: {},
      configURL: null,
      commit: null,
      runtime: 'test',
      cpu: 'test',
      load: [],
    }),
    files: {
      read: () => {
        throw new Error('live worker occupation has no baseline')
      },
      write: (path: string) => {
        wrote.push(path)
        return Promise.resolve()
      },
    },
  }, { ...suite(), collect: () => ({ 'workers/cpu': { value: 930807 } }) })
  equal(result.verdict, 'measured')
  equal(result.benches[0].median, 930807)
  equal(wrote, ['worker-health.results.json'])
})
