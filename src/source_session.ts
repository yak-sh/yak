// A file-backed Source (source.ts) over the provider transcript stores: every
// past interactive session materializes on READ as a pass-through entity — its
// session + doc comps derived from the transcript, its log tail streamed from
// the file — without a single row landing in sqlite. This is what restores
// legacy-session resolution after the D-17790 import purge: the sessions and
// their ~110k transcript lines live on disk, not in the graph, until a real
// write graduates one (T-17796).
//
// Identity is deterministic — eid = uuid v5 of the sid — so the same transcript
// always materializes as the same eid across reads (idempotent), and a future
// graduation can hydrate that exact eid. The read doors consult this only AFTER
// SQL misses, so a persisted (live or graduated) session never reaches here and
// is never double-counted.
//
// Scope note: this covers the claude native store (~/.claude/projects). The
// codex store and managed logs (~/.tasks/logs), and `list()` over ephemeral
// sessions on boards, are follow-ups — see the report on T-17795. resolve() and
// entries() are the pieces that make a purged session OPEN and show its tail.

import { createHash } from 'node:crypto'
import type { Change } from './types.ts'
import { adapters } from './adapters.ts'
import { ingestTranscript } from './ingest.ts'
import type { EntryRow, Source } from './source.ts'
import { addSource } from './source.ts'

// A fixed namespace so the derivation is stable forever. uuid v5 = sha1 of
// (namespace bytes ++ name bytes), with the version/variant bits stamped —
// synchronous (node:crypto), server-only, so this module never rides to the
// browser the way types.ts does.
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

let home = () => Deno.env.get('HOME') ?? ''
// Overridable so a test points the source at its own temp store rather than the
// operator's real ~/.claude — the same lever transcriptStores() exposes.
let claudeStore = () =>
  Deno.env.get('CLAUDE_PROJECTS') ?? `${home()}/.claude/projects`

type Located = { sid: string; eid: string; path: string; provider: string }

// The index is a directory walk (filenames, not contents), so it is cheap
// relative to reading a transcript. Cached with a short TTL: a resolve on a
// just-created session that missed the last scan falls through to a rebuild
// rather than staying invisible, but a burst of resolves shares one walk.
let cache: {
  at: number
  byEid: Map<string, Located>
  bySid: Map<string, Located>
} | undefined
let TTL = 5_000

let walk = (): { byEid: Map<string, Located>; bySid: Map<string, Located> } => {
  let byEid = new Map<string, Located>()
  let bySid = new Map<string, Located>()
  let root = claudeStore()
  let projects: Deno.DirEntry[] = []
  try {
    projects = [...Deno.readDirSync(root)]
  } catch {
    return { byEid, bySid } // no store yet
  }
  for (let project of projects) {
    if (!project.isDirectory) continue
    let dir = `${root}/${project.name}`
    let files: Deno.DirEntry[] = []
    try {
      files = [...Deno.readDirSync(dir)]
    } catch {
      continue
    }
    for (let f of files) {
      if (!f.isFile || !f.name.endsWith('.jsonl')) continue
      let sid = f.name.slice(0, -'.jsonl'.length)
      let loc: Located = {
        sid,
        eid: sidEid(sid),
        path: `${dir}/${f.name}`,
        provider: 'claude',
      }
      byEid.set(loc.eid, loc)
      bySid.set(sid, loc)
    }
  }
  return { byEid, bySid }
}

let index = () => {
  let now = Date.now()
  if (!cache || now - cache.at > TTL) cache = { at: now, ...walk() }
  return cache
}

// Force a rebuild — tests and a post-write refresh.
export let forgetSessionIndex = () => {
  cache = undefined
}

// A handle → the located transcript: by our deterministic eid, or by the raw
// sid (the numberless handle a purged session still answers to).
let locate = (id: string): Located | undefined => {
  let ix = index()
  return ix.byEid.get(id) ?? ix.bySid.get(id)
}

let readLines = (path: string): string[] => {
  try {
    return Deno.readTextFileSync(path).trim().split('\n')
  } catch {
    return []
  }
}

// The session's own facts, read from the transcript on demand: the adapter's
// observe() states the model/provider a conversation reveals. cheap-ish (one
// file), and only ever for the one session actually being opened.
let observe = (loc: Located, lines: string[]): Record<string, unknown> => {
  let ad = adapters[loc.provider]
  let patch: Record<string, unknown> = { provider: loc.provider }
  for (let line of lines) {
    try {
      Object.assign(patch, ad?.observe?.(JSON.parse(line)) ?? {})
    } catch { /* a malformed line carries no facts */ }
  }
  return patch
}

let resolve = (id: string): Change[] | undefined => {
  let loc = locate(id)
  if (!loc) return undefined
  let lines = readLines(loc.path)
  let facts = observe(loc, lines)
  let session: Record<string, unknown> = {
    id: loc.sid,
    origin: 'native',
    transcript: loc.path,
    provider: loc.provider,
    ...(facts.model ? { model: facts.model } : {}),
  }
  // A short, stable title so the pass-through session renders with a name.
  let title = `Session ${loc.sid.slice(0, 8)}`
  return [
    { eid: loc.eid, name: 'session', comp: session },
    { eid: loc.eid, name: 'doc', comp: { title } },
  ]
}

// The transcript tail, shaped exactly as db.ts entryRows() shapes a persisted
// one, so the existing /logs + entriesOf path serves it unchanged — WITHOUT
// materializing an entry row. seq is a monotonic counter over the entries the
// adapter recognizes, stable across reads (same file → same order), so a
// tailing reader's `after` cursor advances the same way it would on a persisted
// partition.
let entries = (eid: string, after: number, limit: number): EntryRow[] => {
  let loc = locate(eid)
  if (!loc) return []
  let ad = adapters[loc.provider]
  if (!ad) return []
  let dialect = ad.dialect
  let state = { calls: new Map<string, string>() }
  let out: EntryRow[] = []
  let seq = 0
  for (let line of readLines(loc.path)) {
    if (!line.trim()) continue
    let e
    try {
      e = JSON.parse(line)
    } catch {
      continue // a malformed line carries no entry
    }
    let batch = ingestTranscript(dialect, e, state)
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
      if (out.length >= limit) return out
    }
  }
  return out
}

let source: Source = { resolve, entries }

// Registered once at server boot (server.ts). Returns the remover, as the
// registry contract asks, so a test or a hot reload can withdraw it.
export let registerSessionSource = () => addSource(source)
