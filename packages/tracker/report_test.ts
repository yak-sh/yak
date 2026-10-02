import { equal, ok, test } from '@yaks/testing'
import { CallError } from '@yaks/tools'
import { Refused } from '@yaks/graph'
import { capture, caught, post, queue, report, spool } from './report.ts'
import { comp } from './model.ts'
import { fixture } from './fixture_test.ts'
import { intake } from './service.ts'

test('caught omits refusals and report survives a failing sink and fallback', async () => {
  let called = 0
  let context = {
    sink: () => {
      called++
    },
  }
  await caught(new CallError('input', 'no'), context)
  await caught(new Refused('no'), context)
  equal(called, 0)
  await caught(new Error('broken'), context)
  equal(called, 1)
  await report(new Error('broken'), {
    sink: () => {
      throw Error('offline')
    },
    fallback: () => {
      throw Error('still offline')
    },
  })
})

test('capture preserves provenance, scrubs request secrets and bounds breadcrumbs', () => {
  let rows = capture(new TypeError('broken'), {
    sink: () => {},
    eid: 'error',
    actor: { by: 'person', via: 'client' },
    during: { request: 'request', app: 'app' },
    request: {
      entity: { eid: 'request' },
      request: {
        method: 'POST',
        url: 'https://host/path?token=secret',
        headers: { authorization: 'secret' },
        body: 'secret',
      },
    },
    tags: { arguments: ['secret'], step: 'read' },
    breadcrumbs: Array.from({ length: 25 }, (_, i) => ({
      at: String(i),
      category: 'fetch',
      message: '/api/query',
    })),
  })
  equal(rows[0].$actor, { by: 'person', via: 'client' })
  equal(comp(rows[0], 'exception').type, 'TypeError')
  equal(comp(rows[0], 'error').tags, { step: 'read' })
  equal(comp(rows[1], 'request').url, 'https://host/path')
  ok(!comp(rows[1], 'request').headers && !comp(rows[1], 'request').body)
  equal((comp(rows[0], 'breadcrumbs').items as unknown[]).length, 20)
})

test('queue, spool and post transport the same reporter eids', async () => {
  let rows = capture('failed', { sink: () => {}, eid: 'same' })
  let seen: unknown[] = []
  await queue({
    send: (body) => {
      seen.push(body)
      return Promise.resolve()
    },
  })(rows)
  await spool((line) => {
    seen.push(JSON.parse(line))
  })(rows)
  await post('https://host/report', (_url, init) => {
    seen.push(JSON.parse(String(init?.body)))
    return Promise.resolve(new Response())
  })(rows)
  equal(seen, [rows, rows, rows])
})

test('spool intake acknowledges only admitted records and replay counts once', async () => {
  let g = fixture()
  let rows = capture('failed', { sink: () => {}, eid: 'same' })
  let acks = 0
  let source = async function* () {
    yield {
      rows,
      ack: () => {
        acks++
      },
    }
  }
  await intake(g, source)
  await intake(g, source)
  equal(acks, 2)
  equal((await g.read('.error')).length, 1)
})
