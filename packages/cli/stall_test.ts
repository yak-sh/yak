// The stall watch (stall.ts) over ticks: which held main threads it reports.
import { equal, test } from '@yaks/testing'
import { type Spent, stalls } from './stall.ts'

// Each step is a tick `<ms> <cpu> <wait>` after the one before, with what the
// thread spent between them (in s), or `<ms>` where the platform does not
// say. Says what was reported and what was noted.
let ticks = (...steps: string[]) => {
  let clock = 0, spent: Spent | undefined = { cpu: 0, wait: 0 }
  let said: string[] = [], fire = () => {}
  stalls({
    report: (e) =>
      said.push(`${e.name}: ${e.message} (${(e.cause as Error).message})`),
    note: (line) => said.push(`note: ${line}`),
    now: () => clock,
    read: () => spent,
    tick: (fn) => {
      fire = fn
      return () => {}
    },
  })
  for (let step of steps) {
    let [ms, cpu, wait] = step.split(' ').map(Number)
    clock += ms
    spent = wait == null ? undefined : {
      cpu: (spent?.cpu ?? 0) + cpu * 1000,
      wait: (spent?.wait ?? 0) + wait * 1000,
    }
    fire()
  }
  return said
}

test('a main thread held by its own work or a blocking call is reported', () => {
  equal(ticks('1000 0 0', '1003 0.1 0.1', '5900 0.2 0.1'), [])
  equal(ticks('1000 0 0', '6800 5.5 0.2'), [
    'Stalled: the main thread was held 5.8 s (in 6.8 s the main thread ran ' +
    '5.5 s on a CPU, waited 0.2 s for one and was off one 1.1 s)',
  ])
  equal(ticks('7000'), [
    'Stalled: the main thread was held 6.0 s (the platform does not say how ' +
    'the main thread spent 7.0 s)',
  ])
})

test('a main thread the box kept waiting for a CPU is a line, not a report', () => {
  equal(ticks('7000 1 5'), [
    'note: the main thread was held 6.0 s, by the box: in 7.0 s the main ' +
    'thread ran 1.0 s on a CPU, waited 5.0 s for one and was off one 1.0 s',
  ])
})
