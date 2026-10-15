import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import type { MediaReceipt, Request } from '@yaks/model'
import type { ArtifactStore } from '@yaks/blob'
import { responses } from './mod.ts'

let request = (model: string): Request => ({
  call: 'original-ask',
  model,
  modalities: ['audio'],
  items: [{ kind: 'user', text: 'A tune' }],
  tools: [],
})
let stream = (events: unknown[]) =>
  new Response(
    events.map((value) => 'data: ' + JSON.stringify(value) + '\n\n').join('') +
      'data: [DONE]\n\n',
  )

let unavailable = new Error('storage unavailable')
let bytes = new TextEncoder().encode('ID3tune')

// A media model whose one paid answer is checkpointed, and whose artifact
// storage fails until `heal()`. Every step it takes is said in `steps`.
let rig = (speech: boolean) => {
  let name = speech ? 'vendor/speech' : 'vendor/music'
  let saved: MediaReceipt | undefined
  let steps: string[] = [], fail = true
  let at = { posts: 0 }
  let storage: ArtifactStore = (bytes, mediaType) =>
    Promise.resolve({
      address: 'fixture',
      size: bytes.length,
      media_type: mediaType,
    })
  let model = responses({
    key: () => 'fixture',
    speech: speech ? [name] : [],
    media: {
      store: (...args: Parameters<typeof storage>) => {
        steps.push('delivery')
        if (fail) return Promise.reject(unavailable)
        return storage(...args)
      },
    },
    receipts: {
      read: () => Promise.resolve(saved),
      save: (receipt: MediaReceipt) => {
        saved = structuredClone(receipt)
        steps.push(receipt.complete === false ? 'partial' : 'receipt')
        return Promise.resolve()
      },
    },
    fetch: (url: string | URL | globalThis.Request) => {
      if (String(url).includes('/generation?')) {
        steps.push('cost')
        return Promise.resolve(Response.json({ data: { total_cost: 0.04 } }))
      }
      at.posts++
      steps.push('post')
      return Promise.resolve(
        speech
          ? new Response(bytes, {
            headers: { 'x-generation-id': 'generation' },
          })
          : stream([{
            id: 'generation',
            choices: [{ delta: { audio: { data: btoa('ID3tune') } } }],
          }]),
      )
    },
  })
  let ask = () =>
    model({
      ...request(name),
      onSubmit: async () => {
        await Promise.resolve()
        steps.push('submit')
      },
      onAck: async (mark: unknown) => {
        await Promise.resolve()
        assertEquals(mark, { openrouter: { response_id: 'generation' } })
        steps.push('ack')
      },
      onReceipt: (receipt: MediaReceipt) => {
        // What is kept by now is what is handed on, compared as the JSON it
        // is: a structural compare of a whole receipt costs most of a test.
        assertEquals(JSON.stringify(saved), JSON.stringify(receipt))
        steps.push('checkpoint')
        return Promise.resolve()
      },
    })
  let heal = () => void (fail = false)
  return { model, ask, heal, steps, at, saved: () => saved }
}

for (let speech of [false, true]) {
  let kind = speech ? 'speech' : 'chat'
  test(`OpenRouter ${kind} checkpoints before paid submission`, async () => {
    let r = rig(speech)
    await assertRejects(r.ask, Error, 'Could not persist generated media')
    assertEquals(r.steps.slice(0, 3), ['submit', 'post', 'ack'])
    assertEquals(r.saved()?.complete, true)
    assertEquals(r.saved()?.provider, 'openrouter')
    assertEquals(r.steps.at(-1), 'delivery')
  })

  // A delivery that failed after its receipt was kept.
  let failed = rig(speech)
  await failed.ask().catch(() => {})
  test(`OpenRouter ${kind} recovers failed delivery without POST`, async () => {
    failed.heal()
    let reply = await failed.model.recover!('original-ask')
    assertEquals(reply.id, 'generation')
    assertEquals(reply.artifacts?.[0].size, bytes.length)
    assertEquals(reply.cost, 0.04)
    assertEquals(failed.at.posts, 1)
    assertEquals(await failed.model.recover!('original-ask'), reply)
    assertEquals(failed.at.posts, 1)
  })
}

test('OpenRouter awaits first acknowledgement and keeps unfinished media private', async () => {
  let saved: MediaReceipt | undefined
  let text = '', delivered = 0, complete = 0
  let model = responses({
    key: () => 'fixture',
    speech: [],
    media: {
      store: () => {
        delivered++
        return Promise.reject(new Error('must not deliver'))
      },
    },
    receipts: {
      read: () => Promise.resolve(saved),
      save: (receipt) => {
        saved = structuredClone(receipt)
        return Promise.resolve()
      },
    },
    fetch: () =>
      Promise.resolve(stream([
        {
          id: 'partial-generation',
          choices: [{ delta: { content: 'partial', audio: { data: 'SUQz' } } }],
        },
        { error: { code: 'interrupted', message: 'lost stream' } },
      ])),
  })
  let ack = false
  await assertRejects(
    () =>
      model({
        ...request('vendor/music'),
        onAck: async () => {
          await Promise.resolve()
          ack = true
        },
        onText: (delta) => {
          assertEquals(ack, true)
          text += delta.text
        },
        onMedia: () => {
          complete++
          return Promise.resolve()
        },
      }),
    Error,
    'lost stream',
  )
  assertEquals(text, 'partial')
  assertEquals(saved?.id, 'partial-generation')
  assertEquals(saved?.complete, false)
  assertEquals(saved?.provider, 'openrouter')
  await assertRejects(() => model.recover!('original-ask'))
  assertEquals([delivered, complete], [0, 0])
})

test('OpenRouter Responses translates the first provider acknowledgement and recovers its receipt', async () => {
  let saved: MediaReceipt | undefined
  let ack = false, posts = 0
  let model = responses({
    speech: [],
    key: () => 'fixture',
    receipts: {
      read: () => Promise.resolve(saved),
      save: (receipt) => {
        saved = structuredClone(receipt)
        return Promise.resolve()
      },
    },
    fetch: () => {
      posts++
      return Promise.resolve(stream([
        { type: 'response.created', response: { id: 'response-1' } },
        {
          type: 'response.output_text.delta',
          item_id: 'message',
          delta: 'Hello',
        },
        {
          type: 'response.completed',
          response: {
            id: 'response-1',
            model: 'vendor/text',
            status: 'completed',
            output: [{
              type: 'message',
              id: 'message',
              content: [{ type: 'output_text', text: 'Hello' }],
            }],
          },
        },
      ]))
    },
  })
  let reply = await model({
    ...request('vendor/text'),
    modalities: ['text'],
    onAck: async (mark) => {
      await Promise.resolve()
      assertEquals(mark, { openrouter: { response_id: 'response-1' } })
      ack = true
    },
    onText: () => assertEquals(ack, true),
  })
  assertEquals(saved?.id, 'response-1')
  assertEquals(saved?.provider, 'openrouter')
  assertEquals(await model.recover!('original-ask'), reply)
  assertEquals(posts, 1)
})

for (let endpoint of ['chat', 'speech', 'responses']) {
  test(`OpenRouter ${endpoint} refuses paid submission when its durable checkpoint fails`, async () => {
    let posts = 0
    let name = endpoint == 'speech' ? 'vendor/speech' : 'vendor/model'
    let model = responses({
      key: () => 'fixture',
      speech: endpoint == 'speech' ? [name] : [],
      media: { store: () => Promise.reject(new Error('unused')) },
      fetch: () => {
        posts++
        return Promise.reject(new Error('must not submit'))
      },
    })
    await assertRejects(
      () =>
        model({
          ...request(name),
          modalities: endpoint == 'responses' ? ['text'] : ['audio'],
          onSubmit: () => Promise.reject(new Error('checkpoint failed')),
        }),
      Error,
      'checkpoint failed',
    )
    assertEquals(posts, 0)
  })
}

for (let speech of [false, true]) {
  test(`OpenRouter ${speech ? 'speech' : 'chat'} stops delivery and billing when the complete receipt cannot be saved`, async () => {
    let effects = 0
    let model = responses({
      key: () => 'fixture',
      speech: speech ? ['vendor/speech'] : [],
      media: {
        store: () => {
          effects++
          return Promise.reject(new Error('must not deliver'))
        },
      },
      receipts: {
        read: () => Promise.resolve(undefined),
        save: (receipt) =>
          receipt.complete
            ? Promise.reject(new Error('receipt failed'))
            : Promise.resolve(),
      },
      fetch: (url) => {
        if (String(url).includes('/generation?')) effects++
        return Promise.resolve(
          speech
            ? new Response('unvalidated bytes', {
              headers: { 'x-generation-id': 'generation' },
            })
            : stream([{
              id: 'generation',
              choices: [{ delta: { audio: { data: 'unvalidated bytes' } } }],
            }]),
        )
      },
    })
    await assertRejects(
      () =>
        model(request(
          speech ? 'vendor/speech' : 'vendor/music',
        )),
      Error,
      'receipt failed',
    )
    assertEquals(effects, 0)
  })
}

test('OpenRouter audio EOF without completion retains a partial receipt', async () => {
  let saved: MediaReceipt | undefined, delivered = 0
  let model = responses({
    key: () => 'fixture',
    speech: [],
    media: {
      store: () => {
        delivered++
        return Promise.reject(new Error('must not deliver'))
      },
    },
    receipts: {
      read: () => Promise.resolve(saved),
      save: (receipt) => {
        saved = receipt
        return Promise.resolve()
      },
    },
    fetch: () =>
      Promise.resolve(
        new Response(
          'data: ' + JSON.stringify({
            id: 'cut-off',
            choices: [{ delta: { audio: { data: btoa('ID3partial') } } }],
          }) + '\n\n',
        ),
      ),
  })
  await assertRejects(
    () => model(request('vendor/music')),
    Error,
    'ended before completion',
  )
  assertEquals(saved?.complete, false)
  assertEquals(saved?.provider, 'openrouter')
  assertEquals(delivered, 0)
})
