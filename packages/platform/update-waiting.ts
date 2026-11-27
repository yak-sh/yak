import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { VocabDoc } from '@yaks/vocab'
import type { Kept } from '@yaks/api/reached'
import { PLATFORM_STORE } from './names.ts'
import waitingJson from './vocab/waiting.vocab.json' with { type: 'json' }

/** The page graph's read of the signed-in person's Updates badges. */
export let UPDATE_WAITING = '.updateWaiting'

/** The badge for one space, identified by the space even if it is renamed. */
export type UpdateWaiting = { space: string; slug: string; count: number }

export let waitingWords: VocabDoc = waitingJson as VocabDoc

export let waitingBundle = (
  person: string,
  waiting: UpdateWaiting,
): Bundle => ({
  entity: { eid: derivedEid(`update-waiting|${person}|${waiting.space}`) },
  updateWaiting: waiting,
})

export let waitingCounts = (rows: Bundle[]): Map<string, number> =>
  new Map(rows.flatMap(({ updateWaiting }) => {
    let waiting = updateWaiting as UpdateWaiting | undefined
    return waiting ? [[waiting.slug, waiting.count]] : []
  }))

type Source = (emit: (frame: Kept) => void) => () => void
type Seat = {
  bundle: Bundle
  count?: number | null
  revision?: number
  stop?: () => void
}

/** Join the directory's seats and offers to each seated Operator's answer.
 * The directory controls membership, so a departed space leaves immediately
 * even if its Operator has yet to close its socket. */
export let watchWaiting = (
  directory: Source,
  operator: (seat: Bundle) => Source,
  emit: (frame: Kept) => void,
): () => void => {
  let seats = new Map<string, Seat>()
  let sent: Map<string, UpdateWaiting> | undefined
  let directoryRevision: number | undefined
  let last: Record<string, number> | undefined
  let closed = false, reconciling = false
  let publish = () => {
    if (closed || reconciling) return
    if (!sent && [...seats.values()].some((s) => s.count === undefined)) return
    let next = new Map<string, UpdateWaiting>()
    let bundles: Bundle[] = []
    let revision: Record<string, number> = {}
    if (directoryRevision !== undefined) {
      revision[PLATFORM_STORE] = directoryRevision
    }
    for (let [eid, seat] of seats) {
      let { bundle, count } = seat
      if (count == null) continue
      let directory = waitingFrom(bundle)
      if (seat.revision !== undefined) {
        revision[`operator/${directory.space}`] = seat.revision
      }
      let waiting = { ...directory, count: directory.count + count }
      next.set(eid, waiting)
      let old = sent?.get(eid)
      if (old?.slug != waiting.slug || old.count != waiting.count) {
        bundles.push({ entity: { eid }, updateWaiting: waiting })
      }
    }
    let gone = [...(sent?.keys() ?? [])].filter((eid) => !next.has(eid))
    let reset = !sent
    sent = next
    if (reset || bundles.length || gone.length) {
      let since = last
      last = revision
      emit({
        bundles,
        revision,
        since,
        ...reset ? { reset } : {},
        ...gone.length ? { gone } : {},
      })
    }
  }
  let stop = directory((frame) => {
    if (closed) return
    if (frame.refused) {
      if (!sent) emit(frame)
      return
    }
    if (!frame.bundles) return
    if (typeof frame.revision == 'number') directoryRevision = frame.revision
    reconciling = true
    let rows = new Set(frame.bundles.map((b) => b.entity.eid))
    for (let [eid, seat] of seats) {
      if (rows.has(eid)) continue
      seats.delete(eid)
      seat.stop?.()
    }
    for (let bundle of frame.bundles) {
      let { eid } = bundle.entity
      let held = seats.get(eid)
      if (held) {
        held.bundle = bundle
        continue
      }
      let seat: Seat = { bundle }
      seats.set(eid, seat)
      seat.stop = operator(bundle)((answer) => {
        if (closed || seats.get(eid) !== seat) return
        if (!answer.refused && !answer.bundles) return
        let row = answer.bundles?.[0]
        seat.count = row ? waitingFrom(row).count : null
        if (typeof answer.revision == 'number') seat.revision = answer.revision
        publish()
      })
    }
    reconciling = false
    publish()
  })
  return () => {
    closed = true
    stop()
    for (let seat of seats.values()) seat.stop?.()
    seats.clear()
  }
}

export let waitingFrom = (row: Bundle) => row.updateWaiting as UpdateWaiting
