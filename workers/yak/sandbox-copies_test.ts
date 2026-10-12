import { equal, test } from '@yaks/testing'
import { afterCompiles, copies } from './sandbox-copies.ts'

let storage = () => {
  let rows = new Map<string, unknown>()
  return {
    get: <T>(key: string) => Promise.resolve(rows.get(key) as T | undefined),
    delete: (key: string) => Promise.resolve(rows.delete(key)),
    put: <T>(key: string, value: T) =>
      Promise.resolve(void rows.set(key, structuredClone(value))),
    list: <T>({ prefix }: { prefix: string }) =>
      Promise.resolve(
        new Map(
          [...rows].filter(([key]) => key.startsWith(prefix)) as [string, T][],
        ),
      ),
  }
}

test('an in-use sandbox finishes its artifact before the clean workspace is copied', async () => {
  let finish!: () => void
  let done = new Promise<void>((resolve) => {
    finish = resolve
  })
  let artifact = 'compiling'
  let copying = afterCompiles(
    [
      {
        status: 'running',
        waitForExit: async () => {
          await done
          artifact = 'compiled'
        },
      },
      {
        status: 'completed',
        waitForExit: () => {
          throw new Error('already done')
        },
      },
    ],
    240_000,
    () => Promise.resolve(artifact),
  )
  finish()
  equal(await copying, 'compiled')
})

test('a workspace copy resumes after interruption and never overwrites later work', async () => {
  let disk = storage()
  let backed = 0
  let restored = 0
  let discarded = 0
  let fail = true
  let source = () =>
    copies(
      disk,
      () =>
        Promise.resolve({
          snapshot: { id: `snapshot-${++backed}`, dir: '/workspace' },
          processes: ['legacy-process'],
        }),
      () => {
        restored++
        if (fail) throw new Error('interrupted')
        return Promise.resolve(true)
      },
      () => Promise.resolve(void discarded++),
    )
  await source().fork('owner').catch(() => {})
  fail = false
  let resumed = source()
  equal(await resumed.fork('owner'), ['legacy-process'])
  equal(await source().fork('owner'), ['legacy-process'])
  equal([backed, restored, discarded], [1, 2, 1])
  await resumed.fork('former-member')
  equal(await source().names(), ['owner', 'former-member'])
})

test('concurrent copying waits for one receipt; an unused space starts no source box', async () => {
  let restores = 0
  let source = copies(
    storage(),
    () => Promise.resolve({ processes: [] }),
    () => {
      restores++
      return Promise.resolve(true)
    },
    () => Promise.resolve(),
  )
  equal(await Promise.all([source.fork('owner'), source.fork('owner')]), [
    [],
    [],
  ])
  equal(restores, 0)
  equal(await source.names(), ['owner'])
})

test('an existing personal workspace keeps work through reverting and reapplying', async () => {
  let source = copies(
    storage(),
    () => {
      throw new Error('must not snapshot over existing work')
    },
    () => {
      throw new Error('must not restore over existing work')
    },
    () => Promise.resolve(),
    () => Promise.resolve(true),
  )
  equal(await source.fork('owner'), [])
  equal(await source.fork('owner'), [])
  equal(await source.retire(), ['owner'])
})

test('an expired unserved snapshot is replaced while completed work is kept', async () => {
  let backed = 0
  let discarded = 0
  let source = copies(
    storage(),
    () =>
      Promise.resolve({
        snapshot: { id: String(++backed), dir: '/workspace' },
        processes: [],
      }),
    (_name, snapshot) => Promise.resolve(snapshot.id != '1'),
    () => Promise.resolve(void discarded++),
  )
  await source.fork('owner')
  await source.fork('owner')
  equal([backed, discarded], [2, 2])
})

test('erasing waits for an in-flight copy and admits no destination after closure', async () => {
  let started = Promise.withResolvers<void>()
  let finish = Promise.withResolvers<void>()
  let restored = 0
  let source = copies(
    storage(),
    async () => {
      started.resolve()
      await finish.promise
      return { snapshot: { id: 'held', dir: '/workspace' }, processes: [] }
    },
    () => {
      restored++
      return Promise.resolve(true)
    },
    () => Promise.resolve(),
  )
  let copying = source.fork('owner')
  await started.promise
  let erasing = source.retire()
  finish.resolve()
  equal((await Promise.allSettled([copying]))[0].status, 'rejected')
  equal(await erasing, ['owner'])
  equal(
    (await Promise.allSettled([source.fork('another')]))[0].status,
    'rejected',
  )
  equal(restored, 0)
  await source.discard()
  await source.clear()
  equal(await source.names(), [])
})
