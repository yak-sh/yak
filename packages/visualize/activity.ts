/** Leases on the graph's one @yaks/trace channel, never another measurement. */
import { channel, type Event } from '@yaks/trace'
import { phases } from './parts.ts'

export type Activity = Event & {
  readonly seq: number
  readonly epoch: string
  readonly node?: string
}
export type Observation = {
  readonly epoch: string
  history: (limit?: number) => Activity[]
  subscribe: (fn: (event: Activity) => void) => () => void
  close: () => void
}
type Listener = (event: Activity) => void
type Broker = {
  epoch: string
  seq: number
  records: Activity[]
  leases: Set<Set<Listener>>
  stop: () => void
}
let brokers = new WeakMap<object, Broker>()
let capacity = 256

/** The first lease subscribes before taking history. The last releases the
 * producer's active path; no timer, clock or observer survives it. */
export let observe = (graph: object): Observation => {
  let broker = brokers.get(graph)
  if (!broker) {
    let stream = channel(graph)
    let made: Broker = {
      epoch: crypto.randomUUID(),
      seq: 0,
      records: [],
      leases: new Set(),
      stop: () => {},
    }
    let accept = (event: Event, notify = true) => {
      let record = Object.freeze({
        ...event,
        epoch: made.epoch,
        seq: ++made.seq,
        ...(event.kind == 'phase' &&
            phases.some((p) => p == event.name.split('.').at(-1))
          ? { node: `phase:${event.name.split('.').at(-1)}` }
          : {}),
      })
      made.records.push(record)
      if (made.records.length > capacity) made.records.shift()
      if (!notify) return
      for (let listeners of made.leases) {
        for (let listener of listeners) {
          try {
            listener(record)
          } catch (error) {
            console.error('@yaks/visualize subscriber failed', error)
          }
        }
      }
    }
    made.stop = stream.subscribe(accept)
    for (let event of stream.history()) accept(event, false)
    broker = made
    brokers.set(graph, made)
  }
  let owned = new Set<Listener>()
  broker.leases.add(owned)
  let closed = false
  let current = broker
  return {
    epoch: current.epoch,
    history: (limit = capacity) => {
      let n = Math.min(
        capacity,
        Math.max(
          0,
          Math.floor(
            Number.isFinite(limit) ? limit : capacity,
          ),
        ),
      )
      return closed || !n ? [] : current.records.slice(-n)
    },
    subscribe: (fn) => {
      if (closed) return () => {}
      let own = (event: Activity) => fn(event)
      owned.add(own)
      return () => {
        owned.delete(own)
      }
    },
    close: () => {
      if (closed) return
      closed = true
      owned.clear()
      current.leases.delete(owned)
      if (current.leases.size) return
      current.stop()
      brokers.delete(graph)
    },
  }
}
