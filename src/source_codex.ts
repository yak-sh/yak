// The codex-native file-backed Source: every past interactive codex session
// (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl) materializes on READ as a
// pass-through entity, over the shared machinery (source_file.ts). Codex's
// rollout is a DISTINCT dialect from `codex exec --json` (ingest.ts) — the
// 'transcript' door speaks it. The sid rides the rollout FILENAME
// (rollout-<iso>-<uuid>.jsonl) and also its session_meta header; the filename
// keeps the walk contents-free, so we read it from there. eid = uuid v5 of the
// sid (sidEid), the same derivation the claude store uses, so a future
// graduation can hydrate the exact eid.

import type { Located } from './source_file.ts'
import { fileSource, indexer, sidEid } from './source_file.ts'
import { addSource } from './source.ts'

let home = () => Deno.env.get('HOME') ?? ''
// Mirrors sessions.ts transcriptStores().codex, with a test lever.
let codexStore = () =>
  Deno.env.get('CODEX_SESSIONS') ??
    `${Deno.env.get('CODEX_HOME') ?? `${home()}/.codex`}/sessions`

// The uuid a rollout filename ends with: rollout-<iso-with-dashes>-<uuid>.jsonl.
// The timestamp segment has dashes too, so match the uuid SHAPE at the tail
// rather than splitting on '-'.
let SID =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i

// A recursive walk over the date-nested store, filenames only — cheap relative
// to reading a rollout. Each rollout-*.jsonl whose name yields a sid is one
// located session.
let walk = (): Located[] => {
  let out: Located[] = []
  let visit = (dir: string) => {
    let entries: Deno.DirEntry[] = []
    try {
      entries = [...Deno.readDirSync(dir)]
    } catch {
      return // no store yet, or an unreadable day
    }
    for (let e of entries) {
      let path = `${dir}/${e.name}`
      if (e.isDirectory) {
        visit(path)
        continue
      }
      if (
        !e.isFile || !e.name.startsWith('rollout-') ||
        !e.name.endsWith('.jsonl')
      ) {
        continue
      }
      let m = e.name.match(SID)
      if (!m) continue
      let sid = m[1]
      out.push({
        sid,
        eid: sidEid(sid),
        path,
        provider: 'codex',
        origin: 'native',
      })
    }
  }
  visit(codexStore())
  return out
}

let { locate, forget } = indexer(walk)

// Force an index rebuild — tests and a post-write refresh.
export let forgetCodexIndex = forget

let source = fileSource({ locate, door: 'transcript' })

// Registered once at server boot (server.ts), alongside the claude and managed
// sources. Returns the remover, per the registry contract.
export let registerCodexSource = () => addSource(source)
