// File-source outcomes keep an empty transcript distinct from an absent or
// unreadable one. These are source states, not renderer branches: entries still
// flow through the ordinary `.entry.session=` partition when present.
Deno.env.set('DB_PATH', ':memory:')

import { assertEquals } from '@std/assert'
import { apply, sourceEntriesOf } from './db.ts'
import { addSource, clearSources } from './source.ts'
import { fileSource, type Located, sidEid } from './source_file.ts'
import { freshDb } from './testdb.ts'

let root = Deno.makeTempDirSync()
let paths = {
  missing: `${root}/missing.jsonl`,
  unreadable: `${root}/not-a-file`,
  malformed: `${root}/malformed.jsonl`,
  empty: `${root}/empty.jsonl`,
}
Deno.mkdirSync(paths.unreadable)
Deno.writeTextFileSync(paths.malformed, 'not json\nstill not json')
Deno.writeTextFileSync(
  paths.empty,
  JSON.stringify({ type: 'session_meta', payload: { session_id: 'empty' } }),
)

let located = new Map<string, Located>()
for (let [sid, path] of Object.entries(paths)) {
  located.set(sid, {
    sid,
    eid: sidEid(sid),
    path,
    provider: 'codex',
    origin: 'native',
  })
}
let source = fileSource({
  locate: (handle) => located.get(handle),
  door: 'transcript',
})

let outcome = (sid?: string) => {
  let db = freshDb()
  let eid = crypto.randomUUID()
  if (sid) apply(db, [{ eid, name: 'session', comp: { id: sid } }])
  let result = sourceEntriesOf(db, eid)
  db.close()
  return result
}

Deno.test('file source: missing metadata path is an explicit failure', () => {
  let off = addSource(source)
  try {
    assertEquals(outcome('missing'), { state: 'failed', reason: 'missing' })
  } finally {
    off()
    clearSources()
  }
})

Deno.test('file source: unreadable and malformed transcripts are explicit failures', () => {
  let off = addSource(source)
  try {
    assertEquals(outcome('unreadable'), {
      state: 'failed',
      reason: 'unreadable',
    })
    assertEquals(outcome('malformed'), {
      state: 'failed',
      reason: 'malformed',
    })
  } finally {
    off()
    clearSources()
  }
})

Deno.test('file source: readable transcript with no recognized rows is authoritative empty', () => {
  let off = addSource(source)
  try {
    assertEquals(outcome('empty'), { state: 'empty', entries: [] })
  } finally {
    off()
    clearSources()
  }
})

Deno.test('file source: absent provider metadata is undiscoverable, not empty', () => {
  let off = addSource(source)
  try {
    assertEquals(outcome(), { state: 'undiscoverable' })
  } finally {
    off()
    clearSources()
  }
})
