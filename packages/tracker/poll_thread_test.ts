import { equal, test } from '@yaks/testing'
import { pollThread } from './poll_thread.ts'

let params = new URLSearchParams({ limit: '100', query: '.bug' })

test('closing poll doors rejects reads and marks without starting a worker', async () => {
  let closed = pollThread({ url: 'http://127.0.0.1:1', secret: 'test-only' })
  closed.close()
  equal(
    await closed.bugs(params, new AbortController().signal).catch(String),
    'Error: Remote tracker poll is closed',
  )
  equal(
    await closed.mark('bug', 'archived', {}).catch(String),
    'Error: Remote tracker poll is closed',
  )
})
