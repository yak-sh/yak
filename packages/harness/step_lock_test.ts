// Two runtimes may read one database; only one may advance a session at once.
import { assertEquals } from '@std/assert'
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
