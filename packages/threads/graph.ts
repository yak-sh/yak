import {
  type Access,
  type Bundle,
  type Eid,
  type Match,
  type Query,
  type ReadOpts,
  Refused,
  Stale,
  type WriteOpts,
} from '@yaks/graph'
import { type Port, type PortLink, portLink } from '@yaks/sync'
import type { Vocab } from '@yaks/vocab'

// Error identity matters: losing a claim is a Stale refusal, not a failed run.
let encodeError = (cause: unknown) => {
  let error = cause instanceof Error ? cause : new Error(String(cause))
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    details: { ...error },
  }
}
let decodeError = (value: unknown): Error => {
  let e = value as {
    name: string
    message: string
    stack?: string
    details: Stale
  }
  let error = e.name == 'Stale'
    ? new Stale(
      e.details.eid,
      e.details.comp,
      e.details.prop,
      e.details.current,
    )
    : e.name == 'Refused'
    ? new Refused(e.message)
    : new Error(e.message)
  return Object.assign(error, e.details, { name: e.name, stack: e.stack })
}

/** Serve this graph's authoritative operations to trusted code on a port.
 * The caller owns the port. All writes enter this graph's apply pipeline. */
export let serve = (port: Port, graph: Access): PortLink =>
  portLink(port, {
    encodeError,
    receive: (method, value) => {
      let args = value as unknown[]
      switch (method) {
        case 'read':
          return graph.read(...args as [Query, ReadOpts?])
        case 'rows':
          return graph.rows(...args as [Query, ReadOpts?])
        case 'get':
          return graph.get(...args as [Eid[], string[]?, ReadOpts?])
        case 'apply':
          return graph.apply(...args as [Bundle[], WriteOpts?])
        case 'outside.read':
          return graph.outside.read(...args as [Query, ReadOpts?])
        case 'outside.get':
          return graph.outside.get(...args as [Eid[], string[]?])
        case 'outside.bindings': {
          if (!graph.outside.bindings) {
            throw new Error('this graph evaluates no bindings')
          }
          return graph.outside.bindings(
            ...args as [Match[], Bundle[], string[]],
          )
        }
        default:
          throw new Error(`unknown graph request: ${method}`)
      }
    },
  })

/** Authoritative graph access whose port link can be released. */
export type Remote = Access & { close: () => void }

/** A thread's graph access, without a replica or a second write pipeline.
 * Load the same vocabulary here as on the owning graph. */
export let remote = (port: Port, vocab: Vocab): Remote => {
  let link = portLink(port, { decodeError })
  let ask = <T>(method: string, args: unknown[]): Promise<T> =>
    link.request(method, args).then((value) => value as T)
  return {
    vocab,
    read: (...args) => ask('read', args),
    rows: (...args) => ask('rows', args),
    get: (...args) => ask('get', args),
    apply: (...args) => ask('apply', args),
    outside: {
      read: (...args) => ask('outside.read', args),
      get: (...args) => ask('outside.get', args),
      bindings: (...args) => ask('outside.bindings', args),
    },
    close: () => link.close(),
  }
}
