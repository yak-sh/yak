// Two runtimes may read one database; only one may advance a session at once.
import { assertEquals, assertExists, assertThrows } from '@std/assert'
import { stub } from '@std/testing/mock'
import { agent } from './run.ts'
import { open } from './store.ts'
import { stepLock } from './step_lock.ts'
import type { Comp } from '@yaks/graph'

Deno.test('step locks share an inode and release without blocking other sessions', () => {
  let dir = Deno.makeTempDirSync()
  let path = dir + '/db'
  Deno.writeTextFileSync(path, '')
  try {
    let a = stepLock(path), b = stepLock(path)
    let release = a('one')!
    assertEquals(b('one'), undefined)
    b('two')!()
    release()
    b('one')!()
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('step lock release unlocks even while its file description is retained', () => {
  let dir = Deno.makeTempDirSync()
  let path = dir + '/db'
  Deno.writeTextFileSync(path, '')
  let retained: Deno.FsFile | undefined
  let close: (() => void) | undefined
  try {
    let a = stepLock(path), b = stepLock(path)
    let open = Deno.openSync
    let release: (() => void) | undefined
    {
      using _open = stub(Deno, 'openSync', (...args) => {
        retained = open(...args)
        close = retained.close.bind(retained)
        // Hold the real OS file description beyond close, just as a child
        // forked by another test thread can until exec. No scheduling race.
        retained.close = () => {}
        return retained
      })
      release = a('one')
    }
    assertExists(release)
    assertEquals(b('one'), undefined)
    release()
    let next = b('one')
    assertExists(
      next,
      'release must not wait for the inherited handle to close',
    )
    try {
      assertEquals(b('one'), undefined)
    } finally {
      next()
    }
  } finally {
    close?.()
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('step lock release closes its handle even if unlocking fails', () => {
  let dir = Deno.makeTempDirSync()
  let path = dir + '/db'
  Deno.writeTextFileSync(path, '')
  try {
    let calls: string[] = []
    using _open = stub(Deno, 'openSync', () =>
      ({
        tryLockSync: () => true,
        unlockSync: () => {
          calls.push('unlock')
          throw new Error('unlock failed')
        },
        close: () => calls.push('close'),
      }) as unknown as Deno.FsFile)
    let release = stepLock(path)('one')
    assertExists(release)
    assertThrows(release, Error, 'unlock failed')
    assertEquals(calls, ['unlock', 'close'])
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('a second runtime cannot interrupt a live provider attempt', async () => {
  let dir = Deno.makeTempDirSync()
  let path = dir + '/db'
  let started = Promise.withResolvers<void>()
  let finish = Promise.withResolvers<void>()
  let calls = 0
  let a = agent({
    h: open(path),
    tools: [],
    streaming: true,
    model: async () => {
      calls++
      started.resolve()
      await finish.promise
      return {
        id: 'reply',
        model: 'fake',
        items: [{ kind: 'assistant', text: 'done' }],
      }
    },
  })
  let b: ReturnType<typeof agent> | undefined
  try {
    let id = await a.start('hello')
    await started.promise
    b = agent({
      h: open(path),
      tools: [],
      streaming: true,
      model: () => {
        calls++
        return Promise.resolve({
          id: 'reply',
          model: 'fake',
          items: [{ kind: 'assistant', text: 'wrong' }],
        })
      },
    })
    await b.resume()
    await b.idle(id)
    let entries = await b.transcript(id)
    assertEquals(entries.filter((e) => e.ask).length, 1)
    assertEquals(entries.filter((e) => e.error || e.exception).length, 0)
    assertEquals(
      (entries.find((e) => e.ask)!.attempt as Comp).state,
      'inflight',
    )
    assertEquals(calls, 1)
    finish.resolve()
    await a.idle(id)
    assertEquals(calls, 1)
  } finally {
    finish.resolve()
    await a.close()
    await b?.close()
    Deno.removeSync(dir, { recursive: true })
  }
})
