// The mail seam: address-book resolution, the delivery stamp, the
// comment relay's mint/guards, and the sweep predicate — against an
// in-memory db and a capture-script mailer (no network, no real mail).
Deno.env.set('DB_PATH', ':memory:')
let { apply, db, open } = await import('./db.ts')
let { addressOf, FANOUT_PENDING, fanout, mailed } = await import('./mail.ts')
let { assertEquals, assertMatch, assertThrows } = await import('@std/assert')

open()
let uid = () => crypto.randomUUID()
let sent: { eid: string; name: string; comp: unknown }[] = []
let cast = (cs: typeof sent) => sent.push(...cs)

let row = (eid: string) =>
  db.prepare('select * from mail where eid = ?').get(eid) as Record<
    string,
    string | null
  >

// A person with an alias and an address, minted through the wire.
let somebody = (slug: string, address?: string) => {
  let eid = uid()
  apply(db, [
    { eid, name: 'doc', comp: { title: slug } },
    { eid, name: 'person', comp: {} },
    { eid, name: 'alias', comp: { slug } },
    ...(address ? [{ eid, name: 'email', comp: { address } }] : []),
  ])
  return eid
}

// The capture mailer: appends argv + stdin to a file, so a test reads
// back exactly what delivery would have handed the world.
let mailer = (dir: string, fail = false) => {
  let sh = `${dir}/mailer.sh`
  Deno.writeTextFileSync(
    sh,
    `#!/bin/sh\nbody=$(cat)\necho "$@ :: $body" >> ${dir}/out.txt\n` +
      (fail ? 'echo boom >&2; exit 1\n' : ''),
  )
  Deno.chmodSync(sh, 0o755)
  return sh
}
let mails = (dir: string) => {
  try {
    return Deno.readTextFileSync(`${dir}/out.txt`).trim().split('\n')
  } catch {
    return []
  }
}

Deno.test('addressOf: raw passes, references resolve, absence throws', () => {
  let p = somebody('resolvable', 'resolvable@x.test')
  let num = (db.prepare('select num from entity where eid = ?').get(p) as {
    num: number
  }).num
  assertEquals(addressOf('raw@x.test'), 'raw@x.test')
  assertEquals(addressOf('resolvable'), 'resolvable@x.test') // alias slug
  assertEquals(addressOf(`U-${num}`), 'resolvable@x.test') // human id
  assertEquals(addressOf(p), 'resolvable@x.test') // eid
  somebody('addressless')
  assertThrows(() => addressOf('addressless'), Error, 'no address on file')
  assertThrows(() => addressOf('ghost-ref'), Error, 'no entity')
})

Deno.test('mailed: delivers, stamps the receipt, sweep replay is a no-op', async () => {
  let dir = Deno.makeTempDirSync()
  Deno.env.set('TASKS_MAIL_CMD', mailer(dir))
  let to = somebody('op', 'op@x.test')
  let m = uid()
  apply(db, [
    { eid: m, name: 'doc', comp: { title: 'hello', body: 'the body' } },
    { eid: m, name: 'mail', comp: { to: 'op' } },
  ])
  await mailed(cast)(m, {})
  let r = row(m)
  assertMatch(String(r.acted_at), /T/)
  assertEquals(r.to_addr, 'op@x.test') // the envelope copy
  assertEquals(r.error, null)
  assertEquals(mails(dir).length, 1)
  assertMatch(mails(dir)[0], /--to op@x.test hello :: the body/)
  // the audit is denormalized: a later address edit rewrites nothing
  apply(db, [{ eid: to, name: 'email', comp: { address: 'moved@x.test' } }])
  assertEquals(row(m).to_addr, 'op@x.test')
  // a sweep replaying an acted row must not deliver twice
  await mailed(cast)(m, {})
  assertEquals(mails(dir).length, 1)
})

Deno.test('mailed: failure and misconfiguration stamp errors, visibly', async () => {
  let dir = Deno.makeTempDirSync()
  Deno.env.set('TASKS_MAIL_CMD', mailer(dir, true))
  let m = uid()
  apply(db, [
    { eid: m, name: 'doc', comp: { title: 's', body: 'b' } },
    { eid: m, name: 'mail', comp: { to: 'x@y.test' } },
  ])
  await mailed(cast)(m, {})
  assertMatch(String(row(m).error), /exit 1: boom/)
  assertMatch(String(row(m).acted_at), /T/) // ran, failed — no retry storm
  let noAddr = uid()
  apply(db, [
    { eid: noAddr, name: 'doc', comp: { title: 's', body: 'b' } },
    { eid: noAddr, name: 'mail', comp: { to: 'addressless' } },
  ])
  await mailed(cast)(noAddr, {})
  assertMatch(String(row(noAddr).error), /no address on file/)
  assertEquals(row(noAddr).to_addr, null) // nothing resolved, nothing claimed
  Deno.env.delete('TASKS_MAIL_CMD')
  let bare = uid()
  apply(db, [
    { eid: bare, name: 'doc', comp: { title: 's', body: 'b' } },
    { eid: bare, name: 'mail', comp: { to: 'x@y.test' } },
  ])
  await mailed(cast)(bare, {})
  assertMatch(String(row(bare).error), /no mailer configured/)
})

Deno.test('stamped trio never rides the wire', () => {
  let m = uid()
  apply(db, [
    { eid: m, name: 'doc', comp: { title: 's', body: 'b' } },
    {
      eid: m,
      name: 'mail',
      comp: { to: 'x@y.test', acted_at: 'forged', to_addr: 'forged@x' },
    },
  ])
  assertEquals(row(m).acted_at, null)
  assertEquals(row(m).to_addr, null)
})

// The relay fixture: an addressed project, its task, and a commenter.
let fixture = () => {
  let proj = uid(), task = uid()
  apply(db, [
    { eid: proj, name: 'doc', comp: { title: 'Venture' } },
    { eid: proj, name: 'project', comp: {} },
    { eid: proj, name: 'email', comp: { address: 'venture@x.test' } },
    { eid: task, name: 'doc', comp: { title: 'the work' } },
    { eid: task, name: 'task', comp: { status: 'open', project_eid: proj } },
  ])
  return { proj, task }
}
let comment = (target: string, author?: string) => {
  let c = uid()
  apply(db, [
    { eid: c, name: 'doc', comp: { title: '', body: 'a note' } },
    {
      eid: c,
      name: 'comment',
      comp: { target_eid: target, ...(author ? { author_eid: author } : {}) },
    },
  ])
  return c
}
let mintedFor = (c: string) =>
  db.prepare(`
    select s.* from dependency d join mail s on s.eid = d.parent_eid
    where d.type = 'about' and d.child_eid = ?
  `).all(c) as Record<string, string>[]

Deno.test('fanout: mints to the project REFERENCE, once, with the receipt', () => {
  let { proj, task } = fixture()
  let c = comment(task)
  fanout(cast)(c, { target_eid: task })
  let made = mintedFor(c)
  assertEquals(made.length, 1)
  assertEquals(made[0].to, proj) // the reference — resolution happens at delivery
  assertEquals(made[0].target_eid, task)
  let num = (db.prepare('select num from entity where eid = ?').get(task) as {
    num: number
  }).num
  let doc = db.prepare('select title, body from doc where eid = ?').get(
    made[0].eid,
  ) as { title: string; body: string }
  assertMatch(doc.title, new RegExp(`\\[T-${num}\\] the work`))
  assertMatch(doc.body, /a note/)
  assertMatch(doc.body, new RegExp(`/T-${num}`))
  fanout(cast)(c, { target_eid: task }) // the receipt makes it idempotent
  assertEquals(mintedFor(c).length, 1)
})

Deno.test('fanout: self-echo and the unaddressed stay home', () => {
  let { proj, task } = fixture()
  let sess = uid()
  apply(db, [{
    eid: sess,
    name: 'session',
    comp: { id: `op-${sess}`, actor_eid: proj },
  }])
  let mine = comment(task, sess)
  fanout(cast)(mine, { target_eid: task, author_eid: sess })
  assertEquals(mintedFor(mine).length, 0) // the operator's own words
  let bare = uid(), t2 = uid()
  apply(db, [
    { eid: bare, name: 'doc', comp: { title: 'NoMail' } },
    { eid: bare, name: 'project', comp: {} },
    { eid: t2, name: 'doc', comp: { title: 'quiet work' } },
    { eid: t2, name: 'task', comp: { status: 'open', project_eid: bare } },
  ])
  let c2 = comment(t2)
  fanout(cast)(c2, { target_eid: t2 })
  assertEquals(mintedFor(c2).length, 0) // no address, no mail
})

Deno.test('the sweep predicate finds unreceipted recent comments only', () => {
  let { task } = fixture()
  let fresh = comment(task)
  fanout(cast)(fresh, { target_eid: task }) // receipted
  let missed = comment(task) // committed, effect never fired
  // past the horizon: history when the address arrived, not undelivered mail
  let old = comment(task)
  db.prepare(`
    update entity set created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 hours')
    where eid = ?
  `).run(old)
  let pending = db.prepare(`select eid from comment where ${FANOUT_PENDING}`)
    .all() as { eid: string }[]
  let eids = pending.map((p) => p.eid)
  assertEquals(eids.includes(missed), true)
  assertEquals(eids.includes(fresh), false)
  assertEquals(eids.includes(old), false)
})

Deno.test('mailed: concurrent fires deliver once (the boot-sweep race)', async () => {
  let dir = Deno.makeTempDirSync()
  Deno.env.set('TASKS_MAIL_CMD', mailer(dir))
  let m = uid()
  apply(db, [
    { eid: m, name: 'doc', comp: { title: 'once', body: 'only' } },
    { eid: m, name: 'mail', comp: { to: 'x@y.test' } },
  ])
  // dispatch and sweep racing: both fire before either stamps
  await Promise.all([mailed(cast)(m, {}), mailed(cast)(m, {})])
  assertEquals(mails(dir).length, 1)
  Deno.env.delete('TASKS_MAIL_CMD')
})
