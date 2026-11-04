// A page's subscriptions use the same listing and row names as its HTTP
// query. Socket ownership and transport stay with the host.
import { type Frame, type PeerWriter, type Sink, type Subs } from '@yaks/api'
import { type Bundle } from '@yaks/graph'
import { after } from '@yaks/fp'
import type { Vocab } from '@yaks/vocab'
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
    query: (line: string) => string
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
      wrapped.set(
        sink,
        held = (f) => {
          if (!f.bundles) return sink(f)
          // What a projection reaches rides beside the rows, in the same
          // words.
          let bundles = f.bundles.map(kind)
          let peers = f.peers?.map(kind)
          let rode = peers ? { peers } : {}
          after(names([...bundles, ...peers ?? []]), (said) => {
            let spoken: Frame & Partial<Names> = Object.keys(said.names).length
              ? { ...f, bundles, ...rode, ...said }
              : { ...f, bundles, ...rode }
            sink(spoken)
          })
        },
      )
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
        typeof line == 'string' ? query(line) : line,
        opts,
      ),
    open: (sink, id, line, opts) =>
      subs.open(
        by(sink),
        id,
        line === true ? line : query(line),
        opts,
      ),
    restore: (openings, deferStatic) =>
      subs.restore(
        openings.map(({ sink, id, query: line, opts }) => ({
          sink: by(sink),
          id,
          query: line === true ? line : query(line),
          opts,
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
