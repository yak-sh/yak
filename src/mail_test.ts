// The mail seam: address-book resolution, the delivery stamp, the
// comment relay's mint/guards, and the sweep predicate — against an
// in-memory db and a capture-script mailer (no network, no real mail).
// The native path runs against a captured fetch; creds here are dummies.
Deno.env.set('DB_PATH', ':memory:')
let { apply, db, open } = await import('./db.ts')
let { addressOf, FANOUT_PENDING, fanout, mailed, rfcId } = await import(
  './mail.ts'
)
let { canon, payload } = await import('./mailer.ts')
let { channelEvents } = await import('../channels/tasks/filter.ts')
let { assertEquals, assertMatch, assertThrows } = await import('@std/assert')

// Hermetic: the host's own mailer env must never reach these tests.
for (
  let k of [
    'TASKS_MAIL_CMD',
    'TASKS_MAIL_FROM',
    'CLOUDFLARE_EMAIL_TOKEN',
    'HOLDCO_CF_ACCOUNT_ID',
    'CLOUDFLARE_API_BASE',
    'FLEET_MAIL_API_URL',
    'FLEET_MAIL_API_TOKEN',
  ]
) Deno.env.delete(k)

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
      comp: {
        to: 'x@y.test',
        acted_at: 'forged',
        to_addr: 'forged@x',
        sent_id: 'forged@send',
      },
    },
  ])
  assertEquals(row(m).acted_at, null)
  assertEquals(row(m).to_addr, null)
  assertEquals(row(m).sent_id, null)
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
let comment = (target: string, writer?: string) => {
  let c = uid()
  apply(
    db,
    [
      { eid: c, name: 'doc', comp: { title: '', body: 'a note' } },
      { eid: c, name: 'comment', comp: { target_eid: target } },
    ],
    undefined,
    writer,
  )
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

Deno.test('fanout: event comments never ride the relay', () => {
  let { task } = fixture()
  let c = uid()
  apply(db, [
    { eid: c, name: 'doc', comp: { title: '', body: 'S-1 failed · exit 1' } },
    { eid: c, name: 'comment', comp: { target_eid: task, event: 1 } },
  ])
  fanout(cast)(c, { target_eid: task, event: 1 }) // the wire's comp
  assertEquals(mintedFor(c).length, 0)
  // the boot sweep's feed is the row itself — same skip, both doors
  fanout(cast)(
    c,
    db.prepare('select * from comment where eid = ?').get(c) as Record<
      string,
      unknown
    >,
  )
  assertEquals(mintedFor(c).length, 0)
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
  fanout(cast)(mine, { target_eid: task })
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
    update created set at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 hours')
    where eid = ?
  `).run(old)
  let pending = db.prepare(`select eid from comment where ${FANOUT_PENDING}`)
    .all() as { eid: string }[]
  let eids = pending.map((p) => p.eid)
  assertEquals(eids.includes(missed), true)
  assertEquals(eids.includes(fresh), false)
  assertEquals(eids.includes(old), false)
})

Deno.test('rfcId: store wrappers unwrap, raw ids pass, brackets shed', () => {
  assertEquals(rfcId('msg:123:<abc@x>'), 'abc@x')
  assertEquals(rfcId('out:456:def@y'), 'def@y')
  assertEquals(rfcId('<ghi@z>'), 'ghi@z')
  assertEquals(rfcId('jkl@w'), 'jkl@w')
})

// The threading seam end-to-end: a reply names its subject by eid, and
// delivery resolves that to --in-reply-to — the inbound row's unwrapped
// store id, or an outbound row's sent_id.
Deno.test('mailed: reply_to_eid resolves to --in-reply-to at delivery', async () => {
  let dir = Deno.makeTempDirSync()
  Deno.env.set('TASKS_MAIL_CMD', mailer(dir))
  let orig = uid()
  apply(db, [
    { eid: orig, name: 'doc', comp: { title: 'question', body: 'asked' } },
    { eid: orig, name: 'mail', comp: { to: 'us@x.test', from: 'them@y.test' } },
  ])
  // inbound provenance is server-stamped (the inbound.ts idiom)
  db.prepare('update mail set message_id = ? where eid = ?')
    .run('msg:123:<orig-id@y.test>', orig)
  let reply = uid()
  apply(db, [
    { eid: reply, name: 'doc', comp: { title: 'Re: question', body: 'a' } },
    {
      eid: reply,
      name: 'mail',
      comp: { to: 'them@y.test', reply_to_eid: orig },
    },
  ])
  await mailed(cast)(reply, {})
  assertMatch(
    mails(dir).at(-1)!,
    /--in-reply-to orig-id@y.test Re: question/,
  )
  // replying to our OWN sent mail threads through sent_id
  let sent = uid()
  apply(db, [
    { eid: sent, name: 'doc', comp: { title: 'opener', body: 'b' } },
    { eid: sent, name: 'mail', comp: { to: 'them@y.test' } },
  ])
  await mailed(cast)(sent, {})
  db.prepare('update mail set sent_id = ? where eid = ?')
    .run('cf-abc@sender', sent)
  let follow = uid()
  apply(db, [
    { eid: follow, name: 'doc', comp: { title: 'Re: opener', body: 'c' } },
    {
      eid: follow,
      name: 'mail',
      comp: { to: 'them@y.test', reply_to_eid: sent },
    },
  ])
  await mailed(cast)(follow, {})
  assertMatch(mails(dir).at(-1)!, /--in-reply-to cf-abc@sender Re: opener/)
  // no id resolvable: delivered unthreaded, never an error
  let dark = uid()
  apply(db, [
    { eid: dark, name: 'doc', comp: { title: 'unthreadable', body: 'd' } },
    { eid: dark, name: 'mail', comp: { to: 'x@y.test', reply_to_eid: sent } },
  ])
  db.prepare('update mail set sent_id = null where eid = ?').run(sent)
  await mailed(cast)(dark, {})
  let last = mails(dir).at(-1)!
  assertMatch(last, /unthreadable/)
  assertEquals(last.includes('--in-reply-to'), false)
  assertEquals(row(dark).error, null)
  Deno.env.delete('TASKS_MAIL_CMD')
})

Deno.test('canon: bot.yak.sh sheds underscores; other domains pass', () => {
  assertEquals(canon('cafe_car@bot.yak.sh'), 'cafecar@bot.yak.sh')
  assertEquals(canon('Ops@Bot.Yak.Sh'), 'ops@bot.yak.sh')
  assertEquals(canon('under_score@gmail.com'), 'under_score@gmail.com')
})

Deno.test('payload: the bin/email shape, threading headers on mid', () => {
  let p = payload({
    from: 'ops@bot.yak.sh',
    to: 'jeff@yak.sh',
    subject: 'subj',
    body: 'text',
  })
  assertEquals(p.from, { address: 'ops@bot.yak.sh', name: 'ops' })
  assertEquals(p.to, ['jeff@yak.sh'])
  assertEquals(p.reply_to, 'ops@bot.yak.sh')
  assertEquals(p.subject, 'subj')
  assertEquals(p.text, 'text')
  assertEquals(p.headers, undefined)
  let r = payload({
    from: 'a@b.c',
    to: 'x@y.z',
    subject: 'Re: subj',
    body: 'b',
    mid: 'orig@y.z',
  })
  assertEquals(r.headers, {
    'In-Reply-To': '<orig@y.z>',
    References: '<orig@y.z>',
  })
})

// The captured fetch: the native path's stub/capture seam — no request
// leaves the process, and a test reads back exactly what would have.
let netStub = (respond: (url: string) => unknown) => {
  let hits: { url: string; auth?: string; body: Record<string, unknown> }[] = []
  let real = globalThis.fetch
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    let headers = (init?.headers ?? {}) as Record<string, string>
    hits.push({
      url: String(input),
      auth: headers.authorization,
      body: JSON.parse(String(init?.body)),
    })
    return Promise.resolve(
      new Response(JSON.stringify(respond(String(input))), { status: 200 }),
    )
  }) as typeof fetch
  return { hits, restore: () => globalThis.fetch = real }
}

let nativeEnv = () => {
  Deno.env.set('CLOUDFLARE_EMAIL_TOKEN', 'dummy-token')
  Deno.env.set('HOLDCO_CF_ACCOUNT_ID', 'acct-1')
}
let nativeEnvOff = () => {
  for (
    let k of [
      'CLOUDFLARE_EMAIL_TOKEN',
      'HOLDCO_CF_ACCOUNT_ID',
      'TASKS_MAIL_FROM',
      'FLEET_MAIL_API_URL',
      'FLEET_MAIL_API_TOKEN',
    ]
  ) Deno.env.delete(k)
}

Deno.test('mailed: native send stamps sent_id, threads, logs dir=out', async () => {
  nativeEnv()
  Deno.env.set('TASKS_MAIL_FROM', 'holdco@bot.yak.sh')
  Deno.env.set('FLEET_MAIL_API_URL', 'http://fleet.test')
  Deno.env.set('FLEET_MAIL_API_TOKEN', 'dummy-fleet')
  let { hits, restore } = netStub((url) =>
    url.includes('/email/sending/send')
      ? { success: true, result: { message_id: '<cf-1@send>' } }
      : { ok: true }
  )
  try {
    let orig = uid()
    apply(db, [
      { eid: orig, name: 'doc', comp: { title: 'q', body: 'asked' } },
      { eid: orig, name: 'mail', comp: { to: 'us@x.test' } },
    ])
    db.prepare('update mail set message_id = ? where eid = ?')
      .run('msg:9:<orig@y.test>', orig)
    let m = uid()
    apply(db, [
      { eid: m, name: 'doc', comp: { title: 'Re: q', body: 'answered' } },
      {
        eid: m,
        name: 'mail',
        comp: { to: 'cafe_car@bot.yak.sh', reply_to_eid: orig },
      },
    ])
    await mailed(cast)(m, {})
    let r = row(m)
    assertEquals(r.error, null)
    assertEquals(r.sent_id, 'cf-1@send') // brackets shed
    assertEquals(r.to_addr, 'cafecar@bot.yak.sh') // canon at resolution
    assertEquals(hits.length, 2)
    assertMatch(hits[0].url, /accounts\/acct-1\/email\/sending\/send$/)
    assertEquals(hits[0].auth, 'Bearer dummy-token')
    assertEquals(hits[0].body.from, {
      address: 'holdco@bot.yak.sh',
      name: 'holdco',
    })
    assertEquals(hits[0].body.to, ['cafecar@bot.yak.sh'])
    assertEquals(hits[0].body.headers, {
      'In-Reply-To': '<orig@y.test>',
      References: '<orig@y.test>',
    })
    // the best-effort out-log rode to the fleet store, bin/email's row
    assertEquals(hits[1].url, 'http://fleet.test/messages')
    assertEquals(hits[1].auth, 'Bearer dummy-fleet')
    assertEquals(hits[1].body.dir, 'out')
    assertEquals(hits[1].body.msg_id, 'cf-1@send')
    assertMatch(String(hits[1].body.id), /^out:\d+:cf-1@send$/)
  } finally {
    restore()
    nativeEnvOff()
  }
})

Deno.test('mailed: native failure and a missing from stamp errors', async () => {
  nativeEnv()
  let { restore } = netStub(() => ({ success: false, errors: ['nope'] }))
  try {
    let m = uid()
    apply(db, [
      { eid: m, name: 'doc', comp: { title: 's', body: 'b' } },
      { eid: m, name: 'mail', comp: { to: 'x@y.test', from: 'a@b.test' } },
    ])
    await mailed(cast)(m, {})
    assertMatch(String(row(m).error), /send failed \(HTTP 200\)/)
    assertMatch(String(row(m).acted_at), /T/) // ran, failed — no retry storm
    assertEquals(row(m).sent_id, null)
    // no row.from and no TASKS_MAIL_FROM: stamped, never guessed
    let bare = uid()
    apply(db, [
      { eid: bare, name: 'doc', comp: { title: 's', body: 'b' } },
      { eid: bare, name: 'mail', comp: { to: 'x@y.test' } },
    ])
    await mailed(cast)(bare, {})
    assertMatch(String(row(bare).error), /no from address/)
  } finally {
    restore()
    nativeEnvOff()
  }
})

Deno.test('mailed: $TASKS_MAIL_CMD wins over the native env', async () => {
  nativeEnv()
  let dir = Deno.makeTempDirSync()
  Deno.env.set('TASKS_MAIL_CMD', mailer(dir))
  let { hits, restore } = netStub(() => ({ success: true }))
  try {
    let m = uid()
    apply(db, [
      { eid: m, name: 'doc', comp: { title: 'seam', body: 'held' } },
      { eid: m, name: 'mail', comp: { to: 'x@y.test' } },
    ])
    await mailed(cast)(m, {})
    assertEquals(mails(dir).length, 1) // the override delivered
    assertEquals(hits.length, 0) // nothing touched the network path
    assertEquals(row(m).error, null)
  } finally {
    restore()
    Deno.env.delete('TASKS_MAIL_CMD')
    nativeEnvOff()
  }
})

// --- local-first delivery: a fleet recipient never leaves the graph ---------

Deno.test('mailed: a fleet recipient delivers locally — no send, no out-log', async () => {
  nativeEnv()
  Deno.env.set('TASKS_MAIL_FROM', 'holdco@bot.yak.sh')
  Deno.env.set('FLEET_MAIL_API_URL', 'http://fleet.test')
  Deno.env.set('FLEET_MAIL_API_TOKEN', 'dummy-fleet')
  let dir = Deno.makeTempDirSync()
  Deno.env.set('TASKS_MAIL_CMD', mailer(dir))
  let { hits, restore } = netStub(() => ({ success: true }))
  try {
    let ops = somebody('ops', 'ops@bot.yak.sh')
    let m = uid()
    apply(db, [
      { eid: m, name: 'doc', comp: { title: 'ping', body: 'hi there' } },
      { eid: m, name: 'mail', comp: { to: 'ops' } },
    ])
    let got: Parameters<typeof channelEvents>[0] = []
    await mailed((cs) => got.push(...cs))(m, {})
    let r = row(m)
    assertEquals(r.error, null)
    assertEquals(r.to_addr, 'ops@bot.yak.sh')
    assertMatch(String(r.message_id), /^local:\d+:/) // the never-send mark
    assertMatch(String(r.received_at), /T/) // arrived
    assertMatch(String(r.acted_at), /T/) // delivered, and when
    assertEquals(Number(r.verified), 1) // apply() authenticated the author
    assertEquals(r.target_eid, ops) // aimed at the recipient's inbox
    assertEquals(r.from, 'holdco@bot.yak.sh') // attribution defaulted
    assertEquals(r.sent_id, null) // nothing was ever sent
    assertEquals(mails(dir).length, 0) // the override seam never fired
    assertEquals(hits.length, 0) // no Cloudflare send, no D1 out-log
    // a sweep replay never re-delivers: acted_at, and the never-send mark
    await mailed(cast)(m, {})
    assertEquals(hits.length, 0)
    // the full-row stamp broadcast IS the arrival the channel injects
    let evs = channelEvents(got, {
      sessionEid: 'sess',
      homeEid: ops,
      idOf: () => 'E-1',
    })
    assertEquals(evs.length, 1)
    assertEquals(evs[0].meta.kind, 'mail')
    assertEquals(evs[0].meta.auth, 'VERIFIED')
  } finally {
    restore()
    Deno.env.delete('TASKS_MAIL_CMD')
    nativeEnvOff()
  }
})

Deno.test('mailed: a book entry Cloudflare would bounce still lands at home', async () => {
  nativeEnv()
  let { hits, restore } = netStub(() => ({ success: true }))
  try {
    let p = somebody('under_bot', 'under_score@bot.yak.sh')
    let m = uid()
    apply(db, [
      { eid: m, name: 'doc', comp: { title: 's', body: 'b' } },
      {
        eid: m,
        name: 'mail',
        comp: { to: 'under_score@bot.yak.sh', from: 'a@bot.yak.sh' },
      },
    ])
    await mailed(cast)(m, {})
    let r = row(m)
    assertEquals(r.error, null)
    assertEquals(r.target_eid, p) // the pre-canon spelling found the book
    assertEquals(r.from, 'a@bot.yak.sh') // a stamped from stays
    assertEquals(hits.length, 0)
  } finally {
    restore()
    nativeEnvOff()
  }
})

Deno.test('mailed: local delivery keeps a relay mail aimed at its task', async () => {
  let t = uid()
  somebody('relayed', 'relayed@bot.yak.sh')
  apply(db, [
    { eid: t, name: 'doc', comp: { title: 'the work' } },
    { eid: t, name: 'task', comp: { status: 'open' } },
  ])
  let m = uid()
  apply(db, [
    { eid: m, name: 'doc', comp: { title: '[T] the work', body: 'a note' } },
    { eid: m, name: 'mail', comp: { to: 'relayed', target_eid: t } },
  ])
  await mailed(cast)(m, {})
  assertEquals(row(m).target_eid, t) // the arrive() precedent holds
  assertMatch(String(row(m).message_id), /^local:/)
})

Deno.test('mailed: an external address in the book still rides the boundary', async () => {
  let dir = Deno.makeTempDirSync()
  Deno.env.set('TASKS_MAIL_CMD', mailer(dir))
  somebody('owner', 'owner@ext.test')
  let m = uid()
  apply(db, [
    { eid: m, name: 'doc', comp: { title: 'to the owner', body: 'words' } },
    { eid: m, name: 'mail', comp: { to: 'owner' } },
  ])
  await mailed(cast)(m, {})
  assertEquals(mails(dir).length, 1) // delivered outward, not locally
  assertEquals(row(m).message_id, null)
  Deno.env.delete('TASKS_MAIL_CMD')
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
