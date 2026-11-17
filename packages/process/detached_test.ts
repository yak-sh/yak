import { EventEmitter } from 'node:events'
import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { detaching, type Launch } from './detached.ts'

class Thread extends EventEmitter {
  sent: Launch[] = []
  held = false
  closed = false
  postMessage(message: Launch) {
    this.sent.push(message)
  }
  ref() {
    this.held = true
  }
  unref() {
    this.held = false
  }
  terminate() {
    this.closed = true
    return Promise.resolve(0)
  }
}

test('detached commands wait for their own thread response and release an idle thread', async () => {
  let thread = new Thread()
  let run = detaching(() => thread)
  let firstDone = false
  let first = run('first', { args: ['a'], clearEnv: true, env: { A: 'b' } })
    .then(() => {
      firstDone = true
    })
  let second = run('second')
  equal(thread.sent, [
    {
      id: 1,
      program: 'first',
      options: { args: ['a'], clearEnv: true, env: { A: 'b' } },
    },
    { id: 2, program: 'second', options: {} },
  ])
  equal(thread.held, true)
  thread.emit('message', { id: 2 })
  await second
  equal(firstDone, false)
  equal(thread.held, true)
  thread.emit('message', { id: 1 })
  await first
  equal(thread.held, false)
})

test('detached commands deliver startup failures to the caller', async () => {
  let thread = new Thread()
  let run = detaching(() => thread)
  let job = run('missing')
  let failed = assertRejects(() => job, Error, 'missing program')
  thread.emit('message', { id: 1, error: new Error('missing program') })
  await failed
  equal(thread.held, false)
})

test('a failed command thread rejects its waiters and is replaced for the next launch', async () => {
  let threads: Thread[] = []
  let run = detaching(() => {
    let thread = new Thread()
    threads.push(thread)
    return thread
  })
  let first = run('first'), second = run('second')
  let failed = Promise.all([
    assertRejects(() => first, Error, 'lost thread'),
    assertRejects(() => second, Error, 'lost thread'),
  ])
  threads[0].emit('error', new Error('lost thread'))
  await failed
  equal(threads[0].closed, true)
  let third = run('third')
  equal(threads.length, 2)
  threads[1].emit('message', { id: 3 })
  await third
})
