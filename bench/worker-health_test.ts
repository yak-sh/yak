/** Worker pressure includes all worker threads and children in its cgroup. */
import { equal, test, throws } from '@yaks/testing'
import { usage } from './worker-health.ts'

test('worker CPU reads total usage, not only its main thread', () => {
  equal(usage('usage_usec 102\nuser_usec 73\nsystem_usec 29\n'), 102)
  throws(() => usage('user_usec 73\n'))
})
