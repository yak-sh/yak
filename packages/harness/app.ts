/** The harness on @yaks/tui: local editing, graph-backed content. */
import { h, type JSX } from 'preact'
import { useLayoutEffect, useMemo, useRef } from 'preact/hooks'
import { type ComponentRenderer, render as renderView } from '@yaks/preact'
import { define } from '@yaks/render'
import { parse } from '@yaks/query'
import { signal } from '@preact/signals'
import { type Frontend, frontend } from './frontend.ts'
import type { Bundle, Comp, Eid } from '@yaks/graph'
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
  /** Optional application-owned frontend; otherwise the mount owns a private one. */
  frontend?: Frontend
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

type Selection = { id?: Eid }
type Snapshot = { sessions: Bundle[]; entries: Bundle[]; rows: Bundle[][] }

/** A session selector, a scrollable transcript and a multi-line prompt. */
export let App = (
  { agent: a, panels: sidebar = panels, subscribe, frontend: supplied }: Opts,
): JSX.Element => {
  let ui = useMemo(() => supplied ?? frontend(), [supplied])
  useLayoutEffect(() => () => {
    if (!supplied) ui.close()
  }, [ui, supplied])
  let state = ui.view.value[0].frontend as Comp
  let showSettled = Boolean(state.showSettled)
  let selection = {
    id: state.selected == null ? undefined : String(state.selected),
  }
  // Promises are execution machinery, not graph data. Selection identity lives
  // in the frontend graph; this map only serializes concurrent submissions.
  let pending = useMemo(() => new Map<string, Promise<Eid>>(), [])
  let current = () => {
    let value = ui.client.ent('view')!.frontend as Comp
    return {
      id: value.selected == null ? undefined : String(value.selected),
      generation: Number(value.generation),
      mode: String((ui.client.ent('composer')!.composer as Comp).mode),
      showSettled: Boolean(value.showSettled),
    }
  }
  let setError = (error: string) => ui.patch({ error })
  // Query results are projections of the domain, not another mutable entity store.
  // A signal is only their subscription delivery mechanism.
  let projection = useMemo(
    () => signal<Snapshot>({ sessions: [], entries: [], rows: [] }),
    [],
  )
  let data = projection.value
  let setData = (next: Snapshot | ((before: Snapshot) => Snapshot)) => {
    projection.value = typeof next == 'function'
      ? next(projection.peek())
      : next
  }
  let refresh = useRef(() => {})
  let choose = (s: Selection) => {
    ui.patch({ selected: s.id ?? null, generation: current().generation + 1 })
    setData((d) => ({ ...d, entries: [] }))
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
          if (
            alive && s.id == current().id &&
            s.generation == current().generation && !dirty
          ) {
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
    let selected = current()
    let unwatch = ui.view.subscribe(() => {
      let next = current()
      if (next.id != selected.id || next.generation != selected.generation) {
        changed()
      }
      selected = next
    })
    let free = subscribe(changed)
    changed()
    return () => {
      alive = false
      unwatch()
      free()
      refresh.current = () => {}
    }
  }, [a, sidebar, subscribe, ui])

  // Event handlers read the committed graph, so a stdin burst sees each write.
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
        projection.peek().sessions,
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
    let key = s.id ?? 'new-' + s.generation
    let previous = pending.get(key)
    setError('')
    if (s.mode == 'task' && !s.id && !previous) {
      setError(
        'Not sent: ' + text + '\nSelect a session before submitting a task.',
      )
      return
    }
    let send = async (id: Eid) => {
      if (s.mode == 'task') await a.taskEntry(id, text)
      else await a.send(id, text)
      return id
    }
    let write = previous
      ? previous.then(send)
      : s.id
      ? send(s.id)
      : a.start(text)
    pending.set(key, write)
    void write.then((id) => {
      if (current().generation == s.generation && current().id == s.id) {
        ui.patch({ selected: id })
      }
      refresh.current()
    }, (e) => setError('Not sent: ' + text + '\n' + String(e))).finally(() => {
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
        h(Transcript, {
          ui,
          id: selection.id ?? 'new',
          items: transcriptItems,
          agent: a,
        }),
      ),
    ),
    h(Feedback, { ui }),
    h(Composer, { ui, submit }),
  )
}

let Feedback = ({ ui }: { ui: Frontend }) => {
  let error = String((ui.feedback.value[0].feedback as Comp).error ?? '')
  return error ? h('div', { wrap: '1' }, error) : null
}

let Composer = (
  { ui, submit }: { ui: Frontend; submit: (text: string) => void },
) => {
  let mode = String((ui.composer.value[0].composer as Comp).mode)
  return h(
    'div',
    { border: 'Composer_Border' },
    h(
      'div',
      null,
      h('span', { class: mode == 'message' ? 'Good' : 'Task' }, mode),
      h('span', { class: 'Entry_Hint' }, ' · Tab toggles message / task'),
    ),
    h(Draft, { ui, submit }),
  )
}

/** Position is per transcript, but its rendering cache remains in VirtualList. */
let Transcript = ({ ui, id, items, agent }: {
  ui: Frontend
  id: string
  items: { id: string; bundle: Bundle }[]
  agent: UIAgent
}) => {
  let viewport = useMemo(() => ui.viewport('viewport-' + id), [ui, id])
  useLayoutEffect(() => () => viewport.watch.close(), [viewport])
  let position = viewport.watch.value[0]?.viewport as Comp | undefined
  return h(VirtualList<{ id: string; bundle: Bundle }>, {
    id: 'transcript-' + id,
    grow: '1',
    scrollbar: true,
    items,
    value: {
      follow: Boolean(position?.follow),
      anchor: position?.item == null ? undefined : {
        id: String(position.item),
        offset: Number(position.offset),
      },
    },
    onViewportChange: viewport.set,
    renderItem: (item: { id: string; bundle: Bundle }) =>
      agent.entry(item.bundle),
  })
}

/** Query-selected frontend views mount controlled, graph-unaware widgets. */
let frontendViews = define<ComponentRenderer>([{
  view: 'Editor',
  match: parse('.draft'),
  Render: ({ e, edit, submit }) => {
    let draft = e.draft as Comp
    return h(Textarea, {
      max: 6,
      value: { text: String(draft.text), at: Number(draft.at) },
      onEdit: edit as Frontend['edit'],
      onSubmit: submit as (text: string) => void,
    })
  },
}])

/** This leaf alone subscribes to draft changes: typing does not render App. */
let Draft = (
  { ui, submit }: { ui: Frontend; submit: (text: string) => void },
) =>
  renderView(frontendViews, ui.draft.value[0], 'Editor', ui.client.vocab, {
    edit: ui.edit,
    submit,
  })

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
