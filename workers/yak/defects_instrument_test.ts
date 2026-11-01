// Construction, lifecycle and RPC wrappers keep their invocation's reports.
import { equal, test, throws } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { instrument } from './defects-runtime.ts'
import { caught } from './defects.ts'
import {
  behind,
  type Restartable,
  WORKER_VERSION,
  WORKER_VERSION_AT,
} from './running.ts'
import { storeOf } from './door.ts'
import { kvStorage } from './testing.ts'

class Subject {
  constructor(_state: unknown, _env: unknown) {
    caught(Error('constructor failure'), {})
  }
  fetch() {
    caught(Error('lifecycle failure'), {})
    return new Response('answered', { status: 500 })
  }
  fail() {
    throw Error('RPC failure')
  }
}

test('instrumentation reports constructor, lifecycle and escaping RPC failures', async () => {
  let rows: Bundle[] = []
  let env = {
    ERRORS: {
      send: (batch: Bundle[]) => {
        rows.push(...batch)
        return Promise.resolve()
      },
    },
  }
  let Tracked = instrument(Subject)
  let object = new Tracked({}, env)
  equal(object.fetch().status, 500)
  await throws(() => object.fail(), 'RPC failure')
  rows = rows.filter((row) => row.error)
  equal(rows.map((row) => (row.exception as { value: string }).value).sort(), [
    'RPC failure',
    'constructor failure',
    'lifecycle failure',
  ])
  equal(
    rows.map((row) => (row.error as { tags: { request: string } }).tags.request)
      .sort(),
    [
      'Subject constructor',
      'Subject fail',
      'Subject fetch',
    ],
  )
})

// abort can throw before storage's replacement probe notices the shutdown.
// The reset belongs to the caller's retry, even while SELECT and a transaction
// on the retiring object's storage still answer.
class Retiring {
  constructor(private state: Restartable, private env: unknown) {}
  async fetch(req: Request) {
    await behind(
      req.headers,
      { id: 'old', timestamp: '2026-10-12T16:00:00Z' },
      this.state,
    )
    return new Response('answered')
  }
}

test('a deliberate restart is retried without reporting the retiring instance', async () => {
  let rows: Bundle[] = [], attempts = 0
  let env = {
    ERRORS: {
      send: (batch: Bundle[]) => {
        rows.push(...batch)
        return Promise.resolve()
      },
    },
  }
  let state = {
    storage: {
      ...kvStorage(),
      sql: { exec: () => [] },
      transactionSync: <T>(run: () => T) => run(),
    },
    abort: (reason?: string): never => {
      throw new Error(reason)
    },
  }
  let Tracked = instrument(Retiring), old = new Tracked(state, env)
  let ns = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: (req: Request) => {
        attempts++
        req.headers.set(WORKER_VERSION, 'new')
        req.headers.set(WORKER_VERSION_AT, '2026-10-12T16:30:00Z')
        return old.fetch(req)
      },
    }),
  }
  let answer = await storeOf(
    ns,
    'ada/notes',
    undefined,
    () => Promise.resolve(),
  )('/query')
  equal(await answer.text(), 'answered')
  equal(attempts, 2)
  equal(rows.filter((row) => row.error), [])
})
