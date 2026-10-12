// The service interface freezes instance identity and keeps transient binding
// errors from being mistaken for an acknowledged submission.
import { equal, test, throws } from '@yaks/testing'
import type { Bucket } from '@yaks/blob'
import {
  type Env,
  type FrozenRequest,
  host,
  RELEASE,
  run,
  submit,
} from './worker.ts'
import { activated, reusable } from './wrangler.ts'

let job = {
  call: 'original-ask',
  executor: RELEASE,
  request: `inference/${RELEASE}/original-ask/request`,
  receipt: `inference/${RELEASE}/original-ask/receipt`,
}
let fixture = () => {
  let record: FrozenRequest = {
    call: job.call,
    executor: RELEASE,
    provider: { api: 'openrouter', key: 'sentinel' },
    request: { model: 'example', items: [], tools: [] },
  }
  let objects = new Map([[job.request, JSON.stringify(record)]])
  let created = new Set<string>()
  let env: Env = {
    RECEIPTS: {
      get: (key) => {
        let body = objects.get(key)
        return Promise.resolve(
          body === undefined ? null : {
            arrayBuffer: () =>
              Promise.resolve(new TextEncoder().encode(body).buffer),
          },
        )
      },
      put: (key, body) => {
        objects.set(key, String(body))
        return Promise.resolve()
      },
    } as Pick<Bucket, 'head' | 'get' | 'put'>,
    INFERENCES: {
      create: ({ id }) => {
        if (created.has(id)) return Promise.reject(Error('exists'))
        created.add(id)
        return Promise.resolve({ id })
      },
      get: (id) =>
        Promise.resolve({
          status: () =>
            created.has(id)
              ? Promise.resolve({ status: 'running' })
              : Promise.reject(Error('missing')),
        }),
    },
    KERNEL: {} as NonNullable<Env['KERNEL']>,
  }
  return { env, created, objects }
}

test('repeated Workflow submission keeps the original ask instance', async () => {
  let { env, created } = fixture()
  await submit(env, job)
  await submit(env, job)
  equal([...created], [job.call])
})

test('lost Workflow creation acknowledgement finds the accepted instance', async () => {
  let { env, created } = fixture()
  env.INFERENCES.create = ({ id }) => {
    created.add(id)
    return Promise.reject(Error('lost acknowledgement'))
  }
  await submit(env, job)
  equal([...created], [job.call])
})

test('a published executor release can only reuse its immutable bundle', async () => {
  let hash = 'a'.repeat(64)
  equal(reusable(hash, []), false)
  equal(
    reusable(hash, [{
      annotations: { 'workers/message': `model-bundle:${hash}` },
    }]),
    true,
  )
  await throws(() =>
    reusable('b'.repeat(64), [{
      annotations: { 'workers/message': `model-bundle:${hash}` },
    }])
  )
  await throws(() => reusable(hash, [{}]))
})

test('an executor cannot be published before its receipt host is bound', async () => {
  for (
    let services of [undefined, [], [{ binding: 'KERNEL', service: 'yak' }]]
  ) {
    await throws(() => activated({ services }), 'ModelHost')
  }
  activated({
    services: [{ binding: 'KERNEL', service: 'yak', entrypoint: 'ModelHost' }],
  })
})

test('exhausted Workflow recovery delivers and reports a terminal receipt', async () => {
  let { env, objects } = fixture()
  let completed: string[] = []
  let mediaKey = `inference/${RELEASE}/${job.call}/media`
  objects.set(mediaKey, '{"complete":true,"id":"provider-result"}')
  env.KERNEL!.delivered = (delivered) => {
    equal(delivered, job)
    equal(JSON.parse(objects.get(job.receipt)!).failure.interrupted, true)
    completed.push('delivered')
    return Promise.resolve()
  }
  env.KERNEL!.report = (_job, failure) => {
    equal(failure.reason, 'artifact storage unavailable')
    completed.push('reported')
    return Promise.resolve()
  }
  let receipt = await run(env, job, {
    do: (name, _config, callback) =>
      name === 'generation'
        ? Promise.reject(Error('artifact storage unavailable'))
        : callback(),
  })
  equal(receipt, job.receipt)
  equal(completed, ['delivered', 'reported'])
  equal(objects.get(mediaKey), '{"complete":true,"id":"provider-result"}')
})

test('exhausted delivery reports its failure while retaining the complete answer', async () => {
  let { env, objects } = fixture()
  let saved = {
    call: job.call,
    reply: { id: 'answer', model: 'example', items: [] },
  }
  objects.set(job.receipt, JSON.stringify(saved))
  let reported: string[] = []
  env.KERNEL!.report = (_job, failure) => {
    reported.push(failure.reason)
    return Promise.resolve()
  }
  await throws(() =>
    run(env, job, {
      do: (name, _config, callback) =>
        name === 'generation'
          ? Promise.resolve(job.receipt) as ReturnType<typeof callback>
          : name === 'delivery'
          ? Promise.reject(Error('kernel unavailable'))
          : callback(),
    }), 'kernel unavailable')
  equal(reported, ['kernel unavailable'])
  equal(JSON.parse(objects.get(job.receipt)!), saved)
})

test('the RPC submission result preserves a budget refusal as a local ModelError', async () => {
  let { env } = fixture()
  env.KERNEL!.claim = () =>
    Promise.resolve({
      refused: { code: 'limit', reason: 'Account budget spent' },
    })
  await throws(() => host(env).claim(job), /Account budget spent/)
  env.KERNEL!.claim = () => Promise.resolve({ claimed: false })
  equal(await host(env).claim(job), false)
})
