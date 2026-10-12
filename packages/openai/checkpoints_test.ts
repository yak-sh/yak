import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import type { MediaReceipt, MediaReceipts, Request } from '@yaks/model'
import { responses } from './responses.ts'
import { ResponseError, transport } from './transport.ts'

let sse = (...events: unknown[]) =>
  new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
  )
let credential = () => ({ token: 'private', base: 'https://example.invalid' })
let png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG7cAAAAASUVORK5CYII='
let image = {
  type: 'image_generation_call',
  id: 'image-1',
  status: 'completed',
  result: png,
}

test('provider submission, first acknowledgement and complete receipt gate delivery', async () => {
  let trace: string[] = [], receipts: MediaReceipt[] = []
  let submitted = Promise.withResolvers<void>()
  let acknowledged = Promise.withResolvers<void>()
  let saved = Promise.withResolvers<void>()
  let submit = Promise.withResolvers<void>()
  let ack = Promise.withResolvers<void>()
  let receipt = Promise.withResolvers<void>()
  let model = responses({
    credential,
    web: false,
    images: {
      store: (bytes, media_type) => {
        trace.push('artifact')
        return Promise.resolve({
          address: 'artifact',
          size: bytes.length,
          media_type,
        })
      },
    },
    fetch: () => {
      trace.push('post')
      return Promise.resolve(sse(
        { type: 'response.created', response: { id: 'response-1' } },
        { type: 'response.in_progress', response: { id: 'response-1' } },
        { type: 'response.output_text.delta', item_id: 'm', delta: 'hello' },
        { type: 'response.output_item.done', item: image },
        {
          type: 'response.completed',
          response: {
            id: 'response-1',
            model: 'served',
            status: 'completed',
            usage: { cost: 0.25 },
          },
        },
      ))
    },
  })
  let req: Request = {
    call: 'original-ask',
    model: 'requested',
    items: [],
    tools: [],
    onSubmit: async () => {
      trace.push('submit')
      submitted.resolve()
      await submit.promise
    },
    onAck: async (mark) => {
      assertEquals(mark, { openai: { response_id: 'response-1' } })
      trace.push('ack')
      acknowledged.resolve()
      await ack.promise
    },
    onText: () => trace.push('text'),
    onReceipt: async (value) => {
      if (value.complete === false) return
      trace.push('receipt')
      receipts.push(value)
      saved.resolve()
      await receipt.promise
    },
  }
  let pending = model(req)
  // An implementation that ignores a hook must fail instead of hanging.
  await Promise.race([submitted.promise, pending])
  assertEquals(trace, ['submit'])
  submit.resolve()
  await Promise.race([acknowledged.promise, pending])
  assertEquals(trace, ['submit', 'post', 'ack'])
  ack.resolve()
  await Promise.race([saved.promise, pending])
  assertEquals(trace, ['submit', 'post', 'ack', 'text', 'receipt'])
  assertEquals(receipts[0].call, 'original-ask')
  assertEquals(receipts[0].id, 'response-1')
  assertEquals(receipts[0].model, 'served')
  assertEquals(receipts[0].provider, 'openai')
  assertEquals([receipts[0].cost, receipts[0].costReported], [0.25, true])
  assertEquals((receipts[0].input as { model: string }).model, 'requested')
  assertEquals((receipts[0].response as { items: unknown[] }).items, [image])
  receipt.resolve()
  assertEquals((await pending).artifacts?.length, 1)
  assertEquals(trace.at(-1), 'artifact')
})

test('a rejected submission checkpoint prevents a paid POST', async () => {
  let posts = 0
  let model = responses({
    credential,
    fetch: () => {
      posts++
      return Promise.resolve(new Response('', { status: 503 }))
    },
    pause: () => Promise.resolve(),
  })
  await assertRejects(
    () =>
      model({
        model: 'm',
        items: [],
        tools: [],
        onSubmit: () => Promise.reject(new Error('already submitted')),
      }),
    Error,
    'already submitted',
  )
  assertEquals(posts, 0)
})

test('durable submission suppresses paid retries including credential refresh', async () => {
  for (let status of [401, 503, 200]) {
    let posts = 0, refreshed = 0, submitted = 0
    let client = transport({
      credentials: {
        get: credential,
        refresh: () => {
          refreshed++
          return credential()
        },
      },
      fetch: () => {
        posts++
        return Promise.resolve(new Response('', { status }))
      },
      pause: () => Promise.resolve(),
    })
    let run = {
      submit: () => {
        submitted++
        return Promise.resolve()
      },
    }
    await assertRejects(() => client.run({ model: 'm', input: [] }, run))
    assertEquals([posts, refreshed, submitted], [1, 0, 1])
  }
})

test('private Responses receipts recover failed artifact delivery without another POST', async () => {
  let saved: MediaReceipt | undefined
  let receipts: MediaReceipts = {
    read: () => Promise.resolve(saved),
    save: (receipt) => {
      saved = receipt
      return Promise.resolve()
    },
  }
  let posts = 0, stores = 0
  let model = responses({
    credential,
    provider: 'openrouter',
    receipts,
    shape: (request) => ({ ...request, custom: 'wire shape' }),
    images: {
      store: (bytes, media_type) => {
        stores++
        if (stores == 1) throw new Error('storage unavailable')
        return Promise.resolve({
          address: 'artifact',
          media_type,
          size: bytes.length,
        })
      },
    },
    fetch: () => {
      posts++
      return Promise.resolve(sse({
        type: 'response.completed',
        response: {
          id: 'response-1',
          model: 'm',
          status: 'completed',
          output: [image],
        },
      }))
    },
  })
  await assertRejects(() =>
    model({
      call: 'original',
      onAck: (mark) => {
        assertEquals(mark, { openrouter: { response_id: 'response-1' } })
        return Promise.resolve()
      },
      model: 'm',
      items: [],
      tools: [],
    })
  )
  assertEquals([posts, stores, saved?.complete], [1, 1, true])
  assertEquals(saved?.provider, 'openrouter')
  assertEquals((saved?.input as { custom: string }).custom, 'wire shape')
  let reply = await model.recover!('original')
  assertEquals(reply.artifacts?.length, 1)
  assertEquals(model.mark!(reply).openrouter.response_id, 'response-1')
  assertEquals(await model.recover!('original'), reply)
  assertEquals([posts, stores], [1, 2])
})

test('an awaited event checkpoint failure is never retried as a provider failure', async () => {
  let posts = 0
  let failure = new ResponseError('transport', 'receipt store unavailable')
  let client = transport({
    credentials: { get: credential },
    fetch: () => {
      posts++
      return Promise.resolve(sse({ type: 'response.created' }))
    },
    pause: () => Promise.resolve(),
  })
  let caught = await assertRejects(() =>
    client.run({ model: 'm', input: [] }, {
      event: () => Promise.reject(failure),
    })
  )
  assertEquals(caught, failure)
  assertEquals(posts, 1)
})

test('a complete receipt survives a broken stream after the terminal frame', async () => {
  let saved: MediaReceipt | undefined
  let posts = 0
  let model = responses({
    credential,
    receipts: {
      read: () => Promise.resolve(saved),
      save: (receipt) => {
        saved = receipt
        return Promise.resolve()
      },
    },
    fetch: () => {
      posts++
      return Promise.resolve(
        new Response(
          'data: ' + JSON.stringify({
            type: 'response.completed',
            response: {
              id: 'r',
              model: 'm',
              status: 'completed',
              output: [{
                type: 'message',
                content: [{ type: 'output_text', text: 'saved answer' }],
              }],
            },
          }) + '\n\ndata: {broken}\n\n',
        ),
      )
    },
  })
  await assertRejects(() =>
    model({ call: 'ask', model: 'm', items: [], tools: [] })
  )
  assertEquals((await model.recover!('ask')).items, [{
    kind: 'assistant',
    text: 'saved answer',
  }])
  assertEquals(posts, 1)
})

test('an interrupted image stream retains private partial output without publishing it', async () => {
  let saved: MediaReceipt | undefined
  let published = 0, complete = 0
  let model = responses({
    credential,
    receipts: {
      read: () => Promise.resolve(saved),
      save: (receipt) => {
        saved = receipt
        return Promise.resolve()
      },
    },
    images: {
      store: () => {
        published++
        return Promise.reject(new Error('must not publish'))
      },
    },
    fetch: () =>
      Promise.resolve(sse(
        { type: 'response.created', response: { id: 'r' } },
        {
          type: 'response.image_generation_call.partial_image',
          partial_image_b64: png,
        },
      )),
  })
  await assertRejects(() =>
    model({
      call: 'ask',
      model: 'm',
      items: [],
      tools: [],
      onMedia: () => {
        complete++
        return Promise.resolve()
      },
    })
  )
  assertEquals(saved?.complete, false)
  assertEquals(saved?.provider, 'openai')
  assertEquals(
    (saved?.response as { event: { partial_image_b64: string } }).event
      .partial_image_b64,
    png,
  )
  await assertRejects(() => model.recover!('ask'), Error, 'incomplete')
  assertEquals([published, complete], [0, 0])
})
