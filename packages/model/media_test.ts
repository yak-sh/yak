// A partial recording is preserved for diagnosis, never delivered as finished.
import { assertEquals, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { memoryBlobs } from '@yaks/blob'
import {
  type MediaReceipt,
  mediaReceipts,
  receivedMedia,
  recoveredMedia,
} from './mod.ts'

let boundedRecords = (limit = 256) => {
  let rows = new Map<string, Partial<MediaReceipt>>()
  return {
    rows,
    read: (call: string) => Promise.resolve(rows.get(call)),
    update: async <T>(
      call: string,
      fn: (record: Partial<MediaReceipt>) => Promise<T>,
    ): Promise<T> => {
      let record = { ...rows.get(call) }
      let result = await fn(record)
      if (JSON.stringify(record).length > limit) {
        throw new Error('record too large')
      }
      rows.set(call, record)
      return result
    },
  }
}

test('private payload storage roundtrips output through bounded records', async () => {
  let records = boundedRecords()
  let receipt: MediaReceipt = {
    call: 'ask',
    id: 'generation',
    model: 'music',
    input: {},
    response: { audio: 'QUJD'.repeat(128) },
  }
  let options = [records, memoryBlobs()] as const
  let store = mediaReceipts(...options)
  await store.save(receipt)
  assertEquals(await store.read('ask'), receipt)
  assertEquals(JSON.stringify(records.rows.get('ask')).length < 256, true)
})

test('inline receipts remain readable and convert during delivery recovery', async () => {
  let records = boundedRecords()
  let store = mediaReceipts(records, memoryBlobs())
  let legacy = {
    call: 'old',
    id: 'generation',
    model: 'music',
    input: {},
    response: {},
  }
  records.rows.set('old', legacy)
  let reply = { id: 'generation', model: 'music', items: [] }
  assertEquals(
    await recoveredMedia('old', store, (saved) => {
      assertEquals(saved, legacy)
      return Promise.resolve(reply)
    }),
    reply,
  )
  assertEquals(await store.read('old'), { ...legacy, reply })
})

test('private receipt storage refuses another provider id on the original call', async () => {
  let records = boundedRecords()
  let store = mediaReceipts(records, memoryBlobs())
  let receipt = {
    call: 'ask',
    id: 'generation',
    model: 'music',
    input: {},
    response: {},
  }
  await store.save(receipt)
  await assertRejects(
    () => store.save({ ...receipt, id: 'another-generation' }),
    Error,
    'already has',
  )
  assertEquals(await store.read('ask'), receipt)
})

test('private payload failures cannot publish a pointer or deliver corrupted output', async () => {
  let records = boundedRecords()
  let receipt = { call: 'ask', id: 'r', model: 'm', input: {}, response: {} }
  let blobs = memoryBlobs()
  let store = mediaReceipts(records, { ...blobs, put: () => {} })
  await assertRejects(() => store.save(receipt), Error, 'did not keep')
  assertEquals(records.rows.size, 0)
  store = mediaReceipts(records, blobs)
  await store.save(receipt)
  let corrupt = mediaReceipts(records, {
    ...blobs,
    get: () => new TextEncoder().encode('{}'),
  })
  await assertRejects(
    () =>
      recoveredMedia(
        'ask',
        corrupt,
        () => Promise.reject(new Error('must not deliver')),
      ),
    Error,
    'missing or corrupt',
  )
  let missing = mediaReceipts(records, memoryBlobs())
  await assertRejects(() => missing.read('ask'), Error, 'missing or corrupt')
  assertEquals(await store.read('ask'), receipt)
})

test('partial media checkpoints do not announce or deliver a finished recording', async () => {
  let saved: MediaReceipt | undefined
  let announced = 0
  let store = {
    read: () => Promise.resolve(saved),
    save: (receipt: MediaReceipt) => {
      saved = receipt
      return Promise.resolve()
    },
  }
  let receipt = {
    call: 'ask',
    id: 'generation',
    model: 'music',
    input: {},
    response: {},
    complete: false,
  }
  await receivedMedia(
    {
      model: 'music',
      items: [],
      tools: [],
      onMedia: () => {
        announced++
        return Promise.resolve()
      },
    },
    receipt,
    store,
  )
  assertEquals(saved, receipt)
  assertEquals(announced, 0)
  await assertRejects(
    () =>
      recoveredMedia('ask', store, () => {
        throw new Error('partial output reached delivery')
      }),
    Error,
    'incomplete',
  )
})

test('receipt storage and host checkpoints finish before media announcement', async () => {
  let order: string[] = []
  let receipt = {
    call: 'ask',
    id: 'generation',
    model: 'music',
    input: {},
    response: {},
  }
  let request = {
    model: 'music',
    items: [],
    tools: [],
    onReceipt: () => {
      order.push('checkpoint')
      return Promise.resolve()
    },
    onMedia: () => {
      order.push('announce')
      return Promise.resolve()
    },
  }
  await receivedMedia(request, receipt, {
    read: () => Promise.resolve(undefined),
    save: () => {
      order.push('save')
      return Promise.resolve()
    },
  })
  assertEquals(order, ['save', 'checkpoint', 'announce'])
  order.length = 0
  await assertRejects(
    () =>
      receivedMedia(request, receipt, {
        read: () => Promise.resolve(undefined),
        save: () => Promise.reject(new Error('storage unavailable')),
      }),
    Error,
    'storage unavailable',
  )
  assertEquals(order, [])
})
