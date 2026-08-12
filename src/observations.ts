// Transient Session progress. Provider adapters reduce their streams to this
// small vocabulary before the wire; clients fold it in memory while ordered
// graph entries remain the only replayable transcript.
import { type Change } from './types.ts'

export type ObservationItem =
  | { kind: 'model' | 'reasoning'; text: string }
  | { kind: 'tool'; name: string }

export type ObservationDelta =
  | ObservationItem
  | { kind: 'clear' }

export type Observation = {
  session: string
  generation: string
} & ObservationDelta

export type ObservationState = {
  generation: string
  model: string
  reasoning: string
  tools: string[]
  items: ObservationItem[]
  rev: number
}

let FRAME_TEXT = 2048
let FRAME_NAME = 120
let HELD_TEXT = 12_000
let HELD_TOOLS = 8
let HELD_ITEMS = 12

let record = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value == 'object' && !Array.isArray(value)

let ident = (value: unknown) =>
  typeof value == 'string' && value.length > 0 && value.length <= 128
    ? value
    : undefined

let clipped = (value: unknown, limit: number) => {
  if (typeof value != 'string') return undefined
  return value.length > limit ? value.slice(0, limit) : value
}

let tool = (value: unknown) => {
  let name = clipped(value, FRAME_NAME)?.trim()
  return name && /^[\w.-]+$/.test(name) ? name : undefined
}

// The broadcaster calls safe() even when an adapter already produced a typed
// value. This is the content-size boundary: no future caller can accidentally
// turn the transient lane into an arbitrary provider-payload tunnel.
export let safeObservation = (
  value: unknown,
): Observation | undefined => {
  if (!record(value)) return undefined
  let session = ident(value.session), generation = ident(value.generation)
  if (!session || !generation || typeof value.kind != 'string') {
    return undefined
  }
  if (value.kind == 'clear') {
    return {
      session,
      generation,
      kind: 'clear',
    }
  }
  if (value.kind == 'tool') {
    return {
      session,
      generation,
      kind: 'tool',
      name: tool(value.name) ?? 'tool',
    }
  }
  if (value.kind != 'model' && value.kind != 'reasoning') return undefined
  let text = clipped(value.text, FRAME_TEXT)
  if (!text) return undefined
  return {
    session,
    generation,
    kind: value.kind,
    text,
  }
}

let tail = (was: string, delta: string) => {
  let next = was + delta
  return next.length <= HELD_TEXT ? next : `…${next.slice(-(HELD_TEXT - 1))}`
}

// Adjacent text frames are one utterance. A tool starts a new place in the
// live transcript, so narration on either side stays beside that tool.
let ordered = (was: ObservationItem[], value: ObservationItem) => {
  let items = [...was]
  let last = items.at(-1)
  if (value.kind != 'tool' && last?.kind == value.kind) {
    items[items.length - 1] = {
      kind: value.kind,
      text: tail(last.text, value.text),
    }
  } else if (value.kind == 'tool') {
    items.push({ kind: 'tool', name: value.name })
  } else items.push({ kind: value.kind, text: value.text })
  let held = items.slice(-HELD_ITEMS)
  let left = HELD_TEXT
  for (let i = held.length - 1; i >= 0; i--) {
    let item = held[i]
    if (item.kind == 'tool') continue
    if (item.text.length <= left) {
      left -= item.text.length
    } else if (left > 0) {
      held[i] = {
        kind: item.kind,
        text: left == 1 ? '…' : `…${item.text.slice(-(left - 1))}`,
      }
      left = 0
    } else held.splice(i, 1)
  }
  return held
}

export let foldObservation = (
  was: ObservationState | undefined,
  value: Observation,
): ObservationState | undefined => {
  if (value.kind == 'clear') {
    return was?.generation == value.generation ? undefined : was
  }
  let state = was?.generation == value.generation ? was : {
    generation: value.generation,
    model: '',
    reasoning: '',
    tools: [],
    items: [],
    rev: 0,
  }
  let model = state.model
  let reasoning = state.reasoning
  let tools = state.tools
  let items = state.items ?? []
  if (value.kind == 'model') model = tail(model, value.text)
  if (value.kind == 'reasoning') {
    reasoning = tail(reasoning, value.text)
  }
  if (value.kind == 'tool') {
    let name = value.name
    tools = [...tools.filter((held) => held != name), name].slice(-HELD_TOOLS)
  }
  items = ordered(items, value)
  return { ...state, model, reasoning, tools, items, rev: state.rev + 1 }
}

// A completed output or terminal generation facet supersedes its transient
// preview. This local check also heals a missed clear frame without waiting
// for reconnect.
export let observedBy = (state: ObservationState, changes: Change[]) =>
  changes.some((change) =>
    (change.name == 'output' &&
      String(change.comp?.source ?? '') == state.generation) ||
    (change.eid == state.generation &&
      ['delivered', 'error'].includes(change.name)) ||
    (change.name == 'cancel' &&
      String(change.comp?.target ?? '') == state.generation)
  )
