import { RuntimePanel } from './RuntimePanel.ts'
import { transient } from '@yaks/graph'
import { Keyboard } from './keyboard.ts'
import { useVisualController, type VisualState } from '@yaks/tui'
import { rootOf, sessionTree } from './tree.ts'
import { ToolError } from '@yaks/session'
import { diagnostics } from './diagnostics.ts'
/** The harness on @yaks/tui: local editing, graph-backed content. */
import { h, type JSX } from 'preact'
import { useLayoutEffect, useMemo, useRef } from 'preact/hooks'
import { type ComponentRenderer, render as renderView } from '@yaks/preact'
import { define } from '@yaks/render'
import { parse } from '@yaks/query'
import { signal } from '@preact/signals'
import { type Frontend, frontend } from './frontend.ts'
import type { Bundle, Comp, Eid } from '@yaks/graph'
import {
  Frame,
  metrics,
  run,
  size,
  Textarea,
  useKeys,
  VirtualList,
} from '@yaks/tui'
import { type Context, type Panel, panels, type UIAgent } from './panels.ts'
import type { Agent } from './run.ts'
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
    transient(a.h.g).subscribe(notify)
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
type Snapshot = {
  loadedFor?: string
  sessions: Bundle[]
  entries: Bundle[]
  rows: Bundle[][]
}

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
      showArchived: Boolean(value.showArchived),
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
    ui.patch({
      selected: s.id ?? null,
      sidebar: s.id ?? 'new',
      generation: current().generation + 1,
    })
    setData((d) => ({ ...d, entries: [], loadedFor: undefined }))
  }

  useLayoutEffect(() => {
    let alive = true, dirty = false, busy = false
    // Transcript publication must not wait for sidebar projections or a quiet
    // database. Other sessions can keep producing changes indefinitely.
    let transcriptDirty = false, transcriptBusy = false
    let readTranscript = async () => {
      if (transcriptBusy || !alive) return
      transcriptBusy = true
      try {
        while (alive && transcriptDirty) {
          transcriptDirty = false
          let s = current()
          let entries = s.id ? await a.transcript(s.id) : []
          if (
            alive && s.id == current().id &&
            s.generation == current().generation
          ) {
            setData((d) => ({ ...d, entries, loadedFor: s.id }))
          }
        }
      } catch (e) {
        diagnostics().report(e, {
          phase: 'frontend-transcript',
          session: current().id,
        })
        if (alive) setError(String(e))
      } finally {
        transcriptBusy = false
      }
    }
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
          let rows = await Promise.all(sidebar.map((p) => p.read(ctx)))
          if (
            alive && s.id == current().id &&
            s.generation == current().generation
          ) {
            setData((d) => ({ ...d, sessions, rows }))
          }
        }
      } catch (e) {
        diagnostics().report(e, {
          phase: 'frontend-projection',
          session: current().id,
        })
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
      transcriptDirty = true
      // Return synchronously to the writer, and coalesce the batch's effects.
      queueMicrotask(() => {
        if (alive) {
          void readTranscript()
          void read()
        }
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
  let action = (k: import('@yaks/tui').Key) => {
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
    // Ordinary typing must never build the session tree.
    if (
      !(k.ctrl && ['n', 'p', 'h', 'j', 'k', 'l'].includes(k.text ?? '') ||
        k.alt && (['a', 'z'].includes(k.text ?? '') ||
            k.name == 'up' || k.name == 'down'))
    ) return false
    let state = current()
    let rows = projection.peek().sessions
    let tree = sessionTree(rows, { ...state, selected: state.id })
    if (k.alt && k.text == 'z') {
      ui.patch({ showArchived: !state.showArchived })
      return true
    }
    if (k.alt && k.text == 'a') {
      let root = rows.find((b) =>
        b.entity.eid ==
          String((ui.client.ent('view')!.frontend as Comp).sidebar ?? state.id)
      )
      if (root && a.archive) {
        let archiving = !root.archived
        void a.archive(root.entity.eid, archiving).then(() => {
          if (
            archiving && !current().showArchived &&
            current().id == root.entity.eid
          ) choose({})
          refresh.current()
        }).catch((e) => setError(String(e)))
      }
      return true
    }
    if (k.ctrl && ['h', 'l'].includes(k.text ?? '')) {
      ui.keys({ focus: k.text == 'h' ? 'transcript' : 'sidebar' })
      return true
    }
    if (
      k.ctrl &&
      (['j', 'k', 'u', 'd'].includes(k.text ?? '') ||
        ['home', 'end'].includes(k.name))
    ) {
      const ctx: Context = {
        agent: a,
        session: state.id,
        sessions: rows,
        showSettled: state.showSettled,
        showArchived: state.showArchived,
      }
      const snapshot = projection.value
      const choices = sidebar.flatMap((panel, i) =>
        (panel.selectable?.(ctx, snapshot.rows[i] ?? []) ?? []).map((row) => ({
          ...row,
          viewport: panel.selectionViewport,
        }))
      )
      const cursor = String(
        (ui.client.ent('view')!.frontend as Comp).sidebar ?? state.id ?? 'new',
      )
      const at = choices.findIndex((r) => r.id == cursor)
      const height = metrics.value[choices[at]?.viewport ?? '']?.height ??
        size.value.rows
      const step = k.text == 'u' || k.text == 'd'
        ? Math.max(1, Math.floor(height / 2))
        : 1
      const index = k.name == 'home'
        ? 0
        : k.name == 'end'
        ? choices.length - 1
        : Math.max(
          0,
          Math.min(
            choices.length - 1,
            at + (k.text == 'k' || k.text == 'u' ? -step : step),
          ),
        )
      const next = choices[index]
      if (next) {
        if (next.id == 'new') choose({})
        else if (next.session) choose({ id: next.session })
        ui.patch({ sidebar: next.id })
      }
      return true
    }
    let delta = k.ctrl && k.text == 'n' || k.alt && k.name == 'down'
      ? 1
      : k.ctrl && k.text == 'p' || k.alt && k.name == 'up'
      ? -1
      : 0
    if (!delta) return false
    let ids: (string | undefined)[] = [
      undefined,
      ...tree.filter((r) => r.depth == 0).map((r) => r.bundle.entity.eid),
    ]
    let at = ids.indexOf(rootOf(rows, state.id))
    choose({ id: ids[(at + delta + ids.length) % ids.length] })
    return true
  }
  useKeys(action)

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
    }, (e) => {
      if (!(e instanceof ToolError)) {
        diagnostics().report(e, { phase: 'frontend-submit', session: s.id })
      }
      setError('Not sent: ' + text + '\n' + String(e))
    }).finally(() => {
      if (pending.get(key) == write) pending.delete(key)
    })
  }

  let ctx: Context = {
    agent: a,
    session: selection.id,
    sessions: data.sessions,
    showSettled,
    sidebar: state.sidebar == null ? undefined : String(state.sidebar),
    active: (ui.keyboard.value[0].keyboard as Comp).mode == 'NORMAL' &&
      (ui.keyboard.value[0].keyboard as Comp).focus == 'sidebar',
    showArchived: Boolean(state.showArchived),
  }
  let transcriptItems = useMemo(
    () => data.entries.map((b) => ({ id: b.entity.eid, bundle: b })),
    [data.entries],
  )
  return h(
    'div',
    { col: '1' },
    h(Visual, { ui }),
    h(
      'div',
      { grow: '1' },
      h(
        Frame,
        {
          ratio: 0.2,
          sidebar: sidebar.map((p, i) => ({
            title: p.title,
            titleClass: p.titleClass,
            bounded: true,
            fit: p.fit,
            scrollable: p.scrollable,
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
          pending: data.loadedFor !== selection.id,
          items: transcriptItems,
          agent: a,
        }),
      ),
    ),
    h(Keyboard, { ui, action }),
    h(RuntimePanel, { ui, agent: a, session: selection.id, subscribe }),
    h(Feedback, { ui }),
    h(Composer, { ui, submit }),
  )
}

let Visual = ({ ui }: { ui: Frontend }) => {
  useVisualController(
    () => ui.client.ent('visual')!.visual as VisualState,
    ui.select,
  )
  let value = ui.visual.value[0].visual as VisualState
  return value.surface
    ? h(
      'div',
      { class: 'Good' },
      'VISUAL · ' + value.surface +
        ' · Tab region · [/] item · hjkl move · y yank · Esc cancel',
    )
    : null
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
      h('span', { class: 'Entry_Hint' }, ' · Esc NORMAL'),
    ),
    h(Draft, { ui, submit }),
  )
}

/** Position is per transcript, but its rendering cache remains in VirtualList. */
let Transcript = ({ ui, id, items, agent, pending }: {
  pending: boolean
  ui: Frontend
  id: string
  items: { id: string; bundle: Bundle }[]
  agent: UIAgent
}) => {
  let viewport = useMemo(() => ui.viewport('viewport-' + id), [ui, id])
  useLayoutEffect(() => () => viewport.watch.close(), [viewport])
  let position = (viewport.watch.value[0] ?? ui.client.ent('viewport-' + id))
    ?.viewport as Comp | undefined
  return h(VirtualList<{ id: string; bundle: Bundle }>, {
    id: 'transcript-' + id,
    grow: '1',
    scrollbar: true,
    pending,
    items,
    value: {
      follow: position?.follow == null ? true : Boolean(position.follow),
      anchor: position?.item == null ? undefined : {
        id: String(position.item),
        offset: Number(position.offset),
      },
    },
    onViewportChange: viewport.set,
    selected: position?.selected == null
      ? undefined
      : String(position.selected),
    selectionVisible: (ui.keyboard.value[0].keyboard as Comp).mode == 'NORMAL',
    selectionClass:
      (ui.keyboard.value[0].keyboard as Comp).focus == 'transcript'
        ? 'Selection_Active'
        : 'List_Selected',
    onSelect: (selected: string) =>
      ui.client.mutate([{
        entity: { eid: 'viewport-' + id },
        viewport: { selected },
      }]),
    textOf: (item: { bundle: Bundle }) =>
      String((item.bundle.content as Comp | undefined)?.body ?? ''),
    renderItem: (item: { id: string; bundle: Bundle }) =>
      agent.entry(item.bundle),
  })
}

/** Query-selected frontend views mount controlled, graph-unaware widgets. */
let frontendViews = define<ComponentRenderer>([{
  view: 'Editor',
  match: parse('.draft'),
  Render: ({ e, edit, submit, active }) => {
    let draft = e.draft as Comp
    return h(Textarea, {
      max: 6,
      active: Boolean(active),
      value: { text: String(draft.text), at: Number(draft.at) },
      onEdit: edit as Frontend['edit'],
      passKey: (k: import('@yaks/tui').Key) =>
        !!k.ctrl && ['h', 'j', 'k', 'l'].includes(k.text ?? ''),
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
    active: (ui.keyboard.value[0].keyboard as Comp).mode == 'INSERT',
    submit,
  })

/** No-verb entry. The worker owns SQLite while the terminal is open. */
export let tui = async (): Promise<void> => {
  const { remote } = await import('./remote.ts')
  const backend = await remote({ instructions: INSTRUCTIONS, cwd: Deno.cwd() })
  const ui = frontend()
  try {
    await backend.resume()
    await run(
      () =>
        h(App, {
          agent: backend.agent,
          subscribe: backend.subscribe,
          frontend: ui,
        }),
      {
        graphics: Deno.env.get('HARNESS_GRAPHICS') == 'kitty'
          ? 'kitty'
          : 'none',
        tmux: !!Deno.env.get('TMUX'),
        shutdown: () => {
          ui.patch({
            error:
              'Shutting down—waiting for active operations; Ctrl+C again to force.',
          })
          return backend.close({ timeout: null })
        },
        force: backend.force,
      },
    )
  } finally {
    await backend.close()
    ui.close()
  }
}
