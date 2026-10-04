import { equal, test } from '@yaks/testing'
import { terminalHistory } from './history.ts'

let entry = (path: string) => ({ path, state: { browse: { panes: [path] } } })

test('terminal history restores state with back, forward and replacement', () => {
  let h = terminalHistory(entry('/one'))
  let seen: string[] = []
  let stop = h.listen((e) => seen.push(e.path))
  h.write(entry('/two'))
  h.write(entry('/three'))
  h.back()
  equal(h.read(), entry('/two'))
  h.forward()
  equal(h.read(), entry('/three'))
  h.write(entry('/three?view=Inspect'), true)
  h.back()
  equal(h.read(), entry('/two'))
  h.forward()
  equal(h.read(), entry('/three?view=Inspect'))
  stop()
  h.back()
  equal(seen, [
    '/two',
    '/three',
    '/two',
    '/three',
    '/three?view=Inspect',
    '/two',
    '/three?view=Inspect',
  ])
})

test('terminal history persistence keeps the current entry and its forward branch', () => {
  let h = terminalHistory(entry('/one'))
  h.write(entry('/two'))
  h.write(entry('/three'))
  h.back()
  let restarted = terminalHistory()
  restarted.restore(JSON.parse(JSON.stringify(h.snapshot())))
  equal(restarted.read(), entry('/two'))
  restarted.forward()
  equal(restarted.read(), entry('/three'))
  restarted.back()
  restarted.write(entry('/other'))
  restarted.forward()
  equal(restarted.read(), entry('/other'))
  restarted.back()
  equal(restarted.read(), entry('/two'))
})

test('terminal history snapshots are values, not references into its navigation', () => {
  let initial = entry('/one')
  let h = terminalHistory(initial)
  initial.path = '/changed'
  let snapshot = h.snapshot()
  snapshot.entries[0].path = '/changed'
  let read = h.read()
  read.path = '/changed'
  equal(h.read(), entry('/one'))
  h.back()
  h.forward()
  equal(h.read(), entry('/one'))
})
