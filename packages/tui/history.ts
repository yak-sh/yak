// A terminal's history: entries and a cursor, independent of the app it runs.
// The caller persists snapshot() in its private state file between runs.
import type { HistoryEntry, HistoryPort } from '@yaks/ui/history'

export type HistorySnapshot = { entries: HistoryEntry[]; at: number }
export type TerminalHistory = HistoryPort & {
  snapshot(): HistorySnapshot
  restore(snapshot: HistorySnapshot): void
}

let copy = <T>(value: T): T => structuredClone(value)

export let terminalHistory = (
  initial: HistoryEntry = { path: '/', state: null },
): TerminalHistory => {
  let entries = [copy(initial)]
  let at = 0
  let listeners = new Set<(entry: HistoryEntry) => void>()
  let read = () => copy(entries[at])
  let emit = () => {
    for (let listener of listeners) listener(read())
  }
  let move = (next: number) => {
    if (next < 0 || next >= entries.length || next == at) return
    at = next
    emit()
  }
  return {
    read,
    write(entry, replace = false) {
      if (replace) entries[at] = copy(entry)
      else {
        entries = [...entries.slice(0, at + 1), copy(entry)]
        at++
        if (entries.length > 100) {
          entries = entries.slice(-100)
          at = entries.length - 1
        }
      }
      emit()
    },
    listen(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    back: () => move(at - 1),
    forward: () => move(at + 1),
    snapshot: () => copy({ entries, at }),
    restore(snapshot) {
      if (!snapshot.entries.length || !Number.isInteger(snapshot.at)) return
      if (snapshot.at < 0 || snapshot.at >= snapshot.entries.length) return
      entries = copy(snapshot.entries)
      at = snapshot.at
      emit()
    },
  }
}
