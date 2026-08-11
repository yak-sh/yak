// Transient Session progress. Provider adapters reduce their streams to this
// small vocabulary before the wire; clients fold it in memory while ordered
// graph entries remain the only replayable transcript.
import { type Change } from './types.ts'

export type ObservationDelta =
  | { kind: 'model' | 'reasoning'; text: string }
  | { kind: 'tool'; name: string }
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
  rev: number
}

let FRAME_TEXT = 2048
let FRAME_NAME = 120
let HELD_TEXT = 12_000
let HELD_TOOLS = 8

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
    rev: 0,
  }
  let model = state.model
  let reasoning = state.reasoning
  let tools = state.tools
  if (value.kind == 'model') model = tail(model, value.text)
  if (value.kind == 'reasoning') {
    reasoning = tail(reasoning, value.text)
  }
  if (value.kind == 'tool') {
    let name = value.name
    tools = [...tools.filter((held) => held != name), name].slice(-HELD_TOOLS)
  }
  return { ...state, model, reasoning, tools, rev: state.rev + 1 }
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
