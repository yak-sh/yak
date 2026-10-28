import { equal, test, until } from '@yaks/testing'
import { own, started, waits } from './own.ts'

// A clock over scripted looks: what each look finds each thread has waited,
// and the wall clock at the clock's making and at each call after it.
let read = (looks: Record<string, number>[], times: number[], every = 0) => {
  let at = [...times]
  let now = own(0, {
    every,
    look: () => new Map(Object.entries(looks.shift()!)),
    time: () => at.shift()!,
  })
  return times.slice(1).map(() => now())
}

test('own time is the wall clock less the most-held thread’s wait', () => {
  equal(read([{ a: 0, b: 0 }, { a: 30, b: 10 }], [0, 0, 100]), [0, 70])
  equal(read([{ a: 0 }, { a: 0, c: 20 }], [0, 0, 100]), [0, 80])
  equal(read([{ a: 10 }, {}], [0, 0, 100]), [0, 100])
})

test('own time never runs back when a look finds a wait already counted', () => {
  equal(
    read([{ a: 0 }, { a: 0 }, { a: 200 }], [0, 0, 100, 150]),
    [0, 100, 100],
  )
})

test('own time counts its first interval whole and looks once per interval', () => {
  equal(
    read([{ a: 500 }, { a: 550 }], [0, 50, 100, 150, 200], 100),
    [50, 100, 150, 150],
  )
})

// A shell started as the file loads, with a child of its own, and a pid
// looked at that names nothing (Deno's first refusal is its slowest), so the
// case times only its looks. Both end when their input does, as the runtime
// ends.
let shell = new Deno.Command('sh', {
  args: ['-c', 'cat; :'],
  stdin: 'piped',
  stdout: 'null',
}).spawn()
shell.unref()
await until(() => waits(shell.pid).size == 2, { label: 'the shell runs cat' })
waits(2 ** 30)

test('waits reads every thread of a process and of the processes it started', () => {
  let found = [...waits(shell.pid).keys()]
  equal(found.length, 2)
  equal(found.includes(`/proc/${shell.pid}/task/${shell.pid}`), true)
  equal(waits(2 ** 30).size, 0)
})

test('started reads the main thread of each process the runtime started, not its own threads', () => {
  let found = [...started().keys()]
  equal(found.includes(`/proc/${shell.pid}/task/${shell.pid}`), true)
  equal(found.some((at) => at.startsWith(`/proc/${Deno.pid}/`)), false)
  equal(started(2 ** 30).size, 0)
})
