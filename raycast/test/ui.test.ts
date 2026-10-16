// UI seams use no Raycast runtime and never call the live graph.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  mergeConversation,
  poll,
  selectedProject,
  submissionGate,
  transcript,
} from '../src/ui-state'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

test('project selection restores only a valid project, otherwise first', () => {
  const items = [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
  ]
  assert.equal(selectedProject(items, 'b'), 'b')
  assert.equal(selectedProject(items, 'gone'), 'a')
  assert.equal(selectedProject([]), '')
})

test('rapid submissions send once and a failed send releases the latch', async () => {
  const gate = submissionGate()
  const pending = deferred<void>()
  let sent = 0
  const first = gate(async () => {
    sent++
    await pending.promise
  })
  await gate(() => {
    sent++
    return Promise.resolve()
  })
  assert.equal(sent, 1)
  pending.reject(new Error('offline'))
  await assert.rejects(first, /offline/)
  await gate(() => {
    sent++
    return Promise.resolve()
  })
  assert.equal(sent, 2)
})

test('poll cleanup suppresses an in-flight response and does not reschedule', async () => {
  const pending = deferred<number>()
  const seen: number[] = []
  let scheduled = 0
  const stop = poll(
    () => pending.promise,
    (value) => seen.push(value),
    assert.fail,
    () => {
      scheduled++
      return () => {}
    },
  )
  stop()
  pending.resolve(1)
  await pending.promise
  await Promise.resolve()
  assert.deepEqual(seen, [])
  assert.equal(scheduled, 0)
})

test('poll recovers from errors serially and disposes the timer', async () => {
  let next: (() => void) | undefined
  let cancelled = false
  const error = deferred<number>()
  const response = deferred<number>()
  let reads = 0
  const failures: unknown[] = []
  const seen: number[] = []
  const stop = poll(
    () => (++reads === 1 ? error.promise : response.promise),
    (value) => seen.push(value),
    (error) => failures.push(error),
    (callback) => {
      next = callback
      return () => {
        cancelled = true
      }
    },
  )
  assert.equal(reads, 1)
  error.reject(new Error('offline'))
  await error.promise.catch(() => {})
  await Promise.resolve()
  assert.equal(failures.length, 1)
  next?.()
  assert.equal(reads, 2)
  response.resolve(42)
  await response.promise
  await Promise.resolve()
  assert.deepEqual(seen, [42])
  stop()
  assert.equal(cancelled, true)
})

test('transcript shows both voices, literal user text, and markdown replies', () => {
  const rendered = transcript({
    id: 's',
    status: 'running',
    before: false,
    nextBefore: null,
    messages: [
      { id: '1', role: 'user', text: '# Not a heading' },
      { id: '2', role: 'assistant', text: '**A reply**' },
    ],
  })
  assert.match(rendered, /### You\n\n\\# Not a heading/)
  assert.match(rendered, /### Yak\n\n\*\*A reply\*\*/)
  assert.match(rendered, /running/)
})

test('older pages prepend once, preserve live revisions, and tail polls keep history', () => {
  const message = (id: string, text = id) => ({
    id,
    text,
    role: 'assistant' as const,
  })
  const tail = {
    id: 's',
    status: 'running',
    before: false,
    nextBefore: 50,
    messages: [message('b', 'live'), message('c')],
  }
  const older = {
    ...tail,
    before: true,
    nextBefore: 20,
    messages: [message('a'), message('b', 'stale')],
  }
  const loaded = mergeConversation(tail, older, 'older')
  assert.deepEqual(
    loaded.messages.map((m) => m.id),
    ['a', 'b', 'c'],
  )
  assert.equal(loaded.messages[1].text, 'live')
  const updated = mergeConversation(
    loaded,
    {
      ...tail,
      status: 'done',
      messages: [message('c', 'revised'), message('d')],
    },
    'tail',
  )
  assert.deepEqual(
    updated.messages.map((m) => m.id),
    ['a', 'b', 'c', 'd'],
  )
  assert.equal(updated.messages[2].text, 'revised')
  assert.equal(updated.nextBefore, 20)
  assert.equal(updated.status, 'done')
  const internalPage = mergeConversation(
    updated,
    {
      ...older,
      messages: [],
      nextBefore: 10,
    },
    'older',
  )
  assert.equal(internalPage.nextBefore, 10)
  assert.deepEqual(internalPage.messages, updated.messages)
  assert.equal(
    mergeConversation(
      internalPage,
      {
        ...older,
        messages: [],
        nextBefore: null,
      },
      'older',
    ).nextBefore,
    null,
  )
})
