// One page at a time, each at its own address: going somewhere adds an entry
// to the door's history, and back and forward return, scrolled where each page
// was left. The door here behaves as a browser's: writing an entry says
// nothing, and moving through them does.
import { equal, test } from '@yaks/testing'
import type { HistoryEntry, HistoryPort } from '@yaks/ui/history'
import { bindHistory, go, left, route, scrolledTo } from './history.ts'

let door = (initial: HistoryEntry = { path: '/T-1', state: null }) => {
  let entries = [initial], index = 0
  let listeners = new Set<(e: HistoryEntry) => void>()
  let move = (to: number) => {
    if (to < 0 || to >= entries.length) return
    index = to
    listeners.forEach((fn) => fn(entries[index]))
  }
  let port: HistoryPort & { paths: () => string[] } = {
    read: () => entries[index],
    write: (e, replace) => {
      if (replace) entries[index] = e
      else {
        entries = [...entries.slice(0, index + 1), e]
        index++
      }
    },
    listen: (fn) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    back: () => move(index - 1),
    forward: () => move(index + 1),
    paths: () => entries.map((e) => e.path),
  }
  return port
}

test('going adds an entry, a view replaces it, and back and forward return', () => {
  let port = door()
  bindHistory(port)
  go('/T-2')
  go('/T-2?v=Board', true)
  go('/?q=.task')
  go('/?q=.task')
  equal(port.paths(), ['/T-1', '/T-2?v=Board', '/?q=.task'])
  port.back()
  equal(route.value, '/T-2?v=Board')
  port.back()
  equal(route.value, '/T-1')
  port.forward()
  go('/T-3')
  equal(port.paths(), ['/T-1', '/T-2?v=Board', '/T-3'])
  bindHistory(door(port.read()))
  equal(route.value, '/T-3')
})

test('going back starts a page where it was left; a page gone to starts at its top', () => {
  let port = door()
  bindHistory(port)
  scrolledTo(87)
  go('/T-2')
  equal(left.value, 0)
  port.back()
  equal([route.value, left.value], ['/T-1', 87])
})
