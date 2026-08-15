// The managed-log file-backed Source: every past MANAGED session
// (~/.tasks/logs/<eid>.jsonl — the provider stream the runner captured)
// materializes on READ as a pass-through entity, over the shared machinery
// (source_file.ts). Two things differ from the interactive stores:
//
//  - Identity is DIRECT: the log is named by our own eid, so no v5 derivation —
//    the filename IS the eid (and the sid we render). That also means a LIVE
//    managed session, whose eid has rows in sqlite, is served by SQL and never
//    reaches here; only a purged one (SQL miss) materializes from its log.
//  - The dialect isn't in the store — a managed run wrote the provider's managed
//    STREAM (claude -p / codex exec --json / fake), so we SNIFF it from the
//    content and read through the 'stream' door (ingestEntries), the same mapper
//    the runner's drain used to persist it.

import type { Located } from './source_file.ts'
import { fileSource, indexer } from './source_file.ts'
import { addSource } from './source.ts'

// Mirrors sessions.ts logsDir() (its LOGS_DIR lever included), replicated rather
// than imported so the source layer doesn't pull the whole sessions graph.
let logsDir = () =>
  Deno.env.get('LOGS_DIR') ?? `${Deno.env.get('HOME')}/.tasks/logs`

// The provider a managed log speaks, from its content. Each provider's stream
// carries distinctive top-level `type`s; runner frames (session.prompt, …) and
// unrecognized lines are skipped until one settles it. Default claude — harmless
// when a log carries no markers (entries() just finds nothing to map).
export let sniff = (lines: string[]): string => {
  for (let line of lines) {
    let t: unknown
    try {
      t = (JSON.parse(line) as { type?: unknown }).type
    } catch {
      continue
    }
    if (t == 'system' || t == 'assistant' || t == 'user') return 'claude'
    if (
      t == 'thread.started' || t == 'turn.started' || t == 'turn.completed' ||
      t == 'turn.failed' || (typeof t == 'string' && t.startsWith('item.'))
    ) return 'codex'
    if (t == 'init' || t == 'message' || t == 'tool') return 'fake'
    if (t == 'result') {
      // claude's result carries result/subtype/is_error; fake's carries
      // final_text — the one field that tells them apart.
      try {
        return 'final_text' in JSON.parse(line) ? 'fake' : 'claude'
      } catch {
        return 'claude'
      }
    }
  }
  return 'claude'
}

// Filenames only: every <eid>.jsonl in the logs dir is one managed session. The
// sibling .stderr.log/.pid/.code files fall out by the .jsonl filter. provider
// is left empty here — fileSource asks sniff() once the lines are read.
let walk = (): Located[] => {
  let out: Located[] = []
  let dir = logsDir()
  let files: Deno.DirEntry[] = []
  try {
    files = [...Deno.readDirSync(dir)]
  } catch {
    return out // no logs yet
  }
  for (let f of files) {
    if (!f.isFile || !f.name.endsWith('.jsonl')) continue
    let eid = f.name.slice(0, -'.jsonl'.length)
    out.push({
      sid: eid, // managed sessions are keyed by our own eid
      eid,
      path: `${dir}/${f.name}`,
      provider: '', // sniffed from content
      origin: 'managed',
    })
  }
  return out
}

let { locate, forget } = indexer(walk)

// Force an index rebuild — tests and a post-write refresh.
export let forgetManagedIndex = forget

let source = fileSource({ locate, door: 'stream', sniff })

// Registered once at server boot (server.ts), alongside the claude and codex
// sources. Returns the remover, per the registry contract.
export let registerManagedSource = () => addSource(source)
