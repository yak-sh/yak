/** The harness on @yaks/tui: local editing, graph-backed content. */
import { h, type JSX } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { Bundle, Eid } from '@yaks/graph'
import { Frame, run, Scroll, Textarea, useKeys } from '@yaks/tui'
import { type Context, type Panel, panels, type UIAgent } from './panels.ts'
import { type Agent, agent } from './run.ts'
import { INSTRUCTIONS } from './cli.ts'

/** UI contributions and an event door, independent of the terminal backend. */
export type Opts = {
  agent: UIAgent
  panels?: Panel[]
  subscribe: (changed: () => void) => () => void
}

// Effects have graph lifetime. Keep one observer per agent and remove mounted
// listeners on unmount, rather than accumulating registrations on every render.
let observers = new WeakMap<Agent, Set<() => void>>()
/** Observe committed graph changes, including entries arriving with stdin idle. */
export let changes = (a: Agent): Opts['subscribe'] => {
  let listeners = observers.get(a)
  if (!listeners) {
    listeners = new Set()
    observers.set(a, listeners)
    let notify = () => {
      for (let fn of listeners!) fn()
    }
    for (let comp of a.h.vocab.all) {
      a.h.fx.created(comp, notify).changed(comp, notify).removed(comp, notify)
    }
  }
  return (fn) => {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }
}

type Selection = { id?: Eid; pending?: Promise<Eid> }
type Snapshot = { sessions: Bundle[]; entries: Bundle[]; rows: Bundle[][] }

/** A session selector, a scrollable transcript and a multi-line prompt. */
export let App = (
  { agent: a, panels: sidebar = panels, subscribe }: Opts,
): JSX.Element => {
  let [selection, setSelection] = useState<Selection>({})
  let selected = useRef(selection)
  let [data, setData] = useState<Snapshot>({
    sessions: [],
    entries: [],
    rows: [],
  })
  let latest = useRef(data)
  latest.current = data
  let [error, setError] = useState('')
  let refresh = useRef(() => {})
  let choose = (s: Selection) => {
    selected.current = s
    setSelection(s)
    setData((d) => ({ ...d, entries: [] }))
    refresh.current()
  }

  useLayoutEffect(() => {
    let alive = true, dirty = false, busy = false
    // At most one query batch in flight. A write during a read causes another
    // read, never an out-of-order snapshot; no timer or polling loop.
    let read = async () => {
      if (busy) return
      busy = true
      try {
        while (alive && dirty) {
          dirty = false
          let s = selected.current
          let sessions = await a.sessions()
          let ctx: Context = { agent: a, session: s.id, sessions }
          let [entries, rows] = await Promise.all([
            s.id ? a.transcript(s.id) : Promise.resolve([]),
            Promise.all(sidebar.map((p) => p.read(ctx))),
          ])
          if (alive && s == selected.current && !dirty) {
            setData({ sessions, entries, rows })
          }
        }
      } catch (e) {
        if (alive) setError(String(e))
      } finally {
        busy = false
        if (alive && dirty) {
          queueMicrotask(() => {
            void read()
          })
        }
      }
    }
    let changed = () => {
      dirty = true
      // Return synchronously to the writer, and coalesce the batch's effects.
      queueMicrotask(() => {
        if (alive) void read()
      })
    }
    refresh.current = changed
    let free = subscribe(changed)
    changed()
    return () => {
      alive = false
      free()
      refresh.current = () => {}
    }
  }, [a, sidebar, subscribe])

  // Refs make several keys in one stdin read move several rows.
  useKeys((k) => {
    if (k.ctrl && k.text == 'o') {
      choose({})
      return true
    }
    let delta = k.ctrl && k.text == 'n' || k.alt && k.name == 'down'
      ? 1
      : k.ctrl && k.text == 'p' || k.alt && k.name == 'up'
      ? -1
      : 0
    if (!delta) return false
    let ids = [undefined, ...latest.current.sessions.map((b) => b.entity.eid)]
    let at = ids.indexOf(selected.current.id)
    choose({ id: ids[(at + delta + ids.length) % ids.length] })
    return true
  })

  let submit = (text: string) => {
    let s = selected.current
    setError('')
    // Serialize submissions per selection, including two Enters in the same
    // stdin read before start() has supplied the new session id.
    let write = s.pending
      ? s.pending.then(async (id) => {
        await a.send(id, text)
        return id
      })
      : s.id
      ? a.send(s.id, text).then(() => s.id!)
      : a.start(text)
    s.pending = write
    void write.then((id) => {
      s.id = id
      if (selected.current == s) setSelection({ ...s })
      refresh.current()
    }, (e) => {
      if (s.pending == write) s.pending = undefined
      setError(`Not sent: ${text}\n${String(e)}`)
    })
  }

  let ctx: Context = {
    agent: a,
    session: selection.id,
    sessions: data.sessions,
  }
  return h(
    Frame,
    {
      sidebar: sidebar.map((p, i) => ({
        title: p.title,
        Render: () => h(p.Render, { ...ctx, rows: data.rows[i] ?? [] }),
      })),
    },
    h(
      'div',
      { class: 'Title' },
      `Harness — ${selection.id?.slice(0, 8) ?? 'New session'}`,
    ),
    h(
      Scroll,
      { id: `transcript-${selection.id ?? 'new'}`, grow: '1' },
      ...data.entries.map((b) =>
        h(
          'div',
          { key: b.entity.eid, wrap: '1' },
          a.line(b, 'Line', { full: true }),
        )
      ),
    ),
    error ? h('div', { wrap: '1' }, error) : null,
    h(Textarea, { max: 6, onSubmit: submit }),
  )
}

/** No-verb entry. The daemon runs in this process while the terminal is open. */
export let tui = async (): Promise<void> => {
  let a = agent({ instructions: INSTRUCTIONS })
  let subscribe = changes(a)
  try {
    await a.resume()
    await run(() => h(App, { agent: a, subscribe }))
  } finally {
    a.close()
  }
}
