import { test } from '@yaks/testing'
import { assertEquals, assertMatch, assertStringIncludes } from '@std/assert'
import { type Bundle, type Comp, detached, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernel, kernelDoc, kernelKeywords } from '@yaks/kernel'
import { docDoc } from '@yaks/doc'
import { edgeDoc, edgeKeywords, edges, link } from '@yaks/edge'
import { projectDoc } from '@yaks/project'
import { taskDoc, tasks } from '@yaks/task'
import { type Row, threads } from '@yaks/inbox'
import { inboxDoc } from '@yaks/inbox/vocab'
import { sessionDoc } from '@yaks/session/vocab'
import { mailDoc } from './comp.ts'
import { arrived } from './arrive.ts'
import { inboxAt, planned, queue } from './door.ts'
import { payload } from './cloudflare.ts'
import { message, sending } from './send.ts'
import { stash } from './stash.ts'
import { routes } from './routes.ts'
import { service } from './service.ts'
import { type Edge, pull } from './pull.ts'

let at = (n: number) => `2026-10-02T12:00:${String(n).padStart(2, '0')}.000Z`
let inbox = {
  person: 'person',
  from: 'inbox@books.example',
  base: 'https://box.example',
}
let options = {
  inbox,
  domain: 'books.example',
  sender: { via: 'stash' as const },
}
let decision = {
  question: 'Which route?',
  choices: [
    { label: 'Train', description: 'Arrive earlier' },
    { label: 'Bus', description: 'Spend less' },
  ],
  recommended: 'Train',
}
let row = (eid: string, comps: Row['comps'], n = 1): Row => ({
  eid,
  comps: { created: { at: at(n), by: 'agent' }, ...comps },
})
let reader = {
  actor: 'person',
  operator: true,
  addrs: new Set(['ana@books.example']),
}
let needs = (blocking = true) =>
  threads([
    row('ask', {
      task: {},
      decision,
      doc: { title: 'Which route?' },
      filed: { assignee: 'person' },
    }),
    row('eventual', { task: {}, filed: { assignee: 'person' } }),
    row('bug', { bug: { last: at(2) } }),
    row('work', { task: {}, completed: { at: at(3) } }),
    ...(blocking
      ? [
        row('dep', { task: {} }),
        row('edge', { requires: {}, edge: { from: 'dep', to: 'ask' } }),
      ]
      : []),
  ], { ...reader, watching: new Set(['work']) })
let comp = (b: Bundle, name: string) => b[name] as Comp

let world = async () => {
  let vocab = loadVocab([
    kernelDoc,
    docDoc,
    edgeDoc,
    taskDoc,
    projectDoc,
    mailDoc,
    inboxDoc,
    sessionDoc,
  ], [kernelKeywords, edgeKeywords])
  let g = graph({
    vocab,
    actor: { by: 'agent' },
    storage: ram(vocab),
    plugins: [kernel(), tasks(), edges(vocab)],
  })
  await g.apply([
    {
      entity: { eid: 'person' },
      doc: { title: 'Ana' },
      email: { address: 'ana@books.example' },
    },
    {
      entity: { eid: 'ask' },
      task: {},
      decision,
      filed: { assignee: 'person' },
    },
    { entity: { eid: 'dep' }, task: {} },
    link('dep', 'requires', 'ask'),
    {
      entity: { eid: 'comment' },
      doc: { body: 'Can you choose?' },
      comment: { target: 'ask' },
    },
  ])
  return g
}

test('mail loads complete root/latest words and choices without digest history', async () => {
  let g = await world()
  let body = 'root words '.repeat(1024) + 'root ending'
  let latest = 'latest words '.repeat(1024) + 'latest ending'
  await g.apply([
    { entity: { eid: 'ask' }, doc: { body } },
    {
      entity: { eid: 'older' },
      comment: { target: 'ask' },
      doc: { body: 'older history' },
      created: { at: at(1) },
    },
    {
      entity: { eid: 'comment' },
      doc: { body: latest },
      created: { at: at(2) },
    },
  ], { trusted: true })
  let got: string[] = []
  let list = await inboxAt(
    {
      read: (query, opts) => g.read(query, opts),
      get: (ids, comps, opts) => {
        if (comps?.includes('doc') || comps?.includes('content')) {
          got.push(...ids)
        }
        return g.get(ids, comps, opts)
      },
    },
    g.vocab,
    'person',
  )
  assertEquals(got.sort(), ['ask', 'comment'])
  assertEquals(list[0].row.comps.doc?.body, body)
  assertEquals(list[0].latest.comps.doc?.body, latest)
  assertEquals(list[0].row.comps.decision?.choices, decision.choices)
  let [letter] = planned(list, [], inbox, at(10))
  assertStringIncludes(String(comp(letter, 'doc').body), latest)
  assertStringIncludes(
    String(comp(letter, 'doc').body),
    '1. Train: Arrive earlier',
  )
  assertStringIncludes(String(comp(letter, 'doc').body), '2. Bus: Spend less')
  let rootOnly = { ...list[0], latest: list[0].row }
  assertStringIncludes(
    String(comp(planned([rootOnly], [], inbox, at(10))[0], 'doc').body),
    body,
  )
})

test('the service queues a blocking decision before the digest hour, once', async () => {
  let g = await world()
  let early = { ...options, inbox: { ...inbox, hour: 24 } }
  await service({ graph: g }, early)
  let [letter, ...more] = await g.read('.mail_notice&.mail&*')
  assertEquals(more, [])
  assertEquals(comp(letter, 'mail').target, 'ask')
  assertStringIncludes(String(comp(letter, 'doc').body), 'Can you choose?')
  await service({ graph: g }, early)
  assertEquals((await g.read('.mail_notice&.mail&*')).length, 1)
})

test('email queues blocking decisions once and digests the rest once daily, without alerts or updates', () => {
  let list = needs()
  let immediate = planned(list, [], inbox, at(4))
  assertEquals(immediate.length, 1)
  assertEquals(comp(immediate[0], 'mail').target, 'ask')
  assertMatch(String(comp(immediate[0], 'doc').body), /2\. Bus: Spend less/)
  assertEquals(planned(list, immediate, inbox, at(5)), [])
  let digest = planned(list, immediate, inbox, at(5), true)
  assertEquals(digest.filter((b) => b.mail).length, 1)
  assertEquals(comp(digest[0], 'mail').target, undefined)
  assertEquals(String(comp(digest[0], 'doc').body).includes('bug@'), false)
  assertEquals(String(comp(digest[0], 'doc').body).includes('work@'), false)
  assertEquals(planned(list, [...immediate, ...digest], inbox, at(6), true), [])
  let later = needs(false)
  later.find((t) => t.eid == 'ask')!.at = '2026-10-03T12:00:00.000Z'
  assertEquals(
    planned(
      later,
      [...immediate, ...digest],
      inbox,
      '2026-10-03T12:00:01.000Z',
      true,
    ).filter((b) => b.mail).length,
    1,
  )
})

test('sending an inbox rendering threads it by its predecessor and never creates more inbox activity', () => {
  let [first] = planned(needs(), [], inbox, at(4))
  first.mail = { ...comp(first, 'mail'), message_id: 'out@box' }
  let next = needs()
  next[0].at = at(7)
  let [second] = planned(next, [first], inbox, at(8))
  assertEquals(comp(second, 'mail').reply_to, first.entity.eid)
  let sent = message(second, 'ana@books.example', 'out@box')
  assertEquals(payload(sent).headers?.['In-Reply-To'], '<out@box>')
  let original = needs()[0].row
  let sentRow = row(first.entity.eid, {
    doc: comp(first, 'doc'),
    mail: comp(first, 'mail'),
    deliver: comp(first, 'deliver'),
    mail_notice: comp(first, 'mail_notice'),
  }, 9)
  assertEquals(threads([original, sentRow], reader)[0].at, at(1))
})

test('archived or read decisions and muted threads never queue email; requested alerts do', () => {
  let original = needs()
  original[0].unread = false
  assertEquals(planned(original, [], inbox, at(4)).length, 0)
  let root = original[0].row
  root.comps.archived = { at: at(5) }
  assertEquals(planned(threads([root], reader), [], inbox, at(6), true), [])
  delete root.comps.archived
  assertEquals(
    planned(
      threads([root], { ...reader, muting: new Set(['ask']) }),
      [],
      inbox,
      at(6),
      true,
    ),
    [],
  )
  let [digest] = planned(
    needs(),
    [],
    { ...inbox, alerts: true, updates: true },
    at(4),
    true,
  ).filter((b) => b.mail).slice(-1)
  assertMatch(String(comp(digest, 'doc').body), /bug@books.example/)
  assertMatch(String(comp(digest, 'doc').body), /work@books.example/)
})

test('the inbox reader queues a letter, transports via stash, and accepts a verified threaded numbered reply once', async () => {
  let g = await world()
  let list = await inboxAt(g, g.vocab, 'person')
  assertEquals(list[0].blocking, true)
  await queue(g, g.vocab, inbox, (b) => g.apply(b), at(10))
  let [letter] = await g.read('.mail_notice&.mail&*')
  let post = stash()
  let sender = sending({ sender: post })
  await sender(
    { kind: 'created', name: 'mail', entity: letter.entity, touched: ['mail'] },
    detached(g.storage),
    (b) => g.apply(b, { trusted: true }),
  )
  let [sent] = await g.get([letter.entity.eid])
  assertEquals(comp(sent, 'mail').message_id, 'stash-1')
  let request = () =>
    new Request('http://box/mail/inbound', {
      method: 'POST',
      body: JSON.stringify({
        from: 'ana@books.example',
        to: inbox.from,
        verified: true,
        headers: {
          From: 'Ana <ana@books.example>',
          'Message-ID': '<reply@box>',
          'In-Reply-To': '<stash-1>',
        },
        text: '2\n\nOn Friday Agent wrote:\n> Which route?',
      }),
    })
  let door = routes({ graph: g }, options)[0]
  assertEquals((await door.handle(request())).status, 200)
  let [answered] = await g.get(['ask'])
  assertEquals(comp(answered, 'decided').choice, 'Bus')
  assertEquals(comp(answered, 'decided').by, 'person')
  assertEquals(comp(answered, 'completed').by, 'person')
  let replies = await g.read('.mail.message_id=reply@box&*')
  assertEquals(comp(replies[0], 'comment'), {
    target: 'ask',
    reply_to: 'comment',
  })
  assertEquals((await door.handle(request())).status, 200)
  assertEquals((await g.read('.mail.message_id=reply@box&*')).length, 1)
  await queue(g, g.vocab, inbox, (b) => g.apply(b), at(11), true)
  assertEquals((await g.read('.mail_notice&.mail&*')).length, 1)
})

for (
  let [from, verified] of [['ana@books.example', false], [
    'stranger@books.example',
    true,
  ]] as const
) {
  test(`untrusted reply ${from}, verified=${verified} keeps mail but cannot choose or comment`, async () => {
    let g = await world()
    await queue(g, g.vocab, inbox, (b) => g.apply(b), at(10))
    let [letter] = await g.read('.mail_notice&.mail&*')
    await g.apply([{ entity: letter.entity, mail: { message_id: 'sent@box' } }])
    let bundles = await arrived({ graph: g, ...options })({
      from,
      to: inbox.from,
      headers: new Headers({
        'Message-ID': 'reply@box',
        'In-Reply-To': '<sent@box>',
      }),
    }, { text: '2', verified })
    await g.apply(bundles)
    assertEquals(bundles.length, 1)
    assertEquals(bundles[0].comment, undefined)
    assertEquals((await g.get(['ask']))[0].decided, undefined)
  })
}

test('digest thread addresses route comments and custom answers; the digest itself is not an arbitrary decision', async () => {
  let g = await world()
  let receive = arrived({ graph: g, ...options })
  await g.apply(
    await receive({
      from: 'ana@books.example',
      to: 'comment@books.example',
      headers: new Headers({ 'Message-ID': 'custom@box' }),
    }, { target: 'comment', text: 'Walk together', verified: true }),
  )
  let [answered] = await g.get(['ask'])
  assertEquals(comp(answered, 'decided').choice, 'Walk together')
  let [comment] = await g.read('.mail.message_id=custom@box&*')
  assertEquals(comp(comment, 'comment').reply_to, 'comment')
  let again = await receive({
    from: 'ana@books.example',
    to: inbox.from,
    headers: new Headers({ 'Message-ID': 'again@box' }),
  }, { target: 'ask', text: '1', verified: true })
  await g.apply(again)
  assertEquals(
    comp((await g.get(['ask']))[0], 'decided').choice,
    'Walk together',
  )
})

test('the service can queue a digest without pulling an edge or sending any real mail', async () => {
  let g = await world()
  await g.apply([{ entity: { eid: 'dep' }, completed: {} }])
  await service({ graph: g }, { ...options, inbox: { ...inbox, hour: 0 } })
  let [letter] = await g.read('.mail_notice&.mail&*')
  assertEquals(comp(letter, 'mail').target, undefined)
  await service({ graph: g }, { ...options, inbox: { ...inbox, hour: 0 } })
  assertEquals((await g.read('.mail_notice&.mail&*')).length, 1)
})

test('a daily digest does not suppress unseen thread activity or a decision becoming blocking', () => {
  let list = needs(false)
  let digest = planned(list, [], inbox, at(10), true)
  // Only activity actually rendered was notified, not everything before now.
  list.find((t) => t.eid == 'eventual')!.at = at(8)
  assertEquals(
    planned(list, digest, inbox, '2026-10-03T12:00:00.000Z', true)
      .filter((b) => b.mail).length,
    1,
  )
  let blocking = needs()
  assertEquals(
    planned(blocking, digest, inbox, at(11)).filter((b) => b.mail).length,
    1,
  )
})

test('replying to a digest keeps the words without choosing its first decision', async () => {
  let g = await world()
  await g.apply([{ entity: { eid: 'dep' }, completed: {} }])
  await queue(g, g.vocab, inbox, (b) => g.apply(b), at(10), true)
  let [digest] = await g.read('.mail_notice&.mail&*')
  await g.apply([{ entity: digest.entity, mail: { message_id: 'digest@box' } }])
  let bundles = await arrived({ graph: g, ...options })({
    from: 'ana@books.example',
    to: inbox.from,
    headers: new Headers({
      'Message-ID': 'digest-reply@box',
      'In-Reply-To': 'digest@box',
    }),
  }, { text: '2', verified: true })
  await g.apply(bundles)
  assertEquals(bundles[0].comment, undefined)
  assertEquals((await g.get(['ask']))[0].decided, undefined)
  assertEquals(comp(bundles[0], 'doc').body, '2')
})

test('invalid choice numbers keep a comment without completing the decision', async () => {
  let g = await world()
  let bundles = await arrived({ graph: g, ...options })({
    from: 'ana@books.example',
    to: 'ask@books.example',
    headers: new Headers({ 'Message-ID': 'invalid@box' }),
  }, { target: 'ask', text: '9', verified: true })
  await g.apply(bundles)
  assertEquals(comp(bundles[0], 'comment').target, 'ask')
  assertEquals((await g.get(['ask']))[0].decided, undefined)
})

// Both receiving doors share arrived(); no harness or transport can spend money
// in this fixture. A default graph writer makes sender attribution observable.
let freshLetter = (extra: Record<string, unknown> = {}) => ({
  from: 'bounces@relay.example',
  to: 'In_Box@Books.Example',
  headers: {
    From: 'Ana <ana@books.example>',
    Subject: 'Not the conversation title',
    'Message-ID': '<conversation@box>',
  },
  text: 'Can we plan dinner?\nMy own words, in full.',
  verified: true,
  ...extra,
})
let postFresh = (g: ReturnType<typeof graph>, extra = {}) =>
  routes({ graph: g }, options)[0].handle(
    new Request('http://box/mail/inbound', {
      method: 'POST',
      body: JSON.stringify(freshLetter(extra)),
    }),
  )

test('a verified new inbox letter is a caller-attributed conversation, once, and replies remain comments', async () => {
  let g = await world()
  let response = await postFresh(g)
  assertEquals(response.status, 200)
  let { eid } = await response.json()
  let [root] = await g.get([eid])
  assertEquals(root.conversation, {})
  assertEquals(comp(root, 'created').by, 'person')
  assertEquals(comp(root, 'created').via, undefined)
  assertEquals(comp(root, 'doc'), {
    title: 'Can we plan dinner?',
    body: freshLetter().text,
  })
  assertEquals(comp(root, 'mail').message_id, 'conversation@box')
  assertEquals(comp(root, 'mail').target, undefined)
  assertEquals(root.comment, undefined)
  assertEquals(root.deliver, undefined)
  assertEquals(await (await postFresh(g)).json(), { eid: null })
  let follow = await postFresh(g, {
    headers: {
      From: 'Ana <ana@books.example>',
      'Message-ID': '<follow@box>',
      'In-Reply-To': '<conversation@box>',
    },
    text: 'Tomorrow instead',
  })
  assertEquals(follow.status, 200)
  let [reply] = await g.get([(await follow.json()).eid])
  assertEquals(reply.conversation, undefined)
  assertEquals(comp(reply, 'comment').target, eid)
  assertEquals(comp(reply, 'created').by, 'person')
  assertEquals(comp(reply, 'doc').body, 'Tomorrow instead')
  let rows = await g.read('.conversation | .comment *')
  let list = threads(
    rows.map((b) => ({
      eid: b.entity.eid,
      comps: b as Row['comps'],
    })),
    reader,
  )
  assertEquals(list.find((t) => t.eid == eid)?.messages.map((r) => r.eid), [
    eid,
    reply.entity.eid,
  ])
  for (
    let [from, verified] of [['stranger@books.example', true], [
      'ana@books.example',
      false,
    ]] as const
  ) {
    let rejected = await arrived({ graph: g, ...options })({
      from,
      to: inbox.from,
      headers: new Headers({ 'In-Reply-To': '<conversation@box>' }),
    }, { verified, text: 'Not authorized' })
    assertEquals(rejected[0].conversation, undefined)
    assertEquals(rejected[0].comment, undefined)
  }
  let idReply = await arrived({ graph: g, ...options })({
    from: 'ana@books.example',
    to: `${eid}@books.example`,
    headers: new Headers({ 'Message-ID': 'direct@box' }),
  }, { target: eid, verified: true, text: 'Direct thread reply' })
  await g.apply(idReply)
  assertEquals(idReply[0].conversation, undefined)
  assertEquals(comp(idReply[0], 'comment').target, eid)
})

for (
  let [name, extra] of [
    ['unknown sender', { headers: { From: 'stranger@books.example' } }],
    ['failed verification', { verified: false }],
    ['missing verification', { verified: undefined }],
    ['different address', { to: 'other@books.example' }],
    ['unknown parent', {
      headers: { From: 'ana@books.example', 'In-Reply-To': '<lost@box>' },
    }],
    ['references without parent', {
      headers: { From: 'ana@books.example', References: '<lost@box>' },
    }],
    ['empty words', { text: '   ' }],
  ] as const
) {
  test(`new inbox letters fail closed: ${name}`, async () => {
    let g = await world()
    let res = await postFresh(g, extra)
    assertEquals(res.status, 200)
    let [kept] = await g.get([(await res.json()).eid])
    assertEquals(kept.conversation, undefined)
    assertEquals(kept.comment, undefined)
    assertEquals(comp(kept, 'doc').body, freshLetter(extra).text)
    if (name == 'unknown sender') {
      assertEquals(comp(kept, 'created').by, undefined)
    }
  })
}

test('a different known sender and an inactive inbox cannot start conversations', async () => {
  let g = await world()
  await g.apply([{
    entity: { eid: 'other' },
    email: { address: 'other@books.example' },
  }])
  let receive = arrived({ graph: g, ...options })
  let kept = await receive({
    from: 'other@books.example',
    to: inbox.from,
    headers: new Headers(),
  }, { verified: true, text: 'Hello' })
  await g.apply(kept)
  assertEquals(kept[0].conversation, undefined)
  assertEquals(
    comp((await g.get([kept[0].entity.eid]))[0], 'created').by,
    'other',
  )
  let res = await routes({ graph: g }, { domain: options.domain })[0].handle(
    new Request('http://box/mail/inbound', {
      method: 'POST',
      body: JSON.stringify(freshLetter()),
    }),
  )
  assertEquals(res.status, 200)
  assertEquals(
    (await g.get([(await res.json()).eid]))[0].conversation,
    undefined,
  )
})

test('pull records a verified inbox conversation before acknowledgement and redelivery adds nothing', async () => {
  let g = await world()
  let acked: string[] = []
  let edge: Edge = {
    messages: () =>
      Promise.resolve([{
        id: 'msg:123:<pulled@box>',
        from: 'bounces@relay.example',
        from_header: 'Ana <ana@books.example>',
        to: inbox.from,
        subject: 'Envelope subject',
        text: 'Pulled words\nKeep them all',
        verified: true,
      }]),
    notified: async (ids) => {
      let [kept] = await g.read('.mail.message_id=pulled@box *')
      assertEquals(kept.conversation, {})
      assertEquals(comp(kept, 'created').by, 'person')
      assertEquals(comp(kept, 'doc').title, 'Pulled words')
      acked.push(...ids)
    },
    requests: () => Promise.resolve([]),
    processed: async () => {},
  }
  assertEquals(await pull({ graph: g, ...options }, edge), {
    messages: 1,
    requests: 0,
  })
  assertEquals(await pull({ graph: g, ...options }, edge), {
    messages: 1,
    requests: 0,
  })
  assertEquals(acked, ['msg:123:<pulled@box>', 'msg:123:<pulled@box>'])
  assertEquals((await g.read('.conversation *')).length, 1)
})

test('system-generated inbound echoes cannot become conversations or comments, independently of the person filter', async () => {
  let g = await world()
  await g.apply([
    {
      entity: { eid: 'agent-session' },
      session: { actor: 'person' },
      email: { address: 'agent@books.example' },
    },
    { entity: { eid: 'person' }, session: { actor: 'person' } },
  ])
  for (
    let [from, automatic] of [
      ['agent@books.example', 'no'],
      ['ana@books.example', 'no'],
      [inbox.from, 'no'],
      ['ana@books.example', 'auto-replied'],
    ]
  ) {
    for (let target of [undefined, 'ask']) {
      let out = await arrived({ graph: g, ...options })({
        from,
        to: inbox.from,
        headers: new Headers({ 'Auto-Submitted': automatic }),
      }, {
        text: 'System prose',
        verified: true,
        ...(target ? { target } : {}),
      })
      assertEquals(out[0].conversation, undefined)
      assertEquals(out[0].comment, undefined)
      assertEquals(comp(out[0], 'doc').body, 'System prose')
      await g.apply(out)
      if (from == 'agent@books.example') {
        assertEquals(
          comp((await g.get([out[0].entity.eid]))[0], 'created').by,
          'agent-session',
        )
      }
    }
  }
})

test('an automatic echo of the configured person fails closed without a system identity', async () => {
  let g = await world()
  for (let target of [undefined, 'ask']) {
    let out = await arrived({ graph: g, ...options })({
      from: 'ana@books.example',
      to: inbox.from,
      headers: new Headers({ 'Auto-Submitted': 'auto-generated' }),
    }, { verified: true, text: 'Effect prose', ...(target ? { target } : {}) })
    assertEquals(out[0].conversation, undefined)
    assertEquals(out[0].comment, undefined)
  }
})
