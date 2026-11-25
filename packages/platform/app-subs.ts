// A page's subscriptions use the same listing and row names as its HTTP
// query. Socket ownership and transport stay with the host.
import { type Frame, type PeerWriter, type Sink, type Subs } from '@yaks/api'
import { type Bundle, type Taken } from '@yaks/graph'
import { after, isPromise } from '@yaks/fp'
import type { Vocab } from '@yaks/vocab'
import { type Line, whole } from '@yaks/query'
import { instrumentActor } from './instrument.ts'
import type { Names } from './listing.ts'

/** The most specific component a vocabulary calls this row by. */
export let kinded = (vocab: Vocab, row: Bundle): Bundle => ({
  kind: vocab.kindOf(row as Record<string, unknown>),
  ...row,
})

/** Name every frame and screen its query, retaining sink identity on close. */
export let naming = (
  subs: Subs,
  {
    query,
    kind,
    names = () => ({ refs: [], names: {} }),
  }: {
    query: (line: Line) => Line
    kind: (row: Bundle) => Bundle
    names?: (rows: Bundle[]) => Names | Promise<Names>
  },
): Subs => {
  let wrapped = new Map<Sink, Sink>()
  let writing = (writer: PeerWriter | undefined) =>
    writer ? { ...writer, actor: instrumentActor(writer.actor) } : writer
  let by = (sink: Sink): Sink => {
    let held = wrapped.get(sink)
    if (!held) {
      let waiting: Promise<void> | undefined
      let speak = (f: Frame) => {
        if (!f.bundles && !f.peers && !f.relay) return sink(f)
        let bundles = f.bundles?.map(kind)
        let peers = f.peers?.map(kind)
        let spoken = { ...f, ...bundles && { bundles }, ...peers && { peers } }
        return after(
          names([...bundles ?? [], ...peers ?? [], ...f.relay ?? []]),
          (said) =>
            sink(
              Object.keys(said.names).length ? { ...spoken, ...said } : spoken,
            ),
        )
      }
      held = (f) => {
        let out = waiting ? waiting.then(() => speak(f)) : speak(f)
        if (!isPromise(out)) return
        let pending = waiting = out.catch(() => {})
        void pending.then(() => {
          if (waiting === pending) waiting = undefined
        })
        return out
      }
      wrapped.set(sink, held)
    }
    return held
  }
  return {
    read: subs.read,
    observe: subs.observe,
    resume: subs.resume,
    stop: subs.stop,
    snapshot: (line, opts) =>
      subs.snapshot(
        (typeof line == 'string' ? query(line as Line) : line) as Taken,
        opts,
      ),
    open: (sink, id, line, opts, writer) =>
      subs.open(
        by(sink),
        id,
        // A subscription's line, as its socket's peer asked it, whole.
        line === true ? line : query(whole(line)),
        opts,
        writer,
      ),
    restore: (openings, deferStatic) =>
      subs.restore(
        openings.map(({ sink, query: line, ...rest }) => ({
          ...rest,
          sink: by(sink),
          query: line === true ? line : query(whole(line)),
        })),
        deferStatic,
      ),
    close: (sink, id) => subs.close(by(sink), id),
    drop: (sink) => subs.drop(by(sink)),
    vocab: subs.vocab,
    commit: subs.commit,
    hear: subs.hear,
    check: subs.check,
    // Hibernated writers keep the same instrument identity as HTTP writes,
    // including attachments made with a credential's outside id.
    relay: (sink, bundles, writer) =>
      subs.relay(by(sink), bundles, writing(writer)),
    enqueue: (sink, bundles, writer) =>
      (subs.enqueue ?? subs.relay)(by(sink), bundles, writing(writer)),
    pace: subs.pace,
    save: subs.save,
    now: subs.now,
    timer: subs.timer,
    relaying: (sink) => subs.relaying(by(sink)),
    relayed: (sink, keys) => subs.relayed(by(sink), keys),
  }
}
