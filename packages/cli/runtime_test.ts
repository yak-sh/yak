// Source paths follow a private runtime; data and other checkouts do not.
import { clock, equal, test } from '@yaks/testing'
import { orphaned, runtimePath, runtimeStack } from './runtime.ts'

test('a runtime remaps source paths without moving neighboring checkouts or data', () => {
  let path = (spec: string) =>
    runtimePath(spec, 'file:///src', 'file:///private')
  equal(
    path('file:///src/packages/tool/tools.ts'),
    'file:///private/packages/tool/tools.ts',
  )
  equal(path('file:///src-other/tool.ts'), 'file:///src-other/tool.ts')
  equal(path('file:///data/yak.db'), 'file:///data/yak.db')
  equal(path('@yaks/task'), '@yaks/task')
  equal(
    runtimeStack(
      'Error\n at file:///private/pkg/a.ts:3:1\n at file:///other/a.ts:2:1',
      'file:///src',
      'file:///private',
    ),
    'Error\n at file:///src/pkg/a.ts:3:1\n at file:///other/a.ts:2:1',
  )
  equal(
    runtimePath('file:///src/tool.ts', undefined, undefined),
    'file:///src/tool.ts',
  )
})

// A launcher killed outright forwards nothing; its child, in a session of its
// own, ends itself rather than hold the port and the graph forever. The child
// reads its parent and the launcher's pid from a box the test keeps.
let watching = (launcher: number) => {
  let time = clock()
  let box = { ppid: launcher, live: new Set([launcher]), ended: 0 }
  let stop = orphaned(launcher, {
    every: 10,
    ppid: () => box.ppid,
    alive: (pid) => box.live.has(pid),
    end: () => box.ended++,
    timer: (fn, ms) => time.after(ms, fn),
  })
  let after = async (ms: number) => (await time.advance(ms), box.ended)
  return { box, stop, after }
}

test('a pinned child ends once its launcher is gone', async () => {
  let { box, after } = watching(7)
  equal(await after(30), 0)
  // Handed to another parent, it still waits for the launcher's pid to go.
  box.ppid = 1
  equal(await after(30), 0)
  box.live.delete(7)
  equal(await after(10), 1)
  equal(await after(100), 1)
})

test('a child that stops watching outlives its launcher', async () => {
  let { box, stop, after } = watching(7)
  equal(await after(30), 0)
  stop()
  box.ppid = 1
  box.live.clear()
  equal(await after(100), 0)
})
