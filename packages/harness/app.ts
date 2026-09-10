/** The harness on @yaks/tui: local editing, graph-backed content. */
import { h, type JSX } from 'preact'
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { frontend, type Frontend } from './frontend.ts'
import type { Bundle, Eid } from '@yaks/graph'
import { Frame, run, Textarea, useKeys, VirtualList } from '@yaks/tui'
import {
  type Context,
  type Panel,
  panels,
  type UIAgent,
  visibleSessions,
} from './panels.ts'
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
  let ui = useMemo(() => frontend(), [])
  useLayoutEffect(() => () => ui.close(), [ui])
  let state = ui.view.value[0].frontend!
  let showSettled = Boolean(state.showSettled)
  let mode = String(state.mode) as 'message' | 'task'
  let error = String(state.error ?? '')
  let selection = { id: state.selected == null ? undefined : String(state.selected) }
  // Promises are execution machinery, not graph data. Selection identity lives
  // in the frontend graph; this map only serializes concurrent submissions.
  let pending = useMemo(() => new Map<string, Promise<Eid>>(), [])
  let current = () => {
    let value = ui.client.ent('view')!.frontend!
    return { id: value.selected == null ? undefined : String(value.selected),
      mode: String(value.mode), showSettled: Boolean(value.showSettled) }
  }
  let setError = (error: string) => ui.patch({ error })
  let [data, setData] = useState<Snapshot>({
    sessions: [],
    entries: [],
    rows: [],
  })
  let latest = useRef(data)
  latest.current = data
  let refresh = useRef(() => {})
  let choose = (s: Selection) => {
    ui.patch({ selected: s.id ?? null })
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
          let s = current()
          let sessions = await a.sessions()
          let ctx: Context = { agent: a, session: s.id, sessions }
          let [entries, rows] = await Promise.all([
            s.id ? a.transcript(s.id) : Promise.resolve([]),
            Promise.all(sidebar.map((p) => p.read(ctx))),
          ])
          if (alive && s.id == current().id && !dirty) {
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
    if (k.name == 'tab' && !k.ctrl && !k.alt) {
      ui.patch({ mode: current().mode == 'message' ? 'task' : 'message' })
      return true
    }
    if (k.ctrl && k.text == 's') {
      ui.patch({ showSettled: !current().showSettled })
      return true
    }
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
    let ids = [
      undefined,
      ...visibleSessions(
        latest.current.sessions,
        current().id,
        current().showSettled,
      ).map((b) => b.entity.eid),
    ]
    let at = ids.indexOf(current().id)
    choose({ id: ids[(at + delta + ids.length) % ids.length] })
    return true
  })

  let submit = (text: string) => {
    let s = current()
    let key = s.id ?? 'new'
    let previous = pending.get(key)
    setError('')
    if (s.mode == 'task' && !s.id && !previous) {
      setError(`Not sent: \nSelect a session before submitting a task.`)
      return
    }
    let send = async (id: Eid) => {
      if (s.mode == 'task') await a.taskEntry(id, text)
      else await a.send(id, text)
      return id
    }
    let write = previous ? previous.then(send) : s.id ? send(s.id) : a.start(text)
    pending.set(key, write)
    void write.then((id) => {
      if (current().id == s.id) ui.patch({ selected: id })
      refresh.current()
    }, (e) => setError(`Not sent: \n`)).finally(() => {
      if (pending.get(key) == write) pending.delete(key)
    })
  }

  let ctx: Context = {
    agent: a,
    session: selection.id,
    sessions: data.sessions,
    showSettled,
  }
  let transcriptItems = useMemo(
    () => data.entries.map((b) => ({ id: b.entity.eid, bundle: b })),
    [data.entries],
  )
  return h(
    'div',
    { col: '1' },
    h(
      'div',
      { grow: '1' },
      h(
        Frame,
        {
          sidebar: sidebar.map((p, i) => ({
            title: p.title,
            titleClass: p.titleClass,
            Render: () => h(p.Render, { ...ctx, rows: data.rows[i] ?? [] }),
          })),
        },
        h(
          'div',
          { class: 'Title' },
          `Harness — ${selection.id?.slice(0, 8) ?? 'New session'}`,
        ),
        h(
          VirtualList<{ id: string; bundle: Bundle }>,
          {
            id: 'transcript-' + (selection.id ?? 'new'),
            grow: '1',
            follow: true,
            scrollbar: true,
            items: transcriptItems,
            renderItem: (item: { id: string; bundle: Bundle }) =>
              a.entry(item.bundle),
          },
        ),
      ),
    ),
    error ? h('div', { wrap: '1' }, error) : null,
    h(
      'div',
      { border: 'Composer_Border' },
      h(
        'div',
        null,
        h('span', { class: mode == 'message' ? 'Good' : 'Task' }, mode),
        h('span', { class: 'Entry_Hint' }, ' · Tab toggles message / task'),
      ),
      h(Draft, { ui, submit }),
    ),
  )
}

/** This leaf alone subscribes to draft changes: typing does not render App. */
let Draft = ({ ui, submit }: { ui: Frontend; submit: (text: string) => void }) => {
  let draft = ui.draft.value[0].draft!
  return h(Textarea, { max: 6, value: { text: String(draft.text), at: Number(draft.at) },
    onEdit: ui.edit, onSubmit: submit })
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
