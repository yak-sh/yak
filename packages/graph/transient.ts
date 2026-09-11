import { token } from './guard.ts'
/** Ordered, non-durable text projections over existing graph entities.
 * Membership and aggregates remain queries over durable data. */
import type { Bundle, Comp, Eid } from './bundle.ts'
import type { Graph } from './graph.ts'
import { then } from './pipe.ts'

export type TransientFrame = {
  id: string
  entity: Eid
  component: string
  property: string
  seq: number
  op: 'begin' | 'append' | 'end'
  text?: string
}
type Value = { frame: TransientFrame; text: string }
export type Transients = ReturnType<typeof create>
const stores = new WeakMap<Graph, Transients>()

/** One projection registry per graph. No storage transactions or effect hooks. */
export function transient(g: Graph): Transients {
  let found = stores.get(g)
  if (!found) {
    found = create(g)
    stores.set(g, found)
  }
  return found
}
function create(g: Graph) {
  const values = new Map<string, Value>()
  const ended = new Set<string>()
  const listeners = new Set<(f: TransientFrame) => void>()
  const key = (f: TransientFrame) =>
    JSON.stringify([f.entity, f.component, f.property])
  const project = (bundles: Bundle[]): Bundle[] =>
    bundles.map((b) => {
      let out = b
      for (const { frame: f, text } of values.values()) {
        if (
          f.entity != b.entity.eid ||
          !Object.hasOwn((b[f.component] as Comp | undefined) ?? {}, f.property)
        ) continue
        out = {
          ...out,
          [f.component]: { ...(out[f.component] as Comp), [f.property]: text },
        }
      }
      return out
    })
  const read = g.read.bind(g)
  g.read = (q, opts) =>
    opts?.durable ? read(q, opts) : then(read(q, opts), project)
  const receive = (f: TransientFrame) => {
    if (!Number.isSafeInteger(f.seq) || f.seq < 0) {
      throw new Error('Invalid transient sequence')
    }
    if (ended.has(f.id)) return
    const k = key(f), old = values.get(k)
    if (f.op == 'end') {
      ended.add(f.id)
      if (old?.frame.id == f.id) values.delete(k)
    } else if (f.op == 'begin') {
      if (old?.frame.id == f.id && old.frame.seq >= f.seq) return
      if (old && old.frame.id != f.id) {
        throw new Error('Overlapping transient writers')
      }
      values.set(k, { frame: f, text: f.text ?? '' })
    } else {
      if (!old || old.frame.id != f.id) {
        throw new Error('Transient append without snapshot')
      }
      if (f.seq <= old.frame.seq) return
      if (f.seq != old.frame.seq + 1) throw new Error('Transient sequence gap')
      if (old.text.length + (f.text?.length ?? 0) > 16 * 1024 * 1024) {
        throw new Error('Transient text exceeds 16 MiB character limit')
      }
      values.set(k, { frame: f, text: old.text + (f.text ?? '') })
    }
    for (const fn of listeners) fn(f)
  }
  return {
    project,
    receive,
    /** A replica dropped these entities. Forget projections without ending
     * the remote writer: a later subscription may supply its snapshot. */
    forget(eids: Eid[]) {
      const ids = new Set(eids)
      for (const [key, value] of values) {
        if (ids.has(value.frame.entity)) values.delete(key)
      }
    },
    subscribe(fn: (f: TransientFrame) => void) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    snapshots: () =>
      [...values.values()].map(({ frame, text }) => ({
        ...frame,
        op: 'begin' as const,
        text,
      })),
    async begin(entity: Eid, component: string, property: string, id: string) {
      const rows = await g.storage.tx((tx) => tx.get([entity]))
      const text = (rows[0]?.[component] as Comp)?.[property]
      if (typeof text != 'string') {
        throw new Error('Transient text requires an existing string property')
      }
      if (ended.has(id)) throw new Error('Transient identity already finalized')
      let seq = 0, closed = false
      let expected = token(text)
      const frame = { id, entity, component, property }
      receive({ ...frame, seq, op: 'begin', text })
      return {
        expected: () => expected,
        append(text: string) {
          if (closed) throw new Error('Transient writer closed')
          receive({ ...frame, seq: ++seq, op: 'append', text })
        },
        async checkpoint() {
          if (closed) throw new Error('Transient writer closed')
          const value = values.get(key({ ...frame, seq, op: 'end' }))
          if (!value || value.frame.id != id) {
            throw new Error('Transient writer replaced')
          }
          await g.apply([{
            entity: { eid: entity },
            $was: { [component]: { [property]: expected } },
            [component]: { [property]: value.text },
          }], { trusted: true })
          expected = token(value.text)
        },
        async commit() {
          await this.checkpoint()
          closed = true
          receive({ ...frame, seq: ++seq, op: 'end' })
        },
        discard() {
          if (closed) return
          closed = true
          receive({ ...frame, seq: ++seq, op: 'end' })
        },
      }
    },
  }
}
