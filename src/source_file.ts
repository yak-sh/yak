// Shared machinery for file-backed Sources (source.ts): a provider transcript
// store on disk materializes each past session as a pass-through entity — its
// session + doc comps on resolve, its log tail streamed on entries — with ZERO
// rows landing in sqlite. The three stores (claude projects → source_session,
// codex rollouts → source_codex, managed logs → source_managed) differ only in
// how they LOCATE a session and which ingest DOOR their files speak; the
// resolve/entries/observe/index machinery is one aspect (M-14942), factored
// here so a new store is a thin walk, not a fourth copy.
//
// Identity is deterministic so a read is idempotent and a future graduation
// (T-17796) can hydrate the exact eid: stores keyed by a provider session id
// derive eid = uuid v5 of the sid (sidEid); the managed store is keyed by our
// own eid, so it skips the derivation. server-only (node:crypto), so this never
// rides to the browser the way types.ts does.

import { createHash } from 'node:crypto'
import type { Change } from './types.ts'
import { adapters } from './adapters.ts'
import { ingestEntries, ingestTranscript } from './ingest.ts'
import type { EntryRow, OwnedEntrySourceOutcome, Source } from './source.ts'

// A fixed namespace so the derivation is stable forever. uuid v5 = sha1 of
// (namespace bytes ++ name bytes), version/variant bits stamped.
let NS = '6b6f1f6e-0b6a-5f42-9a2e-7a3d5c9e1f00'
let hex = (s: string) => s.replaceAll('-', '')
let bytesOf = (h: string) =>
  Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)))

export let sidEid = (sid: string): string => {
  let h = createHash('sha1')
  h.update(bytesOf(hex(NS)))
  h.update(new TextEncoder().encode(sid))
  let d = h.digest() // 20 bytes
  let b = d.subarray(0, 16)
  b[6] = (b[6] & 0x0f) | 0x50 // version 5
  b[8] = (b[8] & 0x3f) | 0x80 // variant
  let s = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${
    s.slice(16, 20)
  }-${s.slice(20)}`
}

// One located session: its handle (sid), our deterministic eid, the file, and
// its provider. `provider` may be empty when only the file's CONTENT can tell
// (managed logs are the provider's stream but the store doesn't name which) —
// fileSource then asks the store's sniff() once the lines are read.
export type Located = {
  sid: string
  eid: string
  path: string
  provider: string
  origin: 'native' | 'managed'
}

// A directory-walk index (filenames, not contents) cached with a short TTL, so
// a burst of resolves shares one walk but a just-created session isn't invisible
// for long. Returns a locate() over both maps and a forget() for tests / a
// post-write refresh.
export let indexer = (walk: () => Located[], ttl = 5_000) => {
  let cache:
    | { at: number; byEid: Map<string, Located>; bySid: Map<string, Located> }
    | undefined
  let build = () => {
    let byEid = new Map<string, Located>()
    let bySid = new Map<string, Located>()
    for (let loc of walk()) {
      byEid.set(loc.eid, loc)
      bySid.set(loc.sid, loc)
    }
    return { byEid, bySid }
  }
  let index = () => {
    let now = Date.now()
    if (!cache || now - cache.at > ttl) cache = { at: now, ...build() }
    return cache
  }
  let locate = (id: string): Located | undefined => {
    let ix = index()
    return ix.byEid.get(id) ?? ix.bySid.get(id)
  }
  let forget = () => {
    cache = undefined
  }
  return { locate, forget }
}

export let readLines = (path: string): string[] => {
  try {
    return Deno.readTextFileSync(path).trim().split('\n')
  } catch {
    return []
  }
}

let readTranscript = (
  path: string,
): { lines: string[] } | { reason: 'missing' | 'unreadable' } => {
  try {
    return { lines: Deno.readTextFileSync(path).trim().split('\n') }
  } catch (error) {
    return {
      reason: error instanceof Deno.errors.NotFound ? 'missing' : 'unreadable',
    }
  }
}

// The session's own facts, read from the transcript on demand: the adapter's
// observe() states the model/provider a conversation reveals.
let observe = (
  provider: string,
  lines: string[],
): Record<string, unknown> => {
  let ad = adapters[provider]
  let patch: Record<string, unknown> = { provider }
  for (let line of lines) {
    try {
      Object.assign(patch, ad?.observe?.(JSON.parse(line)) ?? {})
    } catch { /* a malformed line carries no facts */ }
  }
  return patch
}

// The ingest door a store's transcript speaks. A managed log is the provider's
// managed STREAM (ingestEntries → codexEntries / claudeEntries); an interactive
// store (claude projects, codex rollouts) is the provider's own TRANSCRIPT
// (ingestTranscript → the rollout dialect for codex). Same source-coordinate,
// cursor and shape either way — only the line grammar differs.
export type Door = 'stream' | 'transcript'
let ingest = (
  door: Door,
) => (door == 'stream' ? ingestEntries : ingestTranscript)

// Ingest mappers mint UUIDs because the durable append path calls them once.
// A file Source calls them on every read, so replace those transient ids with a
// stable identity derived from the source session and recognized-entry
// coordinate. Rewrite same-batch references (notably result.call) with it too.
let remapIds = (value: unknown, ids: Map<string, string>): unknown => {
  if (typeof value == 'string') return ids.get(value) ?? value
  if (Array.isArray(value)) return value.map((item) => remapIds(item, ids))
  if (!value || typeof value != 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, remapIds(item, ids)]),
  )
}

// resolve + entries for a store, given how to locate a session, which door its
// files speak, and (only for a store whose files don't name their provider) how
// to sniff the provider from the content. session/doc/title shaping is shared.
export let fileSource = (opts: {
  locate: (id: string) => Located | undefined
  door: Door
  sniff?: (lines: string[]) => string
}): Source => {
  let providerOf = (loc: Located, lines: string[]) =>
    loc.provider || opts.sniff?.(lines) || ''

  let resolve = (id: string): Change[] | undefined => {
    let loc = opts.locate(id)
    if (!loc) return undefined
    let lines = readLines(loc.path)
    let provider = providerOf(loc, lines)
    let facts = observe(provider, lines)
    let session: Record<string, unknown> = {
      id: loc.sid,
      origin: loc.origin,
      transcript: loc.path,
      provider,
      ...(facts.model ? { model: facts.model } : {}),
      ...(facts.serving_model ? { serving_model: facts.serving_model } : {}),
    }
    // A short, stable title so the pass-through session renders with a name.
    let title = `Session ${loc.sid.slice(0, 8)}`
    return [
      { eid: loc.eid, name: 'session', comp: session },
      { eid: loc.eid, name: 'doc', comp: { title } },
    ]
  }

  // The transcript tail, shaped exactly as db.ts entryRows() shapes a persisted
  // one, so the existing entriesOf path (graphLog readers, T-16798) serves it
  // unchanged — WITHOUT materializing an entry row. seq is a monotonic counter
  // over the entries the
  // adapter recognizes, stable across reads, so a tailing reader's `after`
  // cursor advances the same way it would on a persisted partition.
  let entries = (
    handle: string,
    after: number,
    limit: number,
  ): OwnedEntrySourceOutcome | undefined => {
    let loc = opts.locate(handle)
    if (!loc) return undefined
    let read = readTranscript(loc.path)
    if ('reason' in read) return { state: 'failed', reason: read.reason }
    let { lines } = read
    let provider = providerOf(loc, lines)
    let ad = adapters[provider]
    if (!ad) return { state: 'empty', entries: [] }
    let map = ingest(opts.door)
    let state = { calls: new Map<string, string>() }
    let out: EntryRow[] = []
    let seq = 0
    let parsed = 0
    for (let line of lines) {
      if (!line.trim()) continue
      let e: unknown
      try {
        e = JSON.parse(line)
      } catch {
        continue // a malformed line carries no entry
      }
      // JSON syntax alone does not make a provider record. `null`, scalars and
      // arrays would otherwise reach dialect mappers as Event and either throw
      // or masquerade as an authoritatively empty transcript. Mapper exceptions
      // are programming/provider-adapter failures and deliberately stay loud;
      // only invalid source DATA is classified as malformed here.
      if (!e || typeof e != 'object' || Array.isArray(e)) {
        return { state: 'failed', reason: 'malformed' }
      }
      parsed++
      let batch = map(ad.dialect, e as Record<string, unknown>, state)
      let ids = new Map(
        batch.ids.map((
          id,
          i,
        ) => [id, sidEid(`${loc.eid}:entry:${seq + i + 1}`)]),
      )
      batch.ids = batch.ids.map((id) => ids.get(id)!)
      batch.specs = batch.specs.map((spec) =>
        remapIds(spec, ids) as typeof spec
      )
      batch.calls = batch.calls.map(([key, id]) => [key, ids.get(id) ?? id])
      for (let [key, id] of batch.calls) state.calls.set(key, id)
      for (let [i, spec] of batch.specs.entries()) {
        seq++
        if (seq <= after) continue
        let entryEid = batch.ids[i]
        let comps: Record<string, Record<string, unknown>> = {
          entry: { eid: entryEid, session: loc.eid, seq },
        }
        for (let [name, comp] of Object.entries(spec)) {
          comps[name] = { eid: entryEid, ...(comp as Record<string, unknown>) }
        }
        out.push({ eid: entryEid, seq, comps })
        if (out.length >= limit) return { state: 'found', entries: out }
      }
    }
    if (!parsed && lines.some((line) => line.trim())) {
      return { state: 'failed', reason: 'malformed' }
    }
    // A cursor beyond a non-empty transcript is still a found source, merely
    // with an empty PAGE. `empty` is reserved for an authoritatively entryless
    // transcript.
    return seq
      ? { state: 'found', entries: out }
      : { state: 'empty', entries: [] }
  }

  return { resolve, entries }
}
