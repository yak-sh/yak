/// <reference lib="deno.ns" />
import { assertEquals, assertRejects } from '@std/assert'
import { portLink } from './port.ts'
Deno.test('MessagePort requests, frames, failures and pending shutdown', async () => {
  let { port1, port2 } = new MessageChannel()
  let frames: unknown[] = []
  let a = portLink(port1, { frame: (f) => frames.push(f) })
  let b = portLink(port2, {
    receive: (method, value) => {
      if (method == 'fail') throw new Error('expected defect')
      if (method == 'wait') return new Promise(() => {})
      return value
    },
  })
  try {
    assertEquals(await a.request('echo', { text: 'hello' }), { text: 'hello' })
    b.frame({ id: 'items', bundles: [] })
    await a.request('echo')
    assertEquals(frames, [{ id: 'items', bundles: [] }])
    await assertRejects(() => a.request('fail'), Error, 'expected defect')
    let pending = a.request('wait')
    a.close()
    await assertRejects(() => pending, Error, 'closed')
  } finally {
    a.close()
    b.close()
    port1.close()
    port2.close()
  }
})

Deno.test('MessagePort request limits and timeout bound abandoned operations', async () => {
  let { port1, port2 } = new MessageChannel()
  let a = portLink(port1, { maxPending: 1, timeout: 10 })
  try {
    let first = a.request('never')
    await assertRejects(() => a.request('excess'), Error, 'Too many pending')
    await assertRejects(() => first, Error, 'timed out')
  } finally {
    a.close()
    port1.close()
    port2.close()
  }
})

Deno.test('peer disconnect rejects outstanding port requests immediately', async () => {
  let { port1, port2 } = new MessageChannel()
  let a = portLink(port1)
  let b = portLink(port2, { receive: () => new Promise(() => {}) })
  let pending = a.request('stuck')
  b.close()
  await assertRejects(() => pending, Error, 'disconnected')
  a.close()
  port1.close()
  port2.close()
})

Deno.test('real worker crash rejects pending requests', async () => {
  let worker = new Worker(
    'data:application/javascript,onmessage=()=>{throw new Error("crash")}',
    { type: 'module' },
  )
  worker.addEventListener('error', (e) => e.preventDefault())
  let link = portLink(worker)
  try {
    await assertRejects(() => link.request('crash'), Error, 'disconnected')
  } finally {
    link.close()
    worker.terminate()
  }
})
