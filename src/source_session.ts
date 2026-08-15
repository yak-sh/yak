// The claude-native file-backed Source: every past interactive claude session
// (~/.claude/projects/<project>/<sid>.jsonl) materializes on READ as a
// pass-through entity — session + doc comps from the transcript, log tail
// streamed from the file — without a single row landing in sqlite. This is what
// restores legacy-session resolution after the D-17790 import purge for claude
// sessions; source_codex and source_managed cover the other two stores over the
// same machinery (source_file.ts). The read doors consult sources only AFTER SQL
// misses, so a persisted (live or graduated) session never reaches here.

import type { Located } from './source_file.ts'
import { fileSource, indexer, sidEid } from './source_file.ts'
import { addSource } from './source.ts'

// Re-exported: source_file owns the derivation now, but callers (and the codex
// source, and tests) still reach it here.
export { sidEid }

let home = () => Deno.env.get('HOME') ?? ''
// Overridable so a test points the source at its own temp store rather than the
// operator's real ~/.claude.
let claudeStore = () =>
  Deno.env.get('CLAUDE_PROJECTS') ?? `${home()}/.claude/projects`

// The store is a two-level walk: <project>/<sid>.jsonl. Filenames only (never
// contents), so the index stays cheap relative to reading a transcript.
let walk = (): Located[] => {
  let out: Located[] = []
  let root = claudeStore()
  let projects: Deno.DirEntry[] = []
  try {
    projects = [...Deno.readDirSync(root)]
  } catch {
    return out // no store yet
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
      out.push({
        sid,
        eid: sidEid(sid),
        path: `${dir}/${f.name}`,
        provider: 'claude',
        origin: 'native',
      })
    }
  }
  return out
}

let { locate, forget } = indexer(walk)

// Force an index rebuild — tests and a post-write refresh.
export let forgetSessionIndex = forget

let source = fileSource({ locate, door: 'transcript' })

// Registered once at server boot (server.ts). Returns the remover, as the
// registry contract asks, so a test or a hot reload can withdraw it.
export let registerSessionSource = () => addSource(source)
