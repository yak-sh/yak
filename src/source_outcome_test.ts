// File-source outcomes keep an empty transcript distinct from an absent or
// unreadable one. These are source states, not renderer branches: entries still
// flow through the ordinary `.entry.session=` partition when present.
Deno.env.set('DB_PATH', ':memory:')

import { assertEquals, assertStrictEquals, assertThrows } from '@std/assert'
import { adapters } from './adapters.ts'
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
let invalid = [
  { sid: 'codex-null', provider: 'codex', value: null },
  { sid: 'codex-scalar', provider: 'codex', value: 7 },
  { sid: 'claude-array', provider: 'claude', value: ['not', 'an', 'event'] },
]
for (let { sid, provider, value } of invalid) {
  let path = `${root}/${sid}.jsonl`
  Deno.writeTextFileSync(path, JSON.stringify(value))
  located.set(sid, {
    sid,
    eid: sidEid(sid),
    path,
    provider,
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
  try {
    return sourceEntriesOf(db, eid)
  } finally {
    db.close()
  }
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

Deno.test('file source: valid non-object JSON is malformed across provider dialects', () => {
  let off = addSource(source)
  try {
    for (let { sid } of invalid) {
      assertEquals(outcome(sid), { state: 'failed', reason: 'malformed' })
    }
  } finally {
    off()
    clearSources()
  }
})

Deno.test('file source: an adapter exception stays visible, never malformed', () => {
  let sid = 'throwing-adapter'
  let path = `${root}/${sid}.jsonl`
  Deno.writeTextFileSync(path, JSON.stringify({ type: 'event_msg' }))
  located.set(sid, {
    sid,
    eid: sidEid(sid),
    path,
    provider: sid,
    origin: 'native',
  })
  let failure = new Error('adapter exploded')
  adapters[sid] = {
    ...adapters.codex,
    get dialect(): 'codex' {
      throw failure
    },
  }
  let off = addSource(source)
  try {
    assertStrictEquals(assertThrows(() => outcome(sid)), failure)
  } finally {
    off()
    clearSources()
    delete adapters[sid]
    located.delete(sid)
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
