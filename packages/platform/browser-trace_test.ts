import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { tasks, type TraceEvent } from './browser-trace.ts'

// A main thread's events, each [name, start ms, length ms, url?].
let thread = (...said: [string, number, number, string?][]): TraceEvent[] => [
  {
    name: 'thread_name',
    ph: 'M',
    ts: 0,
    pid: 1,
    tid: 1,
    args: { name: 'CrRendererMain' },
  },
  { name: 'yak-trace', ph: 'R', ts: 0, pid: 1, tid: 1 },
  ...said.map(([name, at, ms, url]) => ({
    name,
    ph: 'X',
    ts: at * 1000,
    dur: ms * 1000,
    pid: 1,
    tid: 1,
    ...url ? { args: { data: { url } } } : {},
  })),
]

test('a long task is split by what it spent its time on', () => {
  let [task] = tasks(
    thread(
      ['RunTask', 10, 100],
      ['FunctionCall', 11, 58, 'https://yaks.app/_yak/_navigate.1.js?v'],
      ['Layout', 20, 30],
      ['v8.callFunction', 55, 10],
      ['FireAnimationFrame', 75, 30],
      ['FunctionCall', 75, 30, 'https://yaks.app/_yak/_fit.2.js'],
      ['UpdateLayoutTree', 80, 20],
    ),
    { name: 'yak-trace', ms: 1000 },
  )
  assertEquals(task, {
    at: 1010,
    ms: 100,
    spent: [
      ['layout', 30],
      ['js _navigate.1.js', 28],
      ['style', 20],
      ['task', 12],
      ['js _fit.2.js', 10],
    ],
    styled: 0,
    laid: 0,
  })
})

test('a short task and another thread are left out', () => {
  let other = { name: 'RunTask', ph: 'X', ts: 0, dur: 90_000, pid: 2, tid: 9 }
  assertEquals(
    tasks([...thread(['RunTask', 0, 20]), other], { name: 'yak-trace', ms: 0 }),
    [],
  )
})

test('a long task says how many elements it styled and objects it laid out', () => {
  let events = thread(['RunTask', 0, 50], ['UpdateLayoutTree', 1, 10], [
    'Layout',
    20,
    20,
  ])
  events[3].args = { elementCount: 700 }
  events[4].args = { beginData: { dirtyObjects: 4000 } }
  let [task] = tasks(events, { name: 'yak-trace', ms: 0 })
  assertEquals([task.styled, task.laid], [700, 4000])
})
