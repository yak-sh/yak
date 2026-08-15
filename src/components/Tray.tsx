import { useEffect } from 'preact/hooks'
import { signal } from '@preact/signals'
import { ent, mode, sessionRows } from '../live.ts'
import { awake, type Session } from '../types.ts'
import { block } from './ui.tsx'
import { dragData } from './drag.ts'
import { Entity } from './Entity.tsx'
import { SessionDot } from './session_status.tsx'

// The Tray is the statusbar's live-session digest. Durable places belong in
// graph-backed Navigation; this transient strip only says who wants attention.

// Collapsed vs expanded, remembered across visits (default collapsed).
export let trayOpen = signal(
  globalThis.localStorage?.getItem('tasks-tray') == 'open',
)
let toggle = (v: boolean) => {
  trayOpen.value = v
  globalThis.localStorage?.setItem('tasks-tray', v ? 'open' : 'shut')
}

export let trayKey = (
  key: string,
  repeat = false,
  typing = false,
  modified = false,
) => {
  if (mode.value != 'normal' || repeat || typing || modified || key != 't') {
    return false
  }
  toggle(!trayOpen.value)
  return true
}

// A run stays worth showing for a while around its latest activity.
let RECENT = 6 * 60 * 60 * 1000

export let trayRecent = (s: Session, now = Date.now()) => {
  let at = s.finished_at || s.started_at
  return !!at && now - Date.parse(at) < RECENT
}

// Dismissed rows — "seen", per browser. The ✕ on a settled row lands its
// eid here; the session entity is history and never touched. A signal so
// the strip and panel repaint on dismiss; localStorage so it sticks.
let seen = signal<string[]>(
  JSON.parse(globalThis.localStorage?.getItem('tasks-tray-seen') ?? '[]'),
)
let dismiss = (eid: string) => {
  seen.value = [...seen.value, eid].slice(-100)
  localStorage.setItem('tasks-tray-seen', JSON.stringify(seen.value))
}

// Worth a slot: somebody is home (awake — the operator's own terminal
// counts, which is the point of asking the door and never the origin), or
// it moved recently and nobody has dismissed it. Graph-native sessions rest
// between turns without a process status, so their start is activity too.
let shown = (eid: string, s: Session) =>
  awake(s) ||
  (trayRecent(s) && !seen.value.includes(eid))

// LIVE: the digest a human wants without opening every session.
let started = (s: Session) => Date.parse(s.started_at ?? '') || 0

export let traySessions = (rows: [string, Session][]) =>
  rows.toSorted(([, a], [, b]) => started(b) - started(a))

let live = () =>
  traySessions(sessionRows().filter(([eid, session]) => shown(eid, session)))

let Frame = block('div', 'Tray', {
  Strip: 'button',
  Chevron: 'span',
  Panel: 'div',
  Group: 'section',
  Label: 'span',
  Row: 'div',
  X: 'button',
  Hint: 'div',
})
let { Strip, Chevron, Panel, Group, Label, Row, X, Hint } = Frame

export let Tray = () => {
  useEffect(() => {
    let key = (e: KeyboardEvent) => {
      let typing = e.target instanceof HTMLElement &&
        e.target.matches('input, textarea, select, [contenteditable]')
      let modified = e.metaKey || e.ctrlKey || e.altKey
      if (trayKey(e.key, e.repeat, typing, modified)) e.preventDefault()
    }
    addEventListener('keydown', key)
    return () => {
      removeEventListener('keydown', key)
    }
  }, [])

  let ls = live()

  return (
    <Frame>
      <Strip
        type='button'
        aria-label={trayOpen.value ? 'close tray' : 'open tray'}
        onClick={() => toggle(!trayOpen.value)}
      >
        {ls.map(([eid]) => <SessionDot key={eid} e={ent(eid)} />)}
        <Chevron>{trayOpen.value ? '⌄' : '⌃'}</Chevron>
      </Strip>
      {trayOpen.value && (
        <Panel>
          {ls.length > 0 && (
            <Group>
              <Label>live</Label>
              {ls.map(([eid, s]) => (
                <Row
                  mod='live'
                  key={eid}
                  draggable
                  // no pin in the payload: a live row isn't shelved, so
                  // dropping it on the canvas SPAWNS a session card
                  onDragStart={(e: DragEvent) => dragData(e, eid, 'Session')}
                >
                  <Entity eid={eid} view='Tray.List.Tile' />
                  {
                    /* only a settled run dismisses — a live one wants your
                      eyes (stop it from its own view) */
                  }
                  {!awake(s) && (
                    <X
                      type='button'
                      aria-label='dismiss'
                      onClick={(e: MouseEvent) => {
                        e.stopPropagation()
                        dismiss(eid)
                      }}
                    >
                      ×
                    </X>
                  )}
                </Row>
              ))}
            </Group>
          )}
          {!ls.length && <Hint>no live sessions</Hint>}
        </Panel>
      )}
    </Frame>
  )
}
