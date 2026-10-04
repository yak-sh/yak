// Named server watches over a generic client: shared wires, readiness retained
// across reconnects, and landed frames delivered to their owning watch names.
import { batch } from '@preact/signals'
import { type Client, client, type Watch, wireIdb } from './mod.ts'
import { type Bundle } from '@yaks/graph'
import { type Frame, replicate, type Socket } from '@yaks/sync'
import type { Vocab } from '@yaks/vocab'
// A socket that answers nothing: the replica of a process with no host (a
// test), where frames only ever arrive through `receive`.
export let quiet = (): Socket => ({
  readyState: 1,
  send: () => {},
  close: () => {},
  addEventListener: () => {},
})

// The page draws an entity by whatever components it carries (the registry
// matches on any of them), so every line it watches asks for all of them: `*`,
// the query grammar's widest projection (@yaks/graph `wanted`). A line that
// already says what it answers keeps it: `.fields=` names each row's columns,
// and a `.count` answers no rows.
export let entire = (line: string): string =>
  /(^|&)(\*|\.count|\.fields=[^&]*)(&|$)/.test(line)
    ? line
    : line
    ? `${line}&*`
    : '*'

export type NamedClient = {
  box: Client
  open(sub: string, line: string): void
  close(sub: string): void
  receive(sub: string, frame: Omit<Frame, 'id'>): void
  active(): number
  retry(sub: string): void
  has(sub: string): boolean
  members(sub: string): string[]
  ready(sub: string): boolean
  patch(bundles: Bundle[]): Bundle[] | Promise<Bundle[]>
}
export let namedClient = (opts: {
  vocab: Vocab
  wireVault?: Parameters<typeof wireIdb>[0]
  url: string
  connect: (url: string) => Socket
  changed: (eids: string[]) => void
  ready: (sub: string) => void
  // A frame the socket carried, once the box has landed it, with the names
  // whose line it answers and whether it replaced the whole set.
  frame: (subs: string[], f: Frame, reset: boolean) => void
}): NamedClient => {
  let handles = new Map<string, { line: string; watch: Watch }>()
  let named = new Map<string, Set<string>>() // line -> the names holding it
  let lines = new Map<string, string>() // wire id -> line
  let fresh = new Set<string>() // wire ids whose next frame is the whole set
  let answered = new Set<string>() // lines the host has answered
  let deliver: ((event: Event & { data?: unknown }) => void) | undefined
  let tap = (s: Socket): Socket => ({
    get readyState() {
      return s.readyState
    },
    send: (text) => {
      let m = JSON.parse(text)
      if (typeof m.subscribe == 'string') {
        lines.set(m.id, m.subscribe)
        fresh.add(m.id)
      } else if (m.unsubscribe) {
        lines.delete(m.unsubscribe)
        fresh.delete(m.unsubscribe)
      }
      s.send(text)
    },
    close: () => s.close(),
    addEventListener: (type, fn) => {
      if (type != 'message') return s.addEventListener(type, fn)
      // A message is one frame, or several the host batched for one
      // acknowledgement (@yaks/sync `frames`); each is reported alike.
      let land = (e: Event & { data?: unknown }) => {
        let packet = JSON.parse(String(e.data)) as Frame | { frames: Frame[] }
        let frames = 'frames' in packet ? packet.frames : [packet]
        let lined = frames.map((f) => ({
          f,
          line: f.id ? lines.get(f.id) : undefined,
        }))
        // Taken back before the box hears it, so the unready it reports
        // reads as no answer.
        for (let { f, line } of lined) {
          if (line && f.refused) answered.delete(line)
        }
        fn(e)
        for (let { f, line } of lined) {
          if (!line) continue
          let reset = !f.refused && (fresh.delete(f.id) || !!f.reset)
          opts.frame([...named.get(line) ?? []], f, reset)
        }
      }
      deliver = land
      // Frames land in batches (T-37445): every frame the socket has carried
      // by the time the timer turns lands inside one signals batch, so a
      // burst of answers is one render pass, not one per frame. A macrotask is
      // the coalescing point on purpose: the message events already queued
      // behind this one run before it.
      let arrived: (Event & { data?: unknown })[] = []
      s.addEventListener(type, (e: Event & { data?: unknown }) => {
        arrived.push(e)
        if (arrived.length > 1) return
        setTimeout(() => {
          let frames = arrived
          arrived = []
          batch(() => frames.forEach(land))
        })
      })
    },
  })
  let box: Client = client(opts.vocab, [], {
    url: opts.url,
    connect: (url) => tap(opts.connect(url)),
    vault: false,
    retainUnownedProps: true,
    provenance: () => null,
    wireVault: opts.wireVault && globalThis.indexedDB
      ? wireIdb(opts.wireVault)
      : false,
    // Local writes use echoed patches below, never sync's automatic POST.
    fetch: () => {
      throw new Error('writes leave through the durable outbox (live.ts)')
    },
    report: (r) => {
      let error = r.error
      if (r.refused) {
        error = Object.assign(new Error(r.refused.message), {
          name: r.refused.error,
        })
      }
      // The page tracker captures console.error's first argument.
      if (error) {
        let message = error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error)
        console.error(`live client — ${message}`, error)
      }
    },
  })
  box.cache.onRows(opts.changed)
  let open = (sub: string, line: string) => {
    if (handles.get(sub)?.line === line) return
    close(sub)
    let wire = entire(line)
    let watch = box.watch(wire, { evaluate: 'server' })
    handles.set(sub, { line, watch })
    let names = named.get(wire) ?? new Set()
    named.set(wire, names.add(sub))
    let heard = () => {
      if (watch.ready) answered.add(wire)
      opts.ready(sub)
    }
    watch.subscribe(heard)
    heard()
  }
  let close = (sub: string) => {
    let h = handles.get(sub)
    if (!h) return
    handles.delete(sub)
    let wire = entire(h.line)
    let names = named.get(wire)
    names?.delete(sub)
    if (!names?.size) {
      named.delete(wire)
      answered.delete(wire)
    }
    h.watch.close()
  }
  // A host's already-normalized frame lands through the very same listener
  // as a socket message, preserving watch coverage and refusal behavior.
  let receive = (sub: string, body: Omit<Frame, 'id'>) => {
    let h = handles.get(sub)
    let id = h && [...lines].find(([, line]) => line === entire(h.line))?.[0]
    if (id && deliver) {
      deliver(
        { data: JSON.stringify({ ...body, id }) } as Event & { data: string },
      )
    }
  }
  return {
    box,
    open,
    close,
    receive,
    active: () => handles.size,
    retry: (sub: string) => {
      let h = handles.get(sub)
      if (!h) return
      handles.delete(sub)
      h.watch.close()
      open(sub, h.line)
    },
    has: (sub: string) => handles.has(sub),
    members: (sub: string) =>
      handles.get(sub)?.watch.value.map((b) => b.entity.eid) ?? [],
    ready: (sub: string) => {
      let h = handles.get(sub)
      return !!h && answered.has(entire(h.line))
    },
    patch: (bundles: Bundle[]) => replicate(box.graph, bundles),
  }
}
