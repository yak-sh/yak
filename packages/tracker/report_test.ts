import { equal, ok, test, throws } from '@yaks/testing'
import { CallError } from '@yaks/tools'
import { Refused } from '@yaks/graph'
import {
  capture,
  caught,
  origin,
  post,
  queue,
  report,
  spool,
} from './report.ts'
import { comp, str, title } from './model.ts'
import { faultOf } from './fault.ts'
import { fixture } from './fixture_test.ts'
import { intake } from './service.ts'
import { runs as mail } from '@yaks/mail/tools'

let g = fixture()
test('a tool refusing bad input does not report a failure', async () => {
  let error = await throws(() =>
    mail().mail_send({
      entity: { eid: 'send' },
      call: {
        args: { to: 'reader@example.org', subject: 'Hello', body: 'Hi' },
      },
    }, g)
  )
  let failures: unknown[] = []
  await caught(error, {
    sink: (rows) => {
      failures.push(...rows)
    },
  })
  equal(failures, [])
  ok(error instanceof CallError)
})

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

test('a thrown object reports its contents and the place that reported it', () => {
  let reportedHere = (value: unknown) => capture(value, { sink: () => {} })[0]
  let refusal = reportedHere({ error: 'Refused', message: 'bug.fault moved' })
  let plain = reportedHere({ id: 7 })
  equal(title(refusal), 'Refused: bug.fault moved')
  equal(title(plain), 'Object: {"id":7}')
  ok(str(comp(refusal, 'exception').stack).includes('reportedHere'))
  ok(faultOf(refusal) != faultOf(plain))
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

let request = new Request('https://app.test/api/query?token=secret', {
  method: 'POST',
  headers: { authorization: 'secret' },
  body: 'secret',
})
let failure = Error('internal error; reference = opaque')
void failure.stack
test('runtime reports retain script, release, entrypoint and a scrubbed request', () => {
  for (let http of [request, undefined]) {
    let rows = capture(failure, {
      ...origin('yak', 'release-id', 'Store.fetch', http),
      sink: () => {},
    })
    equal(comp(rows[0], 'error').tags, {
      script: 'yak',
      version: 'release-id',
      entrypoint: 'Store.fetch',
    })
    equal(comp(rows[0], 'error').commit, 'release-id')
    equal(comp(rows[0], 'during').request, rows[1].entity.eid)
    equal(comp(rows[1], 'request'), {
      route: 'Store.fetch',
      method: http ? 'POST' : undefined,
      url: http ? 'https://app.test/api/query' : undefined,
      status: undefined,
      ms: undefined,
      agent: undefined,
    })
  }
})
