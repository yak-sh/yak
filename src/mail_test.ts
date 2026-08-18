// The mail seam: address-book resolution, the delivery stamp, the
// comment relay's mint/guards, and the sweep predicate — against an
// in-memory db and a capture-script mailer (no network, no real mail).
// The native path runs against a captured fetch; creds here are dummies.
Deno.env.set('DB_PATH', ':memory:')
let { apply, db, open } = await import('./db.ts')
let { addressOf, FANOUT_PENDING, fanout, mailed, named, rfcId } = await import(
  './mail.ts'
)
let { payload } = await import('./mailer.ts')
let { canon } = await import('./mailaddr.ts')
let { channelEvents } = await import('./channel.ts')
let { comps } = await import('./types.ts')
let { assertEquals, assertMatch, assertStringIncludes, assertThrows } =
  await import('@std/assert')

// Hermetic: the host's own mailer env must never reach these tests.
for (
  let k of [
    'TASKS_MAIL_CMD',
    'TASKS_MAIL_DOMAIN',
    'TASKS_MAIL_FROM',
    'CLOUDFLARE_EMAIL_TOKEN',
    'HOLDCO_CF_ACCOUNT_ID',
    'CLOUDFLARE_API_BASE',
    'FLEET_MAIL_API_URL',
    'FLEET_MAIL_API_TOKEN',
  ]
) Deno.env.delete(k)
Deno.env.set('TASKS_MAIL_DOMAIN', 'bot.test')

open()
let uid = () => crypto.randomUUID()
let sent: { eid: string; name: string; comp: unknown }[] = []
let cast = (cs: typeof sent) => sent.push(...cs)

// The id-keyed storage boundary: component/edge tables key by integer
// `entity` (not text `eid`), and reference columns store integer ids. EIDs
// remain the wire/test identity, so raw SQL translates at the boundary —
// OWNED filters a component row by owner eid, idOf resolves an eid operand to
// an id, refEid projects a stored ref id back to its eid for assertions.
let OWNED = `entity = (select id from entity where eid = ?)`
let idOf = `(select id from entity where eid = ?)`
let refEid = (col: string) => `(select eid from entity where id = ${col})`

let row = (eid: string) =>
  db.prepare(
    // target is a ref column: stored as the target's int id, projected back to
    // its eid here (both apply() and settle() store the int id).
    `select "from", to_addr, message_id, received_at, verified, sent_id,
      ${refEid('target')} as target
     from mail where ${OWNED}`,
  ).get(eid) as Record<
    string,
    string | null
  >
// The send OUTCOME is the shared delivered/error facet now (D-14945): a
// delivered mail wears `delivered` (via = how it went out), a failed one
// wears `error` (message = why), a pending one wears neither.
let drow = (eid: string) =>
  db.prepare(`select * from delivered where ${OWNED}`).get(eid) as
    | Record<string, string | null>
    | undefined
let erow = (eid: string) =>
  db.prepare(`select * from error where ${OWNED}`).get(eid) as
    | Record<string, string | null>
    | undefined

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

// Who a fixture's letters are FROM. A mail is signed by its author now —
// apply() stamps `from` from the writing actor — so a letter that expects to
// be delivered names one, passed as the writer exactly as a session's actor
// would resolve. Unsigned mail is refused at delivery, on purpose.
let author = somebody('sender', 'sender@bot.test')
// An actor with no address on file — its letters cannot be signed, so
// delivery must refuse them rather than sign them as somebody else.
let unsigned = somebody('unsigned')

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
  apply(
    db,
    [
      { eid: m, name: 'doc', comp: { title: 'hello', body: 'the body' } },
      { eid: m, name: 'mail', comp: {} },
      { eid: m, name: 'deliver', comp: { to: 'op' } },
    ],
    undefined,
    author,
  )
  await mailed(cast)(m, {})
  let r = row(m)
  assertMatch(String(drow(m)?.at), /T/)
  assertEquals(r.to_addr, 'op@x.test') // the envelope copy
  assertEquals(erow(m), undefined)
  assertEquals(mails(dir).length, 1)
  assertMatch(
    mails(dir)[0],
    /--to op@x.test --from sender@bot.test hello :: the body/,
  )
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
  apply(
    db,
    [
      { eid: m, name: 'doc', comp: { title: 's', body: 'b' } },
      { eid: m, name: 'mail', comp: {} },
      { eid: m, name: 'deliver', comp: { to: 'x@y.test' } },
    ],
    undefined,
    author,
  )
  await mailed(cast)(m, {})
  assertMatch(String(erow(m)?.message), /exit 1: boom/)
  assertMatch(String(erow(m)?.at), /T/) // ran, failed — no retry storm
  let noAddr = uid()
  apply(
    db,
    [
      { eid: noAddr, name: 'doc', comp: { title: 's', body: 'b' } },
      { eid: noAddr, name: 'mail', comp: {} },
      { eid: noAddr, name: 'deliver', comp: { to: 'addressless' } },
    ],
    undefined,
    author,
  )
  await mailed(cast)(noAddr, {})
  assertMatch(String(erow(noAddr)?.message), /no address on file/)
  assertEquals(row(noAddr).to_addr, null) // nothing resolved, nothing claimed
  Deno.env.delete('TASKS_MAIL_CMD')
  let bare = uid()
  apply(
    db,
    [
      { eid: bare, name: 'doc', comp: { title: 's', body: 'b' } },
      { eid: bare, name: 'mail', comp: {} },
      { eid: bare, name: 'deliver', comp: { to: 'x@y.test' } },
    ],
    undefined,
    author,
  )
  await mailed(cast)(bare, {})
  assertMatch(String(erow(bare)?.message), /no mailer configured/)
})

Deno.test('the envelope data never rides the wire', () => {
  let m = uid()
  apply(
    db,
    [
      { eid: m, name: 'doc', comp: { title: 's', body: 'b' } },
      {
        eid: m,
        name: 'mail',
        // target is a real writable column (so the row lands); to_addr and
        // sent_id are server-owned envelope DATA and must be dropped.
        comp: {
          target: author,
          to_addr: 'forged@x',
          sent_id: 'forged@send',
        },
      },
      { eid: m, name: 'deliver', comp: { to: 'x@y.test' } },
    ],
    undefined,
    author,
  )
  // to_addr/sent_id are server-owned envelope DATA (stamped, not comps); a
  // forged one is dropped. The delivery OUTCOME is its own component, and a
  // bare mail write never mints one — the mail stays pending.
  assertEquals(row(m).to_addr, null)
  assertEquals(row(m).sent_id, null)
  assertEquals(drow(m), undefined)
  assertEquals(erow(m), undefined)
})

// The relay fixture: an addressed project, its task, and a commenter.
let fixture = () => {
  let proj = uid(), task = uid()
  apply(db, [
    { eid: proj, name: 'doc', comp: { title: 'Venture' } },
    { eid: proj, name: 'project', comp: {} },
    { eid: proj, name: 'email', comp: { address: 'venture@x.test' } },
    { eid: task, name: 'doc', comp: { title: 'the work' } },
    { eid: task, name: 'task', comp: { status: 'open', project: proj } },
  ])
  // A standing task, not one being filed this instant: commenting on it is
  // correspondence. Birth commentary is its own case and builds its own
  // target, so only these tests need the age.
  db.prepare(`
    update created set at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')
    where ${OWNED}
  `).run(task)
  return { proj, task }
}
let comment = (target: string, writer?: string) => {
  let c = uid()
  apply(
    db,
    [
      { eid: c, name: 'doc', comp: { title: '', body: 'a note' } },
      { eid: c, name: 'comment', comp: { target: target } },
    ],
    undefined,
    writer,
  )
  return c
}
let mintedFor = (c: string) =>
  db.prepare(`
    select o.eid as eid, s."from" as "from",
      ${refEid('s.target')} as target, ${refEid('dl."to"')} as deliver_to
    from dependency d
    join mail s on s.entity = d.parent
    join entity o on o.id = s.entity
    left join deliver dl on dl.entity = s.entity
    where d.type = 'about' and d.child = ${idOf}
  `).all(c) as Record<string, string>[]

Deno.test('fanout: mints to the project REFERENCE, once, with the receipt', () => {
  let { proj, task } = fixture()
  let c = comment(task)
  fanout(cast)(c, { target: task })
  let made = mintedFor(c)
  assertEquals(made.length, 1)
  assertEquals(made[0].deliver_to, proj) // the reference — resolved at delivery
  assertEquals(made[0].target, task)
  let num = (db.prepare('select num from entity where eid = ?').get(task) as {
    num: number
  }).num
  let doc = db.prepare(`select title, body from doc where ${OWNED}`).get(
    made[0].eid,
  ) as { title: string; body: string }
  assertMatch(doc.title, new RegExp(`\\[T-${num}\\] the work`))
  assertMatch(doc.body, /a note/)
  assertMatch(doc.body, new RegExp(`https://tasks\\.yak\\.sh/T-${num}`))
  fanout(cast)(c, { target: task }) // the receipt makes it idempotent
  assertEquals(mintedFor(c).length, 1)
})

Deno.test('fanout: self-echo and the unaddressed stay home', () => {
  let { proj, task } = fixture()
  let sess = uid()
  apply(db, [{
    eid: sess,
    name: 'session',
    comp: { id: `op-${sess}`, actor: proj },
  }])
  let mine = comment(task, sess)
  fanout(cast)(mine, { target: task })
  assertEquals(mintedFor(mine).length, 0) // the operator's own words
  let bare = uid(), t2 = uid()
  apply(db, [
    { eid: bare, name: 'doc', comp: { title: 'NoMail' } },
    { eid: bare, name: 'project', comp: {} },
    { eid: t2, name: 'doc', comp: { title: 'quiet work' } },
    { eid: t2, name: 'task', comp: { status: 'open', project: bare } },
  ])
  let c2 = comment(t2)
  fanout(cast)(c2, { target: t2 })
  assertEquals(mintedFor(c2).length, 0) // no address, no mail
})

Deno.test('fanout: commentary born with a task stays in its filing event', () => {
  let { proj } = fixture()
  let filed = uid(), c = uid()
  apply(db, [
    { eid: filed, name: 'doc', comp: { title: 'the filed work' } },
    {
      eid: filed,
      name: 'task',
      comp: { status: 'open', project: proj },
    },
    { eid: c, name: 'doc', comp: { title: '', body: 'filed T-1' } },
    { eid: c, name: 'comment', comp: { target: filed } },
  ])
  fanout(cast)(c, { target: filed })
  assertEquals(mintedFor(c).length, 0)

  let pending = db.prepare(
    `select o.eid as eid from comment join entity o on o.id = comment.entity
     where ${FANOUT_PENDING}`,
  )
    .all() as { eid: string }[]
  assertEquals(pending.some((r) => r.eid == c), false)

  // Birth commentary is a one-second window, not a standing exemption: age
  // the filing and the same task is news again.
  db.prepare(`
    update created set at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')
    where ${OWNED}
  `).run(filed)
  let later = uid()
  apply(db, [
    { eid: filed, name: 'task', comp: { status: 'wip' } },
    { eid: later, name: 'doc', comp: { title: '', body: 'new words' } },
    { eid: later, name: 'comment', comp: { target: filed } },
  ])
  fanout(cast)(later, { target: filed })
  assertEquals(mintedFor(later).length, 1)
})

// The debounce is the whole rule, so pin both of its edges. A comment inside
// the window is part of filing; one past it is correspondence, whatever it
// was filed against.
Deno.test('fanout: the birth window is one second, either side of it', () => {
  let { proj } = fixture()
  let target = uid(), inside = uid(), outside = uid()
  apply(db, [
    { eid: target, name: 'doc', comp: { title: 'the work' } },
    { eid: target, name: 'task', comp: { status: 'open', project: proj } },
    { eid: inside, name: 'doc', comp: { title: '', body: 'born beside it' } },
    { eid: inside, name: 'comment', comp: { target: target } },
    { eid: outside, name: 'doc', comp: { title: '', body: 'said after' } },
    { eid: outside, name: 'comment', comp: { target: target } },
  ])
  // Two seconds is the nearest gap the graph actually holds — inside the
  // window nothing sits between one second and it.
  db.prepare(`
    update created set at = strftime('%Y-%m-%dT%H:%M:%fZ', at, '+2 seconds')
    where ${OWNED}
  `).run(outside)

  fanout(cast)(inside, { target: target })
  fanout(cast)(outside, { target: target })
  assertEquals(mintedFor(inside).length, 0)
  assertEquals(mintedFor(outside).length, 1)
})

Deno.test('the sweep predicate finds unreceipted recent comments only', () => {
  let { task } = fixture()
  let fresh = comment(task)
  fanout(cast)(fresh, { target: task }) // receipted
  let missed = comment(task) // committed, effect never fired
  // past the horizon: history when the address arrived, not undelivered mail
  let old = comment(task)
  db.prepare(`
    update created set at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 hours')
    where ${OWNED}
  `).run(old)
  let pending = db.prepare(
    `select o.eid as eid from comment join entity o on o.id = comment.entity
     where ${FANOUT_PENDING}`,
  )
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
Deno.test('mailed: reply_to resolves to --in-reply-to at delivery', async () => {
  let dir = Deno.makeTempDirSync()
  Deno.env.set('TASKS_MAIL_CMD', mailer(dir))
  let orig = uid()
  apply(
    db,
    [
      { eid: orig, name: 'doc', comp: { title: 'question', body: 'asked' } },
      {
        eid: orig,
        name: 'mail',
        comp: {},
      },
      { eid: orig, name: 'deliver', comp: { to: 'us@x.test' } },
    ],
    undefined,
    author,
  )
  // inbound provenance is server-stamped (the inbound.ts idiom)
  db.prepare(`update mail set message_id = ? where ${OWNED}`)
    .run('msg:123:<orig-id@y.test>', orig)
  let reply = uid()
  apply(
    db,
    [
      { eid: reply, name: 'doc', comp: { title: 'Re: question', body: 'a' } },
      {
        eid: reply,
        name: 'mail',
        comp: { reply_to: orig },
      },
      { eid: reply, name: 'deliver', comp: { to: 'them@y.test' } },
    ],
    undefined,
    author,
  )
  await mailed(cast)(reply, {})
  assertMatch(
    mails(dir).at(-1)!,
    /--in-reply-to orig-id@y.test Re: question/,
  )
  // replying to our OWN sent mail threads through sent_id
  let sent = uid()
  apply(
    db,
    [
      { eid: sent, name: 'doc', comp: { title: 'opener', body: 'b' } },
      { eid: sent, name: 'mail', comp: {} },
      { eid: sent, name: 'deliver', comp: { to: 'them@y.test' } },
    ],
    undefined,
    author,
  )
  await mailed(cast)(sent, {})
  db.prepare(`update mail set sent_id = ? where ${OWNED}`)
    .run('cf-abc@sender', sent)
  let follow = uid()
  apply(
    db,
    [
      { eid: follow, name: 'doc', comp: { title: 'Re: opener', body: 'c' } },
      {
        eid: follow,
        name: 'mail',
        comp: { reply_to: sent },
      },
      { eid: follow, name: 'deliver', comp: { to: 'them@y.test' } },
    ],
    undefined,
    author,
  )
  await mailed(cast)(follow, {})
  assertMatch(mails(dir).at(-1)!, /--in-reply-to cf-abc@sender Re: opener/)
  // no id resolvable: delivered unthreaded, never an error
  let dark = uid()
  apply(
    db,
    [
      { eid: dark, name: 'doc', comp: { title: 'unthreadable', body: 'd' } },
      { eid: dark, name: 'mail', comp: { reply_to: sent } },
      { eid: dark, name: 'deliver', comp: { to: 'x@y.test' } },
    ],
    undefined,
    author,
  )
  db.prepare(`update mail set sent_id = null where ${OWNED}`).run(sent)
  await mailed(cast)(dark, {})
  let last = mails(dir).at(-1)!
  assertMatch(last, /unthreadable/)
  assertEquals(last.includes('--in-reply-to'), false)
  assertEquals(erow(dark), undefined)
  Deno.env.delete('TASKS_MAIL_CMD')
})

Deno.test('canon: the fleet domain sheds underscores; other domains pass', () => {
  assertEquals(canon('cafe_car@bot.test'), 'cafecar@bot.test')
  assertEquals(canon('Ops@Bot.Test'), 'ops@bot.test')
  assertEquals(canon('under_score@gmail.com'), 'under_score@gmail.com')
  assertEquals(canon('under_score@sub.bot.test'), 'under_score@sub.bot.test')
  assertEquals(canon('under_score@bot.test@'), 'under_score@bot.test@')
})

Deno.test('apply stores only the deliverable fleet address (T-5958)', () => {
  // The write path canonicalizes: the underscore spelling Cloudflare bounces
  // at RCPT can never land in the book — what's stored is the canonical form.
  let cafe = somebody('cafecar', 'cafe_car@bot.test')
  assertEquals(addressOf(cafe), 'cafecar@bot.test')
  // An off-domain address is another namespace's business — stored verbatim.
  let vendor = somebody('vendor', 'a_b@vendor.test')
  assertEquals(addressOf(vendor), 'a_b@vendor.test')
  // A later patch of the same entity's address is canonicalized too.
  apply(db, [{
    eid: cafe,
    name: 'email',
    comp: { address: 'CafE_Car@Bot.Test' },
  }])
  assertEquals(addressOf(cafe), 'cafecar@bot.test')
})

Deno.test('payload: text and rendered markdown, threading headers on mid', () => {
  let p = payload({
    from: 'ops@bot.test',
    to: 'jeff@yak.sh',
    subject: 'subj',
    body: '**bold** https://example.com and T-123 and [idea](T-124) `46dcd3f`',
    repo: 'https://github.com/acme/widget',
  })
  assertEquals(p.from, { address: 'ops@bot.test', name: 'ops' })
  assertEquals(p.to, ['jeff@yak.sh'])
  assertEquals(p.reply_to, 'ops@bot.test')
  assertEquals(p.subject, 'subj')
  assertEquals(
    p.text,
    '**bold** https://example.com and T-123 and [idea](T-124) `46dcd3f`',
  )
  assertStringIncludes(p.html, '<strong>bold</strong>')
  assertStringIncludes(p.html, '<a href="https://example.com">')
  // Absolute, and no data-ref: a mail client has no base document to
  // resolve `/T-123` against, and nothing to bind data-ref to (T-12558).
  assertStringIncludes(p.html, '<a href="https://tasks.yak.sh/T-123">T-123</a>')
  assertStringIncludes(p.html, '<a href="https://tasks.yak.sh/T-124">idea</a>')
  assertStringIncludes(
    p.html,
    'href="https://github.com/acme/widget/commit/46dcd3f"',
  )
  assertEquals(p.html.includes('data-ref'), false)
  assertEquals(p.html.includes('href="/'), false)
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
  Deno.env.set('TASKS_MAIL_FROM', 'holdco@bot.test')
  Deno.env.set('FLEET_MAIL_API_URL', 'http://fleet.test')
  Deno.env.set('FLEET_MAIL_API_TOKEN', 'dummy-fleet')
  let { hits, restore } = netStub((url) =>
    url.includes('/email/sending/send')
      ? { success: true, result: { message_id: '<cf-1@send>' } }
      : { ok: true }
  )
  try {
    let orig = uid()
    apply(
      db,
      [
        { eid: orig, name: 'doc', comp: { title: 'q', body: 'asked' } },
        { eid: orig, name: 'mail', comp: {} },
        { eid: orig, name: 'deliver', comp: { to: 'us@x.test' } },
      ],
      undefined,
      author,
    )
    db.prepare(`update mail set message_id = ? where ${OWNED}`)
      .run('msg:9:<orig@y.test>', orig)
    let m = uid()
    apply(
      db,
      [
        { eid: m, name: 'doc', comp: { title: 'Re: q', body: 'answered' } },
        {
          eid: m,
          name: 'mail',
          comp: { reply_to: orig },
        },
        // An external address (a fleet-domain one now resolves to its fleet
        // entity and delivers in-graph) — this is the native Cloudflare path.
        { eid: m, name: 'deliver', comp: { to: 'cafe_car@partner.test' } },
      ],
      undefined,
      author,
    )
    await mailed(cast)(m, {})
    let r = row(m)
    assertEquals(erow(m), undefined)
    assertEquals(r.sent_id, 'cf-1@send') // brackets shed
    assertEquals(r.to_addr, 'cafe_car@partner.test') // resolved envelope copy
    assertEquals(hits.length, 2)
    assertMatch(hits[0].url, /accounts\/acct-1\/email\/sending\/send$/)
    assertEquals(hits[0].auth, 'Bearer dummy-token')
    assertEquals(hits[0].body.from, {
      address: 'sender@bot.test',
      name: 'sender',
    })
    assertEquals(hits[0].body.to, ['cafe_car@partner.test'])
    assertEquals(hits[0].body.text, 'answered')
    assertEquals(hits[0].body.html, '<p>answered</p>\n')
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
    apply(
      db,
      [
        { eid: m, name: 'doc', comp: { title: 's', body: 'b' } },
        { eid: m, name: 'mail', comp: {} },
        { eid: m, name: 'deliver', comp: { to: 'x@y.test' } },
      ],
      undefined,
      author,
    )
    await mailed(cast)(m, {})
    assertMatch(String(erow(m)?.message), /send failed \(HTTP 200\)/)
    assertMatch(String(erow(m)?.at), /T/) // ran, failed — no retry storm
    assertEquals(row(m).sent_id, null)
    // An author with no address cannot borrow one: refused and stamped,
    // where it used to go out signed by the fleet default (T-9489).
    let bare = uid()
    apply(
      db,
      [
        { eid: bare, name: 'doc', comp: { title: 's', body: 'b' } },
        { eid: bare, name: 'mail', comp: {} },
        { eid: bare, name: 'deliver', comp: { to: 'x@y.test' } },
      ],
      undefined,
      unsigned,
    )
    await mailed(cast)(bare, {})
    assertMatch(String(erow(bare)?.message), /no sender/)
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
    apply(
      db,
      [
        { eid: m, name: 'doc', comp: { title: 'seam', body: 'held' } },
        { eid: m, name: 'mail', comp: {} },
        { eid: m, name: 'deliver', comp: { to: 'x@y.test' } },
      ],
      undefined,
      author,
    )
    await mailed(cast)(m, {})
    assertEquals(mails(dir).length, 1) // the override delivered
    assertEquals(hits.length, 0) // nothing touched the network path
    assertEquals(erow(m), undefined)
  } finally {
    restore()
    Deno.env.delete('TASKS_MAIL_CMD')
    nativeEnvOff()
  }
})

// --- local-first delivery: a fleet recipient never leaves the graph ---------

Deno.test('mailed: a fleet recipient delivers locally — no send, no out-log', async () => {
  nativeEnv()
  Deno.env.set('TASKS_MAIL_FROM', 'holdco@bot.test')
  Deno.env.set('FLEET_MAIL_API_URL', 'http://fleet.test')
  Deno.env.set('FLEET_MAIL_API_TOKEN', 'dummy-fleet')
  let dir = Deno.makeTempDirSync()
  Deno.env.set('TASKS_MAIL_CMD', mailer(dir))
  let { hits, restore } = netStub(() => ({ success: true }))
  try {
    let ops = somebody('ops', 'ops@bot.test')
    let m = uid()
    apply(
      db,
      [
        { eid: m, name: 'doc', comp: { title: 'ping', body: 'hi there' } },
        { eid: m, name: 'mail', comp: {} },
        { eid: m, name: 'deliver', comp: { to: 'ops' } },
      ],
      undefined,
      author,
    )
    let got: Parameters<typeof channelEvents>[0] = []
    await mailed((cs) => got.push(...cs))(m, {})
    let r = row(m)
    assertEquals(erow(m), undefined)
    assertEquals(r.to_addr, 'ops@bot.test')
    assertMatch(String(r.message_id), /^local:\d+:/) // the never-send mark
    assertMatch(String(r.received_at), /T/) // arrived
    assertMatch(String(drow(m)?.at), /T/) // delivered, and when
    assertEquals(Number(r.verified), 1) // apply() authenticated the author
    assertEquals(r.target, ops) // aimed at the recipient's inbox
    // The author signs it, even though TASKS_MAIL_FROM is set — the env
    // default no longer speaks for anyone (T-9489).
    assertEquals(r.from, 'sender@bot.test')
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
      operator: true,
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

// --- addressing an entity by its id ----------------------------------------

Deno.test('named: an id names its entity, and only under its own prefix', () => {
  let s = uid()
  apply(db, [
    { eid: s, name: 'doc', comp: { title: 'a session' } },
    { eid: s, name: 'session', comp: { id: 'sess-named' } },
  ])
  let n = (db.prepare('select num from entity where eid = ?').get(s) as {
    num: number
  }).num
  assertEquals(addressOf(s), `S-${n}@bot.test`)
  assertEquals(named(`S-${n}@bot.test`), s)
  assertEquals(named(`s-${n}@BOT.TEST`), s) // canon lowercases the local part
  // The prefix is part of the id, not decoration: the same num under the
  // wrong prefix is a typo, and delivering it anyway would hand the letter
  // to an entity the sender never named.
  assertEquals(named(`T-${n}@bot.test`), null)
  assertEquals(named(`S-${n}@example.test`), null) // fleet domain only
  assertEquals(named('S-99999999@bot.test'), null)
  assertEquals(named('holdco@bot.test'), null) // not id-shaped
})

Deno.test('mailed: a letter to S-<n> delivers to that session, in-graph', async () => {
  nativeEnv()
  let { hits, restore } = netStub(() => ({ success: true }))
  try {
    let s = uid()
    apply(db, [
      { eid: s, name: 'doc', comp: { title: 'the session' } },
      { eid: s, name: 'session', comp: { id: 'sess-deliver' } },
    ])
    let n = (db.prepare('select num from entity where eid = ?').get(s) as {
      num: number
    }).num
    let m = uid()
    apply(
      db,
      [
        { eid: m, name: 'doc', comp: { title: 'ping', body: 'you there?' } },
        { eid: m, name: 'mail', comp: {} },
        { eid: m, name: 'deliver', comp: { to: `S-${n}@bot.test` } },
      ],
      undefined,
      author,
    )
    let got: Parameters<typeof channelEvents>[0] = []
    await mailed((cs) => got.push(...cs))(m, {})
    let r = row(m)
    assertEquals(erow(m), undefined)
    assertEquals(r.target, s) // aimed at the session it named
    assertMatch(String(r.message_id), /^local:\d+:/) // never left the graph
    assertEquals(Number(r.verified), 1)
    assertEquals(hits.length, 0) // no Cloudflare, so no rule to depend on
    // and it rings that session's channel WITHOUT the operator gate
    let evs = channelEvents(got, {
      sessionEid: s,
      operator: false,
      idOf: () => 'E-2',
    })
    assertEquals(evs.length, 1)
    assertEquals(evs[0].meta.kind, 'mail')
  } finally {
    restore()
    nativeEnvOff()
  }
})

// An `email` comp is somebody's decision; the derivation is only the
// fallback for entities too short-lived to carry one.
Deno.test('named: the address book outranks the derivation', async () => {
  nativeEnv()
  let { restore } = netStub(() => ({ success: true }))
  try {
    let s = uid()
    apply(db, [
      { eid: s, name: 'doc', comp: { title: 'shadowed' } },
      { eid: s, name: 'session', comp: { id: 'sess-shadowed' } },
    ])
    let n = (db.prepare('select num from entity where eid = ?').get(s) as {
      num: number
    }).num
    // Somebody books the id-shaped address for themselves.
    let squatter = somebody('squatter', `S-${n}@bot.test`)
    let m = uid()
    apply(
      db,
      [
        { eid: m, name: 'doc', comp: { title: 'to whom', body: 'x' } },
        { eid: m, name: 'mail', comp: {} },
        { eid: m, name: 'deliver', comp: { to: `S-${n}@bot.test` } },
      ],
      undefined,
      author,
    )
    await mailed(cast)(m, {})
    assertEquals(row(m).target, squatter)
  } finally {
    restore()
    nativeEnvOff()
  }
})

Deno.test('mailed: a book entry Cloudflare would bounce still lands at home', async () => {
  nativeEnv()
  let { hits, restore } = netStub(() => ({ success: true }))
  try {
    let p = somebody('under_bot', 'under_score@bot.test')
    let m = uid()
    apply(
      db,
      [
        { eid: m, name: 'doc', comp: { title: 's', body: 'b' } },
        {
          eid: m,
          name: 'mail',
          comp: {},
        },
        { eid: m, name: 'deliver', comp: { to: 'under_score@bot.test' } },
      ],
      undefined,
      author,
    )
    await mailed(cast)(m, {})
    let r = row(m)
    assertEquals(erow(m), undefined)
    assertEquals(r.target, p) // the pre-canon spelling found the book
    assertEquals(r.from, 'sender@bot.test') // signed by its author
    assertEquals(hits.length, 0)
  } finally {
    restore()
    nativeEnvOff()
  }
})

Deno.test('mailed: local delivery keeps a relay mail aimed at its task', async () => {
  let t = uid()
  somebody('relayed', 'relayed@bot.test')
  apply(db, [
    { eid: t, name: 'doc', comp: { title: 'the work' } },
    { eid: t, name: 'task', comp: { status: 'open' } },
  ])
  let m = uid()
  apply(
    db,
    [
      { eid: m, name: 'doc', comp: { title: '[T] the work', body: 'a note' } },
      { eid: m, name: 'mail', comp: { target: t } },
      { eid: m, name: 'deliver', comp: { to: 'relayed' } },
    ],
    undefined,
    author,
  )
  await mailed(cast)(m, {})
  assertEquals(row(m).target, t) // the arrive() precedent holds
  assertMatch(String(row(m).message_id), /^local:/)
})

Deno.test('mailed: an external address in the book still rides the boundary', async () => {
  let dir = Deno.makeTempDirSync()
  Deno.env.set('TASKS_MAIL_CMD', mailer(dir))
  somebody('owner', 'owner@ext.test')
  let m = uid()
  apply(
    db,
    [
      { eid: m, name: 'doc', comp: { title: 'to the owner', body: 'words' } },
      { eid: m, name: 'mail', comp: {} },
      { eid: m, name: 'deliver', comp: { to: 'owner' } },
    ],
    undefined,
    author,
  )
  await mailed(cast)(m, {})
  assertEquals(mails(dir).length, 1) // delivered outward, not locally
  assertEquals(row(m).message_id, null)
  Deno.env.delete('TASKS_MAIL_CMD')
})

Deno.test('mailed: concurrent fires deliver once (the boot-sweep race)', async () => {
  let dir = Deno.makeTempDirSync()
  Deno.env.set('TASKS_MAIL_CMD', mailer(dir))
  let m = uid()
  apply(
    db,
    [
      { eid: m, name: 'doc', comp: { title: 'once', body: 'only' } },
      { eid: m, name: 'mail', comp: {} },
      { eid: m, name: 'deliver', comp: { to: 'x@y.test' } },
    ],
    undefined,
    author,
  )
  // dispatch and sweep racing: both fire before either stamps
  await Promise.all([mailed(cast)(m, {}), mailed(cast)(m, {})])
  assertEquals(mails(dir).length, 1)
  Deno.env.delete('TASKS_MAIL_CMD')
})

// The point of T-9511/T-9489, stated directly: a letter is signed by whoever
// wrote it, and the writer gets no say. `from` is off the wire, so a caller
// asserting one is not refused so much as unable — there is no column to
// write. Two ventures, both directions, plus an attempt to borrow.
Deno.test('the sender is the author, in both directions and unborrowable', () => {
  let alpha = somebody('alpha-co', 'alpha@bot.test')
  let beta = somebody('beta-co', 'beta@bot.test')

  // alpha writes to beta, and tries to sign the letter as beta
  let out = uid()
  apply(
    db,
    [
      { eid: out, name: 'doc', comp: { title: 'hello', body: 'b' } },
      {
        eid: out,
        name: 'mail',
        comp: {},
      },
      { eid: out, name: 'deliver', comp: { to: 'beta@bot.test' } },
    ],
    undefined,
    alpha,
  )
  assertEquals(row(out).from, 'alpha@bot.test') // the claim never lands

  // beta answers — signed by beta, not by the address it is answering
  let back = uid()
  apply(
    db,
    [
      { eid: back, name: 'doc', comp: { title: 'Re: hello', body: 'b' } },
      {
        eid: back,
        name: 'mail',
        comp: { reply_to: out },
      },
      { eid: back, name: 'deliver', comp: { to: 'alpha@bot.test' } },
    ],
    undefined,
    beta,
  )
  assertEquals(row(back).from, 'beta@bot.test')

  // and the vocabulary itself is the guarantee: no `from` to write
  assertEquals('from' in comps.mail, false)
})

// The residual T-9511 left behind: signing fell back to the box owner when
// nothing named a writer, so an unattributed POST — and every relay letter,
// which names none — went out as the owner, the highest-trust byline there
// is. Provenance may fall back; a signature may not.
Deno.test('nothing signs by fallback: the relay, and the unattributed write', async () => {
  let voice = somebody('a-venture', 'venture@bot.test')

  // A relay carries someone's words, so it is signed by whoever wrote them.
  let { task } = fixture()
  let c = comment(task, voice)
  fanout(cast)(c, { target: task })
  assertEquals(mintedFor(c)[0].from, 'venture@bot.test')

  // An unattributed write signs nothing at all, and delivery refuses it
  // rather than letting it speak as the owner.
  let m = uid()
  apply(db, [
    { eid: m, name: 'doc', comp: { title: 's', body: 'b' } },
    { eid: m, name: 'mail', comp: {} },
    { eid: m, name: 'deliver', comp: { to: 'x@y.test' } },
  ])
  assertEquals(row(m).from, null)
  await mailed(cast)(m, {})
  assertMatch(String(erow(m)?.message), /no sender/)
})
