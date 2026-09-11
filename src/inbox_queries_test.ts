// Real SQLite -> server-evaluated package cache: projected inbox membership
// must never be inferred from whichever rows a different card happened to load.
import { assertEquals, assertFalse } from '@std/assert'
import { inboxItem, isUnread, type Reader, type Row } from './client.ts'
import { inboxCountQueries, inboxQueries } from './inbox_queries.ts'
import { parseQuery } from './query.ts'
import { liveClient } from './live_client.ts'
import type { Sub } from './live.ts'
import { subserve } from './subserve.ts'
import { applyNumbered, bareDb } from './testdb.ts'
import { type Change, kindOf, uuid } from './types.ts'

Deno.test('inbox projects authoritative mail/knock reads; stamps stay live', () => {
  let db = bareDb(), actor = uuid(), watched = uuid(), other = uuid()
  let frames: Sub[] = [], source = new Map<string, Row['comps']>()
  let client = liveClient({
    send: (sub, q) =>
      server.frame(q === undefined ? { unsub: sub } : { sub, q }),
    changed: () => {},
    ready: () => {},
  })
  let server = subserve(db, (frame) => {
    if (!Array.isArray(frame) && typeof frame.sub === 'string') {
      frames.push(frame as Sub)
      client.receive(frame as Sub)
    }
  })
  let write = (changes: Change[]) => {
    applyNumbered(
      db,
      changes.map((c) =>
        c.name == 'mail' && c.comp
          ? {
            ...c,
            comp: Object.fromEntries(
              Object.entries(c.comp).filter(([p]) =>
                !['message_id', 'to_addr'].includes(p)
              ),
            ),
          }
          : c
      ),
    )
    // Inbound envelope columns are server-owned; reproduce the inbound
    // stamper, rather than expecting wire apply() to accept them.
    for (let c of changes) {
      if (c.name == 'mail' && c.comp) {
        for (let prop of ['message_id', 'to_addr']) {
          if (prop in c.comp) {
            db.prepare(
              `update mail set ${prop} = ? where entity = (select id from entity where eid = ?)`,
            ).run(c.comp[prop] == null ? null : String(c.comp[prop]), c.eid)
          }
        }
      }
      let comps = source.get(c.eid) ?? {}
      if (c.comp == null) delete comps[c.name]
      else comps[c.name] = { ...comps[c.name], ...c.comp }
      source.set(c.eid, comps)
    }
    server.maintain(changes)
  }
  let add = (comps: Row['comps']) => {
    let eid = uuid()
    write(
      Object.entries({
        doc: { title: 'subject', body: 'body'.repeat(5000) },
        ...comps,
      })
        .map(([name, comp]) => ({ eid, name, comp } as Change)),
    )
    return eid
  }
  let who: Reader = {
    actor,
    scope: actor,
    operator: true,
    addrs: new Set(['person@example.test', actor]),
    watching: new Set([watched]),
    muting: new Set(),
  }
  let countWho = {
    ...who,
    watching: new Set<string>(),
    muting: new Set<string>(),
  }
  let counts = new Map<string, number>()
  let countReaders = [countWho, { ...countWho, scope: undefined }]
  let countQueries = countReaders.map(inboxCountQueries)
  let countParity = () => {
    for (let f of frames) {
      if (!f.sub.startsWith('count:')) continue
      assertEquals(f.error, undefined)
      assertEquals(f.changes?.length ?? 0, 0)
      if (f.agg) counts.set(f.sub, f.agg[''] ?? 0)
    }
    for (let [index, reader] of countReaders.entries()) {
      let want = [...source].map(([eid, comps]) => row(eid, comps))
        .filter(inboxItem(reader)).filter(isUnread).length
      let actual = [...counts].filter(([name]) =>
        name.startsWith(`count:${index}:`)
      )
        .reduce((sum, [, n]) => sum + n, 0)
      assertEquals(actual, want)
    }
  }
  let arms = (unread: boolean) => inboxQueries(who, unread)
  let name = (unread: boolean, i: number) => `${unread}:${i}`
  let ids = (
    unread: boolean,
  ) => [
    ...new Set(arms(unread).flatMap((_, i) => client.members(name(unread, i)))),
  ]
  let row = (eid: string, comps: Row['comps']): Row => ({
    eid,
    num: 0,
    kind: kindOf(comps),
    comps,
  })
  let actual = (unread: boolean) =>
    ids(unread)
      .map((eid) => row(eid, client.box.ent(eid)! as Row['comps']))
      .filter(inboxItem(who)).filter((r) => !unread || isUnread(r)).map((r) =>
        r.eid
      ).sort()
  let expected = (unread: boolean) =>
    [...source].map(([eid, comps]) => row(eid, comps))
      .filter(inboxItem(who)).filter((r) => !unread || isUnread(r)).map((r) =>
        r.eid
      ).sort()
  let parity = () => {
    countParity()
    for (let unread of [false, true]) {
      assertEquals(actual(unread), expected(unread))
    }
  }
  try {
    write(
      [actor, watched, other].map((eid) => ({
        eid,
        name: 'project',
        comp: {},
      })),
    )
    let mail = add({
      mail: {
        target: actor,
        to_addr: 'person@example.test',
        message_id: 'arrived',
      },
    })
    add({
      mail: { to_addr: 'person@example.test', message_id: 'address-only' },
    })
    add({ mail: { target: watched, to_addr: actor, message_id: 'watched' } })
    add({ mail: { target: watched }, opened: {} })
    let read = add({ mail: { target: actor, message_id: 'read' }, opened: {} })
    let archived = add({
      mail: { target: actor, message_id: 'archived' },
      archived: {},
    })
    let outbound = add({
      mail: { target: actor, to_addr: actor },
      deliver: { to: actor },
    })
    let wake = add({
      wake: { at: '2099-01-01T00:00:00Z' },
      deliver: { to: actor },
    })
    let knock = add({ knock: { target: watched }, deliver: { to: actor } })
    add({ knock: { target: watched }, deliver: { to: other } })
    add({ knock: { target: watched } })
    add({ comment: { target: actor } })
    add({ notice: { target: actor, event: 'wake' } })

    add({ notice: { target: watched, event: 'wake' } })
    // Disjoint counts obey component precedence and inbound truthiness,
    // including rows the ordinary candidate union would double-count.
    add({
      comment: { target: actor },
      mail: { target: actor, message_id: 'both' },
    })
    add({
      comment: { target: other },
      notice: { target: actor, event: 'wake' },
      mail: { target: actor, message_id: 'not-addressed' },
    })
    add({
      notice: { target: other, event: 'wake' },
      knock: { target: actor },
      deliver: { to: actor },
    })
    add({
      knock: { target: actor },
      mail: { target: actor, message_id: 'not-delivered' },
    })
    add({ mail: { target: actor, message_id: '' } })
    for (let [index, queries] of countQueries.entries()) {
      for (let [i, q] of queries.entries()) {
        if (q) server.frame({ sub: `count:${index}:${i}`, q })
      }
    }
    for (let unread of [false, true]) {
      for (let [i, q] of arms(unread).entries()) {
        if (!q) continue
        client.open(name(unread, i), q)
        assertEquals(frames.at(-1)?.error, undefined, q)
        assertEquals(client.ready(name(unread, i)), true)
      }
      let all = arms(unread).flatMap((_, i) => client.members(name(unread, i)))
      assertEquals(all.filter((eid) => eid == mail).length, 1)
      assertEquals(all.filter((eid) => eid == knock).length, 1)
      for (let eid of [outbound, wake, archived]) assertFalse(all.includes(eid))
    }
    assertFalse(ids(true).includes(read))
    for (let eid of ids(false)) {
      assertFalse(client.box.cache.loaded(eid, 'doc', 'body'))
    }
    assertFalse(
      frames.some((f) =>
        f.changes?.some((c) => c.name == 'doc' && c.comp?.body)
      ),
    )
    assertFalse(frames.some((f) =>
      f.sub.startsWith('true:') &&
      f.changes?.some((c) => c.name == 'doc' || c.name == 'created')
    ))
    parity()
    write([{ eid: mail, name: 'opened', comp: {} }])
    parity()
    write([{ eid: mail, name: 'opened', comp: null }, {
      eid: archived,
      name: 'archived',
      comp: null,
    }])
    parity()
    write([{ eid: mail, name: 'archived', comp: {} }])
    parity()
    // Move between mail arms without losing the item or double counting.
    write([{
      eid: read,
      name: 'mail',
      comp: { target: other, to_addr: actor },
    }])
    parity()
    // Cold content is irrelevant. A body edit cannot wake these projections.
    let before = frames.length
    write([{ eid: read, name: 'doc', comp: { body: 'new body' } }])
    assertEquals(frames.length, before)
    who.muting!.add(watched)
    parity()
  } finally {
    client.box.close()
    db.close()
  }
})

Deno.test('inbox query identity is stable and address values cannot become grammar', () => {
  let who: Reader = {
    actor: uuid(),
    scope: uuid(),
    watching: new Set([uuid(), uuid()]),
    addrs: new Set(['odd&.archived!@example.test', 'normal@example.test']),
  }
  assertEquals(
    inboxQueries(who),
    inboxQueries({
      ...who,
      watching: new Set([...who.watching!].reverse()),
      addrs: new Set([...who.addrs!].reverse()),
    }),
  )
})

Deno.test('person inbox uses addresses without project mail; quoted addresses stay values', () => {
  let actor = uuid(), watched = uuid(), addr = 'odd&.archived!@example.test'
  let queries = inboxQueries({
    actor,
    addrs: new Set([addr]),
    watching: new Set([watched]),
  }, true)
  assertEquals(queries[4], '')
  let preds = parseQuery(queries[5])
  assertEquals(
    preds.filter((p) => p.comp == 'mail' && p.prop == 'to_addr').map((p) =>
      p.value
    ),
    [addr],
  )
  assertEquals(preds.filter((p) => p.comp == 'archived').map((p) => p.op), [''])
  assertEquals(
    parseQuery(queries[6]).some((p) =>
      p.prop == 'message_id' && p.op == 'exists'
    ),
    false,
  )
})
