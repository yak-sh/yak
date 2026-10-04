// A history snapshot restores the controlled Stack, never expands a shared
// address. These tests drive the same graph/port binding the app mounts.
import { equal, test } from '@yaks/testing'
import { client } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import { docs } from '@yaks/ux/vocab'
import { cut, panesOf, scrolledPane, scrollOf } from '@yaks/ux'
import type { HistoryEntry, HistoryPort } from '@yaks/ui/history'
import { frameHistory, restoredFrames } from './history.ts'

let door = (initial: HistoryEntry = { path: '/T-1', state: null }) => {
  let entries = [initial], index = 0
  let listeners = new Set<(e: HistoryEntry) => void>()
  let port: HistoryPort = {
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
    back: () => {
      if (index) {
        index--
        listeners.forEach((fn) => fn(entries[index]))
      }
    },
    forward: () => {
      if (index < entries.length - 1) {
        index++
        listeners.forEach((fn) => fn(entries[index]))
      }
    },
  }
  return port
}
let graph = () =>
  client(loadVocab(docs), [], { vault: false, wireVault: false })

test('following pages stacks, views replace the top, strips return and back/forward restore', () => {
  let port = door(), g = graph(), h = frameHistory(g, port)
  try {
    h.go('/T-2')
    equal(panesOf(h.frames.value), ['/T-1', '/T-2'])
    equal(port.read().path, '/T-2')
    h.go('/T-2?v=Inspect.Full', true)
    equal(panesOf(h.frames.value), ['/T-1', '/T-2?v=Inspect.Full'])
    h.go('/?q=.task')
    h.change(cut(h.frames.value, 0))
    equal(panesOf(h.frames.value), ['/T-1'])
    port.back()
    equal(panesOf(h.frames.value), ['/T-1', '/T-2?v=Inspect.Full', '/?q=.task'])
    port.back()
    equal(h.path.value, '/T-2?v=Inspect.Full')
    port.forward()
    equal(h.path.value, '/?q=.task')
    h.go('/T-3')
    port.forward()
    equal(h.path.value, '/T-3')
  } finally {
    h.close()
    g.close()
  }
})

test('reload restores stack and scroll; a shared top address opens one page', () => {
  let port = door(), g = graph(), h = frameHistory(g, port)
  h.change(scrolledPane(h.frames.value, '/T-1', 87))
  h.go('/T-2')
  let snapshot = port.read()
  h.close()
  g.close()
  g = graph()
  h = frameHistory(g, door(snapshot))
  try {
    equal(panesOf(h.frames.value), ['/T-1', '/T-2'])
    equal(scrollOf(h.frames.value, '/T-1'), 87)
    equal(panesOf(restoredFrames({ path: snapshot.path, state: null })), [
      '/T-2',
    ])
    equal(panesOf(restoredFrames({ path: '/T-3', state: snapshot.state })), [
      '/T-3',
    ])
  } finally {
    h.close()
    g.close()
  }
})
