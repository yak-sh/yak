import { useEffect, useRef, useState } from 'preact/hooks'
import { signal } from '@preact/signals'
import { base, ent, mutate, toPlane, topZ, uuid } from '../live.ts'
import { block } from './ui.tsx'
import { menu, navigate, screenTarget } from './nav.tsx'
import { usePlaceAt } from './overlay.tsx'

// The Run door: a task's "run session…" verb opens this over the point
// the menu stood on — model, effort; the provider is never asked, it is
// the pick's own — and writes ONE batch: a
// session carrying the request columns (the server's created(session)
// effect validates and launches it), plus its card and pin when we're
// over a canvas, minted here like any other card the browser spawns.
// The choices are the SERVER's table (GET /providers): adapters.ts is
// server-only, so the form can only offer what will be accepted — and
// anything that still can't be honored (a task with no repo) comes back
// as a failed Session on the board, not a toast nobody kept.
//
// Off a canvas (or on the List door, which has no plane) there's nothing
// to pin, so we navigate to the session instead.

type Provider = {
  name: string
  models: string[]
  efforts: string[]
  labels: Record<string, string>
}
type Ask = { eid: string; x: number; y: number }

// The offers: every provider's labeled models, flattened — the form
// shows models, not providers. When two providers offer the same model,
// the first keeps it (the whole heuristic, for now).
export let offers = (ps: Provider[]) =>
  ps.flatMap((p) =>
    Object.entries(p.labels).map(([model, label]) => ({ model, label, p }))
  ).filter((o, i, all) => all.findIndex((x) => x.model == o.model) == i)
    .sort((a, b) =>
      Number(b.model == 'gpt-5.6-sol') -
      Number(a.model == 'gpt-5.6-sol')
    )

let Frame = block('div', 'Run', {
  Row: 'label',
  Name: 'span',
  Go: 'button',
})
let { Row, Name, Go } = Frame

// The table, fetched once per page: it changes when the server changes.
export let providers = signal<Provider[]>([])
export let load = async () => {
  try {
    providers.value = await (await fetch(`${base()}/providers`)).json()
  } catch { /* no table, no form — the verb simply does nothing yet */ }
}

export let run = signal<Ask | null>(null)

// The verb opens the form where the menu is: the click that runs it also
// closes the menu, so its point is taken NOW, not read back later.
export let openRun = (eid: string) => {
  run.value = { eid, x: menu.value?.x ?? 0, y: menu.value?.y ?? 0 }
}

// Where the card should land: the root card is the canvas we're looking
// at, and the ask's point is where the session was asked for. Off a canvas
// (or on the List door, which has no plane) there's nowhere to pin.
let spot = (a: Ask) => {
  let t = screenTarget()
  let box = document.querySelector('.Canvas')?.getBoundingClientRect()
  if (!t || !box || !ent(t.eid).canvas) return null
  let at = toPlane(a.x, a.y, box)
  return { canvas_eid: t.eid, x: Math.round(at.x), y: Math.round(at.y) }
}

let Form = ({ a }: { a: Ask }) => {
  let [model, setModel] = useState('')
  let [effort, setEffort] = useState('')
  let root = useRef<HTMLDivElement>(null)
  usePlaceAt(root, a)
  useEffect(() => {
    if (!providers.value.length) load()
  }, [])

  // Every choice is DERIVED, never stored beside the menu: a pick the
  // menu no longer offers falls back to its first entry, and effort to
  // the picked provider's first, with nothing to keep in sync.
  let ms = offers(providers.value)
  let m = ms.find((x) => x.model == model) ?? ms[0]
  let ef = m?.p.efforts.includes(effort) ? effort : m?.p.efforts[0]

  let go = () => {
    if (!m) return
    let at = spot(a)
    let eid = uuid()
    let card = uuid()
    mutate(
      {
        eid,
        name: 'session',
        comp: {
          id: uuid(),
          provider: m.p.name,
          model: m.model,
          ...(ef ? { effort: ef } : {}),
          requested_task_eid: a.eid,
        },
      },
      ...(at
        ? [
          {
            eid: card,
            name: 'card',
            comp: { target_eid: eid, view: 'Session' },
          },
          {
            eid: card,
            name: 'pin',
            comp: {
              canvas_eid: at.canvas_eid,
              x: at.x,
              y: at.y,
              w: 420,
              h: 0,
              z: topZ(at.canvas_eid) + 1,
            },
          },
        ]
        : []),
    )
    run.value = null
    if (!at) navigate(`/${eid}`)
  }

  return (
    <Frame
      elRef={root}
      onPointerDown={(e: Event) => e.stopPropagation()}
    >
      <Row>
        <Name>model</Name>
        <select
          value={m?.model}
          onChange={(e: Event) =>
            setModel((e.target as HTMLSelectElement).value)}
        >
          {ms.map((x) => (
            <option key={x.model} value={x.model}>{x.label}</option>
          ))}
        </select>
      </Row>
      {/* effort is a provider's own axis — claude has none, so no row */}
      {!!m?.p.efforts.length && (
        <Row>
          <Name>effort</Name>
          <select
            value={ef}
            onChange={(e: Event) =>
              setEffort((e.target as HTMLSelectElement).value)}
          >
            {m.p.efforts.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Row>
      )}
      <Go type='button' disabled={!m} onClick={go}>▶ start</Go>
    </Frame>
  )
}

// Keyed by the task: a second ask is a fresh form, not the last one's
// leftovers.
export let Run = () => {
  let a = run.value
  return a ? <Form key={a.eid} a={a} /> : null
}
