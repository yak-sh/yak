// Local CLI writes use the graph kernel and journal without a serving process.
// A separate read-only HTTP process observes those commits through its feed.
import { assert, assertEquals, assertRejects } from '@std/assert'
import {
  apply,
  cursorOf,
  eager,
  journalOf,
  journalSince,
  schemaVersion,
} from './db.ts'
import { arm, mutate, send } from './client.ts'
import { armLocal, disarm } from './localread.ts'
import { DatabaseSync, open } from './store/sqlite.ts'
import { writeSession } from './session_store.ts'
import { sha } from './sha.ts'
import { slow, until } from './testing.ts'
import type { Change } from './types.ts'

let root = new URL('../', import.meta.url).pathname
let decoder = new TextDecoder()
let uid = () => crypto.randomUUID()
let fixture = (network = false) => {
  let fetch = globalThis.fetch
  if (!network) {
    globalThis.fetch = () =>
      Promise.reject(new Error('unexpected HTTP in local-write test'))
  }
  let dir = Deno.makeTempDirSync({ prefix: 'tasks-localwrite-' })
  let path = `${dir}/graph.db`
  let db = open(path)
  let session = uid(), actor = uid()
  apply(db, [
    { eid: actor, name: 'person', comp: {} },
    { eid: session, name: 'session', comp: { id: session } },
  ])
  writeSession(db, session, { actor })
  return {
    path,
    db,
    session,
    actor,
    close: () => {
      disarm()
      globalThis.fetch = fetch
      db.close()
      Deno.removeSync(dir, { recursive: true })
    },
  }
}
let cli = (path: string, session: string, ...args: string[]) =>
  new Deno.Command(Deno.execPath(), {
    args: ['run', '--cached-only', '-A', 'src/cli.ts', ...args],
    cwd: root,
    env: {
      DB_PATH: path,
      TASKS_HOST: '127.0.0.1:1',
      TASKS_LOCAL: '1',
      TASKS_BACKOFF: '',
      TASKS_PLUGINS: '',
      TASKS_SESSION: session,
      CLAUDE_CODE_SESSION_ID: session,
      CLAUDE_CODE_CHILD_SESSION: '0',
    },
  }).output()

slow(
  'CLI creates locally with HTTP unavailable and journals attribution plus birth trace',
  async () => {
    let f = fixture()
    try {
      let out = await cli(f.path, f.session, 'new', 'offline CLI proof')
      assertEquals(out.code, 0, decoder.decode(out.stderr))
      let stored = f.db.prepare(
        "select e.eid from doc_value d join entity e on e.id = d.entity where d.title = 'offline CLI proof'",
      ).get() as { eid: string }
      assert(stored)
      let log = journalOf(f.db, stored.eid)[0]
      assertEquals(log.via, f.session)
      assertEquals(log.actor, f.actor)
      let born = journalSince(f.db, log.id - 1).find((r) => r.rowid == log.id)!
      assert(born.trace?.created.has(`task ${stored.eid}`))
      assertEquals(eager(f.db, stored.eid).task != null, true)
    } finally {
      f.close()
    }
  },
)

slow(
  'local mutations preserve aliases, preconditions, atomic refusal, and cascade changes',
  async () => {
    let f = fixture()
    try {
      assert(armLocal(f.path))
      let out = await mutate({
        entities: [
          { entity: { eid: '$task' }, doc: { title: 'before' }, task: {} },
          {
            entity: { eid: '$comment' },
            doc: { body: 'a comment' },
            comment: { target: '$task' },
          },
        ],
      }, f.session)
      let eid = out.aliases.$task, comment = out.aliases.$comment
      assert(eid && comment)
      let before = cursorOf(f.db)
      await assertRejects(() =>
        send([
          { eid, name: 'doc', comp: { title: 'must roll back' } },
          { eid, name: 'task', comp: {} },
          { eid, name: 'filed', comp: { priority: 'invalid' } },
        ], f.session)
      )
      assertEquals(eager(f.db, eid).doc?.title, 'before')
      assertEquals(cursorOf(f.db), before)
      await send([{
        eid,
        name: 'doc',
        comp: { title: 'after' },
        was: { title: sha('before') },
      }], f.session)
      await assertRejects(() =>
        send([{
          eid,
          name: 'doc',
          comp: { title: 'stale' },
          was: { title: sha('before') },
        }], f.session)
      )
      assertEquals(eager(f.db, eid).doc?.title, 'after')
      let removed = await send([{ eid, name: 'entity', comp: null }], f.session)
      assert(
        removed.some((c) =>
          c.eid == comment && c.name == 'entity' && c.comp == null
        ),
      )
      assertEquals(eager(f.db, comment).comment, undefined)
      assert(
        f.db.prepare(
          'select 1 from tombstone where entity = (select id from entity where eid = ?)',
        ).get(comment),
      )
    } finally {
      f.close()
    }
  },
)

slow(
  'local schema skew refuses before mutation and never retries over HTTP',
  async () => {
    let f = fixture(), prior = globalThis.fetch
    let calls = 0
    globalThis.fetch = () => {
      calls++
      return Promise.resolve(Response.json({ changes: [] }))
    }
    try {
      f.db.version = schemaVersion + 1
      let before = cursorOf(f.db)
      assert(armLocal(f.path))
      await assertRejects(
        () => send([{ eid: uid(), name: 'doc', comp: { title: 'refused' } }]),
        Error,
        'does not match',
      )
      assertEquals(cursorOf(f.db), before)
      assertEquals(f.db.version, schemaVersion + 1)
      assertEquals(calls, 0)
    } finally {
      globalThis.fetch = prior
      f.close()
    }
  },
)

Deno.test('wire-only mutations preserve their payload, alias result, and attribution', async () => {
  disarm()
  let prior = globalThis.fetch
  let mutation = {
    entities: [{ entity: { eid: '$one' }, doc: { title: 'remote' } }],
  }
  globalThis.fetch = (_url, init) => {
    assertEquals(JSON.parse(String(init?.body)), mutation)
    assertEquals(new Headers(init?.headers).get('x-via'), 'session-id')
    return Promise.resolve(
      Response.json({ changes: [], aliases: { $one: 'entity-id' } }),
    )
  }
  try {
    assertEquals(arm.mutate, undefined)
    assertEquals(await mutate(mutation, 'session-id'), {
      changes: [],
      aliases: { $one: 'entity-id' },
    })
  } finally {
    globalThis.fetch = prior
  }
})

slow('an existing-file writer cannot create a missing database', () => {
  let dir = Deno.makeTempDirSync()
  try {
    let failed = false
    try {
      new DatabaseSync(`${dir}/missing.db`, { create: false })
    } catch {
      failed = true
    }
    assert(failed)
    assertEquals([...Deno.readDirSync(dir)], [])
  } finally {
    Deno.removeSync(dir)
  }
})

slow('a read-only HTTP subscription receives a direct CLI commit', async () => {
  let f = fixture(true)
  let seat = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let port = (seat.addr as Deno.NetAddr).port
  seat.close()
  let child: Deno.ChildProcess | undefined, sock: WebSocket | undefined
  try {
    child = new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '--cached-only',
        '-A',
        '--unstable-net',
        '--unstable-worker-options',
        'src/server.ts',
      ],
      cwd: root,
      env: {
        DB_PATH: f.path,
        PORT: String(port),
        TASKS_PLANE: 'app',
        TASKS_EFFECTS: 'daemon',
        TASKS_PLUGINS: '',
        TASKS_EMBED: '0',
        TASKS_SWEEP: '0',
      },
      stdout: 'null',
      stderr: 'piped',
    }).spawn()
    let errors = new Response(child.stderr).text()
    let url = `http://127.0.0.1:${port}`
    await until(async () => {
      try {
        let response = await fetch(`${url}/capabilities`)
        await response.text()
        return response.ok
      } catch {
        return false
      }
    }, { timeout: 15_000, label: 'read-only subscription server' })
    let refused = await fetch(`${url}/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '[]',
    })
    assertEquals(refused.ok, false)
    await refused.text()
    let frames: { sub?: string; changes?: Change[]; error?: string }[] = []
    sock = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    sock.onmessage = (event) => frames.push(JSON.parse(String(event.data)))
    await until(() => sock?.readyState == WebSocket.OPEN, {
      label: 'subscription socket',
    })
    sock.send(
      JSON.stringify({
        sub: 'local-write',
        q: '.doc.title~=subscription-proof',
      }),
    )
    await until(() => frames.some((frame) => frame.sub == 'local-write'), {
      label: 'initial subscription',
    })
    let out = await cli(f.path, f.session, 'new', 'subscription-proof')
    assertEquals(out.code, 0, decoder.decode(out.stderr))
    await until(
      () =>
        frames.some((frame) =>
          frame.sub == 'local-write' &&
          frame.changes?.some((c) =>
            c.name == 'doc' && c.comp?.title == 'subscription-proof'
          )
        ),
      { label: 'foreign commit on subscription' },
    )
    sock.close()
    await until(() => sock?.readyState == WebSocket.CLOSED, {
      label: 'closed subscription socket',
    })
    child.kill('SIGTERM')
    await child.status
    await errors
  } finally {
    sock?.close()
    if (child) {
      try {
        child.kill('SIGTERM')
      } catch { /* already exited */ }
      await child.status
    }
    f.close()
  }
})
