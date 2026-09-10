import { assert, assertEquals, assertThrows } from '@std/assert'
import { apply, delta, fleetGraphOf, human, readComp } from './db.ts'
import { connect } from './store/sqlite.ts'
import { slow } from './testing.ts'
import { served } from './served.ts'
import { bareDb } from './testdb.ts'
import { idOf, uuid } from './types.ts'
import {
  commentChanges,
  designChanges,
  mintedIn,
  normalizeLiterals,
  sessionFor,
  spawnChanges,
  taskChanges,
} from './client.ts'

Deno.test('numbers: raw births are num-less; only explicit requests allocate', () => {
  let db = bareDb(), a = uuid(), b = uuid(), s = uuid()
  apply(db, [
    ...taskChanges(a, { doc: { title: 'micro' } }),
    ...taskChanges(b, { doc: { title: 'human' } }, true),
    { eid: s, name: 'session', comp: { id: uuid(), parent: s } },
  ])
  assertEquals(readComp(db, a, 'entity')?.num, null)
  assertEquals(readComp(db, b, 'entity')?.num, 1)
  assertEquals(readComp(db, s, 'entity')?.num, null)
  assertEquals(human(db, a), idOf({ eid: a, num: 0, kind: 'task' }))
})

Deno.test('numbers: late request survives literals, echoes and journals the same handle', () => {
  let db = bareDb(), eid = uuid()
  apply(db, taskChanges(eid, { doc: { title: 'later' } }))
  let plan = normalizeLiterals([{ entity: { eid }, $num: true }], {
    resolve: (id) => id,
  })
  let created = readComp(db, eid, 'created')
  let first = apply(db, plan.changes)
  assertEquals(readComp(db, eid, 'entity')?.num, 1)
  assertEquals(first.find((c) => c.name == 'entity')?.comp?.num, 1)
  assertEquals(
    delta(db, 0).changes.findLast((c) => c.eid == eid && c.name == 'entity')
      ?.comp
      ?.num,
    1,
  )
  let second = apply(db, plan.changes)
  assertEquals(second.find((c) => c.name == 'entity')?.comp?.num, 1)
  assertEquals(readComp(db, eid, 'entity')?.num, 1)
  assert(first.every((c) => !('$num' in c)))
  assertEquals(readComp(db, eid, 'created'), created)
  assertEquals(first.filter((c) => c.name == 'created'), [])
  assertEquals(
    delta(db, 0).changes.filter((c) => c.eid == eid && c.name == 'created')
      .length,
    1,
  )
})

Deno.test('numbers: alias requests are per entity and roll back on refusal', () => {
  let db = bareDb(), g = fleetGraphOf(db)
  let out = g.apply([
    { entity: { eid: '$a' }, $num: true, task: {}, doc: { title: 'one' } },
    { entity: { eid: '$b' }, task: {}, doc: { title: 'two' } },
  ])
  assert(!(out instanceof Promise))
  assertEquals(out.find((b) => b.$alias == '$a')?.entity.num, 1)
  assertEquals(out.find((b) => b.$alias == '$b')?.entity.num, null)
  assert(out.every((b) => b.$num === undefined))
  assertThrows(() =>
    db.transaction(() => {
      g.apply([{ entity: { eid: 'rollback' }, $num: true, task: {} }])
      throw new Error('rollback')
    })
  )
  assertEquals(readComp(db, 'rollback', 'entity'), undefined)
})

Deno.test('numbers: agent comments do not ask and confirmed num-less births can print', () => {
  let db = bareDb(), target = uuid()
  apply(db, taskChanges(target, { doc: { title: 'task' } }))
  let made = commentChanges([], target, 'agent comment')
  assert(made.every((c) => !c.$num))
  let eid = made.find((c) => c.name == 'comment')!.eid
  let out = apply(db, made)
  assertEquals(readComp(db, eid, 'entity')?.num, null)
  assertEquals(mintedIn(out, eid), human(db, eid))
})

Deno.test('numbers: design asks only for its document; spawned sessions do not ask', () => {
  let db = bareDb()
  let design = designChanges([], { title: 'Human design', session: 'author' })
  assertEquals(design.changes.filter((c) => c.$num).map((c) => c.eid), [
    design.eid,
  ])
  apply(db, design.changes)
  assertEquals(readComp(db, design.eid, 'entity')?.num, 1)
  let spawned = spawnChanges([], { provider: 'codex', model: 'test' })
  assert(spawned.changes.every((c) => !c.$num))
  apply(db, spawned.changes)
  assertEquals(readComp(db, spawned.eid, 'entity')?.num, null)
})

slow(
  'numbers: concurrent late requests on separate writers return one stable handle',
  async () => {
    let tmp = Deno.makeTempDirSync({ prefix: 'tasks-num-' })
    let path = `${tmp}/graph.db`, eid = uuid()
    let seed = bareDb()
    apply(seed, taskChanges(eid, { doc: { title: 'late' } }))
    Deno.writeFileSync(path, seed.serialize())
    let db = connect(path)
    let children: Deno.ChildProcess[] = []
    let code = `
    import { connect } from '${
      new URL('./store/sqlite.ts', import.meta.url).href
    }'
    import { apply, readComp } from '${
      new URL('./db.ts', import.meta.url).href
    }'
    let db = connect(Deno.args[0]), eid = Deno.args[1]
    console.log('ready')
    await Deno.stdin.read(new Uint8Array(1))
    apply(db, [{eid, name:'entity', comp:{}, $num:true}])
    console.log(readComp(db, eid, 'entity').num)
    db.close()
  `
    try {
      for (let i = 0; i < 2; i++) {
        let child = new Deno.Command(Deno.execPath(), {
          args: ['eval', code, path, eid],
          stdin: 'piped',
          stdout: 'piped',
          stderr: 'piped',
        }).spawn()
        children.push(child)
        let ready = child.stdout.getReader()
        assertEquals(
          new TextDecoder().decode((await ready.read()).value).trim(),
          'ready',
        )
        ready.releaseLock()
      }
      // Both writers ask while a third connection holds the write lock. Neither
      // can allocate until it is released, and their subsequent writes serialize.
      db.exec('begin immediate')
      try {
        for (let child of children) {
          let input = child.stdin.getWriter()
          await input.write(new Uint8Array([1]))
          await input.close()
        }
      } finally {
        db.exec('commit')
      }
      let results = await Promise.all(children.map((child) => child.output()))
      for (let result of results) {
        assertEquals(result.code, 0, new TextDecoder().decode(result.stderr))
        assertEquals(new TextDecoder().decode(result.stdout).trim(), '1')
      }
      assertEquals(readComp(db, eid, 'entity')?.num, 1)
      assertEquals(
        db.prepare('select count(*) as n from entity where num is not null')
          .get(),
        { n: 1 },
      )
    } finally {
      db.close()
      for (let child of children) {
        try {
          child.kill()
        } catch { /* already exited */ }
        await child.status
      }
      Deno.removeSync(tmp, { recursive: true })
    }
  },
)

Deno.test('numbers: late numbering never relocates an eid-owned managed checkout', () => {
  let eid = uuid()
  for (let num of [0, 42]) {
    let made = sessionFor(
      [{
        eid,
        num,
        kind: 'session',
        comps: {
          session: { id: 'managed', origin: 'managed', cwd: '/owned' },
          worktree: { cwd: '/owned', branch: `session/${eid}` },
        },
      }],
      'managed',
      '/caller',
    )
    assert(made.changes.every((c) => c.comp?.cwd === undefined))
  }
})

Deno.test('numbers: a handle belongs to the entity, not its display kind', () => {
  let db = bareDb(), eid = uuid()
  apply(db, [{ eid, name: 'doc', comp: { title: 'document' }, $num: true }])
  assertEquals(readComp(db, eid, 'entity')?.num, 1)
  apply(db, [{ eid, name: 'task', comp: {} }])
  assertEquals(human(db, eid), 'T-1')
  assertEquals(readComp(db, eid, 'entity')?.num, 1)
})

Deno.test('numbers: the served session is chosen by creation, never a late number', () => {
  let seats = [
    {
      eid: 'older',
      id: 'before-clear',
      pid: 7,
      at: '2026-09-10T12:00:00Z',
      num: 99,
    },
    { eid: 'newer', id: 'after-clear', pid: 7, at: '2026-09-10T12:01:00Z' },
  ]
  assertEquals(served(seats, 7)?.eid, 'newer')
})
