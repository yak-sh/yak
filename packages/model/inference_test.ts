// Exercise recovery through the host interface: lost acknowledgements and
// failed delivery cannot purchase another answer for the same ask.
import { equal, test, throws } from '@yaks/testing'
import {
  infer,
  type InferenceHost,
  type InferenceReceipt,
  inferenceReply,
} from './inference.ts'
import {
  type Mark,
  type Model,
  ModelError,
  type Reply,
  type Request,
} from './mod.ts'

let job = {
  call: 'ask',
  executor: 'release',
  request: 'request',
  receipt: 'receipt',
}
let reply: Reply = {
  id: 'answer',
  model: 'example',
  items: [{ kind: 'assistant', text: 'Hello' }],
}
let submitting = (req: Request) =>
  (req as Request & { onSubmit: () => Promise<void> }).onSubmit()

let fixture = () => {
  let state = {
    submitted: false,
    purchases: 0,
    saved: undefined as InferenceReceipt | undefined,
  }
  let host: InferenceHost = {
    read: () => Promise.resolve(state.saved),
    save: (_job, receipt) => {
      state.saved = receipt
      return Promise.resolve()
    },
    request: () => Promise.resolve({ model: 'example', items: [], tools: [] }),
    model: () =>
      Promise.resolve(async (req: Request) => {
        await submitting(req)
        state.purchases++
        return reply
      }),
    submitted: () => Promise.resolve(state.submitted),
    claim: () => {
      let fresh = !state.submitted
      state.submitted = true
      return Promise.resolve(fresh)
    },
    checkpoint: () => Promise.resolve(),
  }
  return { state, host }
}
let rejects = async (fn: () => Promise<unknown>) => {
  try {
    await fn()
  } catch {
    return
  }
  throw Error('expected rejection')
}

test('a failed receipt save never purchases another answer', async () => {
  let { host, state } = fixture()
  let save = host.save
  host.save = () => Promise.reject(Error('lost storage'))
  await rejects(() => infer(job, host))
  host.save = save
  equal(await infer(job, host), job.receipt)
  equal(state.purchases, 1)
  equal(state.saved?.failure?.interrupted, true)
  await throws(() => inferenceReply(state.saved!), /inference_interrupted/)
})

test('a lost submission acknowledgement cannot start a provider call', async () => {
  let { host, state } = fixture()
  let claim = host.claim
  host.claim = async (job) => {
    await claim(job)
    throw Error('lost acknowledgement')
  }
  await rejects(() => infer(job, host))
  host.claim = claim
  await infer(job, host)
  equal(state.purchases, 0)
  equal(state.saved?.failure?.interrupted, true)
})

test('provider receipt recovery and answer delivery keep the original ask', async () => {
  let { host, state } = fixture()
  let deliveries = 0
  let model: Model = Object.assign(async (req: Request) => {
    await submitting(req)
    state.purchases++
    throw Error('delivery failed after complete provider receipt')
  }, {
    recover: (call: string) => {
      equal(call, job.call)
      deliveries++
      return Promise.resolve(reply)
    },
  })
  host.model = () => Promise.resolve(model)
  host.recoverable = () => Promise.resolve(true)
  await rejects(() => infer(job, host))
  await infer(job, host)
  equal(inferenceReply(state.saved!), reply)
  await infer(job, host)
  equal([state.purchases, deliveries], [1, 1])
})

test('provider transport retries cannot reuse the paid submission claim', async () => {
  let { host, state } = fixture()
  host.model = () =>
    Promise.resolve(async (req: Request) => {
      let submit = (req as Request & { onSubmit: () => Promise<void> }).onSubmit
      await submit()
      state.purchases++
      await submit()
      state.purchases++
      return reply
    })
  await infer(job, host)
  equal(state.purchases, 1)
  equal(state.saved?.failure?.interrupted, true)
})

test('an early provider acknowledgement is awaited before completing a receipt', async () => {
  let { host, state } = fixture()
  let marks: Mark[] = []
  host.checkpoint = (_job, mark) => {
    marks.push(mark)
    return Promise.resolve()
  }
  host.model = () =>
    Promise.resolve(async (req: Request) => {
      await (req as Request & { onAck: (mark: Mark) => Promise<void> }).onAck({
        provider: { response_id: 'answer' },
      })
      equal(marks.length, 1)
      return reply
    })
  await infer(job, host)
  equal(state.saved?.reply, reply)
})

test('free provider preparation can retry before claiming paid submission', async () => {
  let { host, state } = fixture()
  let model = await host.model(job)
  host.model = () =>
    Promise.resolve(() => Promise.reject(Error('catalog unavailable')))
  await rejects(() => infer(job, host))
  equal([state.submitted, state.saved, state.purchases], [false, undefined, 0])
  host.model = () => Promise.resolve(model)
  await infer(job, host)
  equal(state.purchases, 1)
})

test('an unexpected provider failure retains its reason and exception', async () => {
  let { host, state } = fixture()
  host.model = () =>
    Promise.resolve(async (req) => {
      await submitting(req)
      throw new TypeError('receipt decoding failed')
    })
  await infer(job, host)
  equal(state.saved?.failure?.reason, 'receipt decoding failed')
  equal(state.saved?.failure?.exception?.type, 'TypeError')
})

test('a budget refusal before paid submission keeps a final unsubmitted outcome', async () => {
  let { host, state } = fixture()
  host.claim = () =>
    Promise.reject(new ModelError('limit', 'Account budget spent'))
  await infer(job, host)
  await infer(job, host)
  equal([state.submitted, state.purchases], [false, 0])
  equal(state.saved?.failure, {
    code: 'limit',
    interrupted: false,
    reason: 'Account budget spent',
  })
  await throws(() => inferenceReply(state.saved!), /Account budget spent/)
})
