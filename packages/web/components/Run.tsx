import { entityPath } from '../url.ts'
import { useEffect, useRef, useState } from 'preact/hooks'
import { signal } from '@preact/signals'
import { base, ent, mutate, toPlane, topZ, uuid } from '../live.ts'
import {
  catalog,
  type Pick,
  type Provider,
  tableOf,
  transport,
  usingOf,
} from '../providers.ts'
import { type SpawnAsk, spawnFrames, spawnPlan } from '../client.ts'
import { type Change, idOf } from '../types.ts'
import { block } from './ui.tsx'
import { menu, navigate, screenTarget } from './nav.tsx'
import { usePlaceAt } from './overlay.tsx'

// The Run door: a task's "run session…" verb opens this over the point
// the menu stood on — model, effort; the provider is never asked, it is
// chosen for the pick by readiness — and writes ONE batch: the spawn
// (spawnOf), plus its card and pin when we're over a canvas, minted here
// like any other card the browser spawns. The choices are the graph's own
// provider and model entities, so the form offers only what the host can
// run, and anything it still can't honor shows on the session itself.
//
// Off a canvas (or on the List door, which has no plane) there's nothing
// to pin, so we navigate to the session instead.

type Ask = { eid: string; x: number; y: number }

// The live readiness predicate every spawn door judges transports by. No
// transport is blocked: a provider that cannot start says so on its session.
export let liveBlocked = (): Promise<(name: string) => boolean> =>
  Promise.resolve(() => false)

// The live transport for a picked model: graph-native Codex only when its
// account is signed in, else the permanent CLI fallback.
export let choose = async (pick: Pick): Promise<string> =>
  transport(pick, await liveBlocked())

let Frame = block('div', 'Run', {
  Row: 'label',
  Name: 'span',
  Go: 'button',
})
let { Row, Name, Go } = Frame

// The table, read once per page from the graph: the providers, their
// models, and the `serves` edges between them (providers.ts tableOf).
export let providers = signal<Provider[]>([])
let read = async (q: string) =>
  await (await fetch(`${base()}/query?q=${encodeURIComponent(q)}`)).json()
export let load = async () => {
  try {
    let found = await Promise.all(
      ['.provider!', '.model!', '.serves!'].map(read),
    )
    providers.value = tableOf(found.flat())
  } catch { /* no table, no form — the verb simply does nothing yet */ }
}

// Every door's spawn (the Run form, :fix, :chat, the TUI): the plan
// (spawnPlan), its names resolved to the entities the table holds, and the
// write @yaks/spawn makes. The instruction is the prompt, else the task's id
// and title, the way session_spawn words it.
export let spawnOf = async (
  ask: SpawnAsk & { task?: string; prompt?: string },
): Promise<{ session: string; changes: Change[] }> => {
  if (!providers.value.length) await load()
  let plan = spawnPlan(providers.value, ask, await liveBlocked())
  if (!plan.provider) throw new Error('no matching provider/model')
  let task = ask.task ? ent(ask.task) : undefined
  let body = ask.prompt ||
    [task && idOf(task), task?.doc?.title].filter(Boolean).join(' — ')
  let session = uuid()
  let using = usingOf(providers.value, { ...plan, provider: plan.provider })
  return { session, changes: spawnFrames(session, body, using, ask.task) }
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
  return { canvas: t.eid, x: Math.round(at.x), y: Math.round(at.y) }
}

let Form = ({ a }: { a: Ask }) => {
  let [choice, setChoice] = useState('')
  let [effort, setEffort] = useState('')
  let root = useRef<HTMLDivElement>(null)
  usePlaceAt(root, a)
  useEffect(() => {
    if (!providers.value.length) load()
  }, [])

  // Every choice is DERIVED, never stored beside the menu: a pick the
  // menu no longer offers falls back to its first entry, and effort to
  // the picked model's first, with nothing to keep in sync. Each model is
  // offered ONCE — the transport is chosen at start by readiness.
  let ms = catalog(providers.value)
  let m = ms.find((x) => x.model == choice) ?? ms[0]
  let ef = m?.efforts.includes(effort) ? effort : m?.efforts[0]

  let go = async () => {
    if (!m) return
    let at = spot(a)
    let { session: eid, changes } = await spawnOf({
      task: a.eid,
      provider: await choose(m),
      model: m.model,
      ...(ef ? { effort: ef } : {}),
    })
    let card = uuid()
    mutate(
      ...changes,
      ...(at
        ? [
          {
            eid: card,
            name: 'card',
            comp: { target: eid, view: 'Session' },
          },
          {
            eid: card,
            name: 'pin',
            comp: {
              canvas: at.canvas,
              x: at.x,
              y: at.y,
              w: 420,
              h: 0,
              z: topZ(at.canvas) + 1,
            },
          },
        ]
        : []),
    )
    run.value = null
    if (!at) navigate(entityPath(eid))
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
            setChoice((e.target as HTMLSelectElement).value)}
        >
          {ms.map((x) => (
            <option key={x.model} value={x.model}>{x.label}</option>
          ))}
        </select>
      </Row>
      {/* effort is a provider's own axis — claude has none, so no row */}
      {!!m?.efforts.length && (
        <Row>
          <Name>effort</Name>
          <select
            value={ef}
            onChange={(e: Event) =>
              setEffort((e.target as HTMLSelectElement).value)}
          >
            {m.efforts.map((x) => <option key={x} value={x}>{x}</option>)}
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
