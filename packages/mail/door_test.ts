import { test } from '@yaks/testing'
import { assertEquals, assertMatch } from '@std/assert'
import { type Bundle, type Comp, detached, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernel, kernelDoc, kernelKeywords } from '@yaks/kernel'
import { docDoc } from '@yaks/doc'
import { edgeDoc, edgeKeywords, edges, link } from '@yaks/edge'
import { projectDoc } from '@yaks/project'
import { taskDoc, tasks } from '@yaks/task'
import { type Row, threads } from '@yaks/inbox'
import { mailDoc } from './comp.ts'
import { arrived } from './arrive.ts'
import { inboxAt, planned, queue } from './door.ts'
import { payload } from './cloudflare.ts'
import { message, sending } from './send.ts'
import { stash } from './stash.ts'
import { routes } from './routes.ts'
import { service } from './service.ts'

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
  ], [kernelKeywords, edgeKeywords])
  let g = graph({
    vocab,
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
