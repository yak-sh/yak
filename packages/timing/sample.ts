/** Select slow trees and one ordinary tree per op per minute. The caller
 * owns representative-sampling state, so repeated calls remain pure and can
 * share a quota across channels in a process without sharing span IDs. */
import type { Event } from '@yaks/trace'
import { type Clock, minute, type Trace } from './model.ts'

/** Per-root-op slow thresholds in ms. An absent op has no slow threshold. */
export type Thresholds = Readonly<Record<string, number>>

/** Starting thresholds, overridable by the host's tracker configuration. */
export let thresholds: Thresholds = Object.freeze({
  tick: 16,
  apply: 16,
  request: 500,
  effect: 1000,
})

/** Tree time origin and per-op slow thresholds; overrides replace defaults
 * only for the ops they name. */
export type SampleOptions = Clock & { thresholds?: Thresholds }

/** Selection result and ordinary op/minute keys to pass to the next call. */
export type Sample = { trace?: Trace; sampled: ReadonlySet<string> }

/** Select a root-first span tree, as returned by @yaks/trace record(). Every
 * completed root strictly past its threshold is selected, without consuming
 * the ordinary sample slot. No root start event is selected. */
export let sample = (
  spans: readonly Event[],
  options: SampleOptions,
  sampled: ReadonlySet<string> = new Set(),
): Sample => {
  let root = spans[0]
  if (!root || root.stage == 'start') return { sampled }
  let ms = root.stage == 'instant' ? 0 : root.duration
  if (ms == null) return { sampled }
  let start = root.start ?? root.time
  let at = options.origin + start
  let key = JSON.stringify([root.kind, minute(at)])
  let threshold = options.thresholds?.[root.kind] ?? thresholds[root.kind]
  let slow = threshold != null && ms > threshold
  if (!slow && sampled.has(key)) return { sampled }
  if (!slow) sampled = new Set([...sampled, key])
  let ids = new Map(spans.map((e, i) => [e.id, String(i)]))
  return {
    sampled,
    trace: {
      op: root.kind,
      name: root.name,
      at: new Date(at).toISOString(),
      ms,
      spans: spans.map((e) => ({
        id: ids.get(e.id)!,
        ...e.parent != null && ids.has(e.parent)
          ? { parent: ids.get(e.parent)! }
          : {},
        kind: e.kind,
        name: e.name,
        ...e.plugin != null ? { plugin: e.plugin } : {},
        start: (e.start ?? e.time) - start,
        ...e.stage == 'instant'
          ? { ms: 0 }
          : e.duration != null
          ? { ms: e.duration }
          : {},
        ...e.outcome != null ? { outcome: e.outcome } : {},
        ...e.counts != null ? { counts: { ...e.counts } } : {},
      })),
    },
  }
}
