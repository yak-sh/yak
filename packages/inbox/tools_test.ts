/** Conversation creation through the declared CLI grammar and the real tool runner.
 * RAM keeps the proof local while exercising admission, writer stamps and inbox reads.
 */
import { assertEquals, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { type Bundle, type Comp, graph, mint } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { kernel, kernelDoc, kernelKeywords } from '@yaks/kernel'
import { docDoc } from '@yaks/doc'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import {
  callDoc,
  executionComputed,
  runner,
  toolDoc,
  toolEid,
} from '@yaks/tools'
import { argsFor } from '@yaks/cli/grammar'
import { readInbox } from './read.ts'
import { type Reader, readerAt, type Row, threads } from './mod.ts'
import { candidates, discussion, words } from './queries.ts'
import { notifyDoc } from '@yaks/notify'
import { markAttention } from '@yaks/notify/attention'
import { runs } from './tools.ts'
import { inboxDoc } from './vocab.ts'
import { mailDoc } from '@yaks/mail/vocab'
import { runs as mail } from '@yaks/mail/tools'

let agent = '00000000-0000-4000-8000-000000000001'
let caller = '00000000-0000-4000-8000-000000000002'

let tools = loadTools(inboxDoc, runs())
let vocab = loadVocab([
  kernelDoc,
  docDoc,
  callDoc,
  toolDoc,
  inboxDoc,
  notifyDoc,
], [
  kernelKeywords,
])
let world = () => {
  let g = graph({
    vocab,
    storage: ram(vocab, { computed: executionComputed }),
    plugins: [kernel()],
  })
  let r = runner(g, { tools })
  let create = async (text: string, by: string) => {
    await r.ensure()
    return (await r.call({
      entity: { eid: mint() },
      call: { to: toolEid('inbox_new'), args: { text } },
      $actor: { by },
    })).find((b) => b.conversation)!
  }
  return { g, create, r }
}

test('inbox new accepts caller text and stores a conversation under that caller', async () => {
  let text = '  Plan the work\r\nKeep these exact words.\n'
  let tool = tools.find((t) => t.name == 'inbox_new')!
  let args = await argsFor(tool, [text])
  assertEquals(args, { text })
  assertEquals(await argsFor(tool, ['Plan', 'the', 'work']), {
    text: 'Plan the work',
  })
  let { g, create } = world()
  let made = await create(String(args.text), caller)
  let stored = (await g.get([made.entity.eid]))[0]
  assertEquals(stored.conversation, {})
  assertEquals(stored.doc, { title: '  Plan the work', body: text })
  assertEquals((stored.created as Comp).by, caller)
  let other = await create('Agent words', agent)
  assertEquals(
    ((await g.get([other.entity.eid]))[0].created as Comp).by,
    agent,
  )
})

test('an empty conversation is refused without inventing caller words', async () => {
  let tool = tools.find((t) => t.name == 'inbox_new')!
  let { g } = world()
  for (let text of ['', ' \n\t']) {
    await assertRejects(async () =>
      await tool.run({ entity: { eid: 'call' }, call: { args: { text } } }, g)
    )
  }
})

test('conversation reads retain the mark, root words, ordered replies and archive activity', async () => {
  let { g, create } = world()
  await g.apply([{ entity: { eid: caller }, doc: { title: 'Caller' } }])
  let made = await create('Question\nOriginal words', caller)
  let eid = made.entity.eid
  let who: Reader = { actor: caller }
  let row = (b: Bundle): Row => ({
    eid: b.entity.eid,
    comps: b as Row['comps'],
  })
  let inbox = async () => {
    let first = (await g.read(candidates(who, words(g.vocab)))).map(row)
    let rest = (await g.read(discussion(first, words(g.vocab)))).map(row)
    return threads([...first, ...rest], who)
  }
  let thread = (await inbox()).find((t) => t.eid == eid)!
  assertEquals(thread.row.comps.conversation, {})
  assertEquals(thread.row.comps.doc?.body, 'Question\nOriginal words')
  assertEquals(thread.lane, 'Recent')
  let archived = await markAttention(g, caller, eid, 'archived')
  await g.apply(archived, {
    now: '2100-01-01T00:00:00.000Z',
  })
  who = readerAt((await g.get([archived[0].entity.eid])).map(row), caller)
  assertEquals((await inbox()).some((t) => t.eid == eid), false)
  await g.apply([{
    entity: { eid: 'answer' },
    comment: { target: eid },
    doc: { body: 'An answer' },
    $actor: { by: agent },
  }], { now: '2100-01-01T00:00:01.000Z' })
  await g.apply([{
    entity: { eid: 'followup' },
    comment: { target: eid, reply_to: 'answer' },
    doc: { body: 'Follow up' },
    $actor: { by: caller },
  }], { now: '2100-01-01T00:00:02.000Z' })
  thread = (await inbox()).find((t) => t.eid == eid)!
  assertEquals(thread.lane, 'Replies')
  assertEquals(thread.messages.map((r) => r.eid), ['answer', 'followup'])
  assertEquals(thread.row.comps.doc?.body, 'Question\nOriginal words')
  assertEquals((await inbox()).some((t) => t.eid == 'answer'), false)
})

let attentionCase = await (async () => {
  let { g, r } = world()
  await r.ensure()
  await g.apply([
    { entity: { eid: 'a' }, doc: { title: 'A' } },
    { entity: { eid: 'b' }, doc: { title: 'B' } },
    {
      entity: { eid: 'root' },
      conversation: {},
      completed: {},
      doc: { title: 'Shared question' },
    },
    {
      entity: { eid: 'watch-a' },
      subscription: { actor: 'a', target: 'root', mode: 'watch' },
    },
    {
      entity: { eid: 'watch-b' },
      subscription: { actor: 'b', target: 'root', mode: 'watch' },
    },
    {
      entity: { eid: 'reply' },
      comment: { target: 'root' },
      doc: { body: 'New words' },
    },
  ], { now: '2000-01-01T00:00:00.000Z' })
  let inbox = (actor: string, all = false) =>
    readInbox(g, vocab, actor, { all })
  let call = (name: string, actor: string) =>
    r.call({
      entity: { eid: mint() },
      call: { to: toolEid(name), args: { item: 'reply' } },
      $actor: { by: actor },
    })
  let before = [(await inbox('a'))[0].unread, (await inbox('b'))[0].unread]
  await call('inbox_open', 'a')
  let opened = [(await inbox('a'))[0].unread, (await inbox('b'))[0].unread]
  await call('inbox_archive', 'a')
  let archived = [
    (await inbox('a')).map((t) => t.eid),
    (await inbox('b')).map((t) => t.eid),
  ]
  let [root, own] = await g.get(['root', 'watch-a'])
  let count = (await g.read('.subscription.actor=a')).length
  let prior = (own.archived as Comp | undefined)?.at
  await call('inbox_archive', 'a')
  let [again] = await g.get(['watch-a'])
  let refreshed =
    String((again.archived as Comp | undefined)?.at) >= String(prior)
  let later = new Date(Date.now() + 1000).toISOString()
  await g.apply([{
    entity: { eid: 'root' },
    resolved: {},
  }], { now: later })
  return {
    before,
    opened,
    archived,
    root,
    own,
    count,
    refreshed,
    resurfaced: (await inbox('a')).map((t) => t.eid),
  }
})()

test('archive and opening belong only to the person reading and reuse their subscription', () => {
  let c = attentionCase
  assertEquals(c.before, [true, true])
  assertEquals(c.opened, [false, true])
  assertEquals(c.archived, [[], ['root']])
  assertEquals(c.root.archived, undefined)
  assertEquals(c.root.opened, undefined)
  assertEquals(c.own.subscription, {
    actor: 'a',
    target: 'root',
    mode: 'watch',
  })
  assertEquals(c.count, 1)
  assertEquals(c.refreshed, true)
  assertEquals(c.resurfaced, ['root'])
})

let messageIds = await (async () => {
  let results = []
  for (let reference of ['mail', 'notified']) {
    let v = loadVocab([
      kernelDoc,
      docDoc,
      callDoc,
      toolDoc,
      inboxDoc,
      notifyDoc,
      mailDoc,
      ...(reference == 'notified'
        ? [{
          $defs: {
            notified: {
              component: true,
              extends: true,
              type: 'object',
              properties: { message_id: { type: 'string' } },
            },
          },
        }]
        : []),
    ], [kernelKeywords])
    let store = ram(v, { computed: executionComputed })
    await store.tx((tx) =>
      tx.patch([
        { entity: { eid: 'actor' }, email: { address: 'actor@example.com' } },
        {
          entity: { eid: 'subject' },
          task: {},
          filed: { assignee: 'actor' },
          doc: { title: 'Subject' },
          created: { at: '2000-01-01T00:00:00.000Z' },
        },
        {
          entity: { eid: 'letter' },
          mail: {
            target: 'subject',
            from: 'sender@example.com',
            to: 'actor@example.com',
            ...(reference == 'mail'
              ? { message_id: '<root@example.com>' }
              : {}),
          },
          ...(reference == 'notified'
            ? { notified: { message_id: '<root@example.com>' } }
            : {}),
          doc: { title: 'Root letter' },
          created: { at: '2000-01-01T00:00:01.000Z' },
        },
        {
          entity: { eid: 'reply' },
          mail: {
            reply_to: '<root@example.com>',
            from: 'sender@example.com',
            to: 'actor@example.com',
            message_id: '<reply@example.com>',
          },
          doc: { title: 'Reply letter' },
          created: { at: '2000-01-01T00:00:02.000Z' },
        },
      ])
    )
    let g = graph({ vocab: v, storage: store, plugins: [kernel()] })
    let r = runner(g, { tools: [...tools, ...loadTools(mailDoc, mail())] })
    await r.ensure()
    let call = (name: string, item = 'reply') =>
      r.call({
        entity: { eid: mint() },
        call: {
          to: toolEid(name),
          args: name == 'mail_show'
            ? { letter: item }
            : name == 'mail_reply'
            ? { letter: item, body: 'Thank you' }
            : { item },
        },
        $actor: { by: 'actor' },
      })
    let before = (await readInbox(g, v, 'actor')).map((t) => t.eid)
    let marks = []
    await call('inbox_open')
    marks.push(
      (await g.read('.subscription.actor=actor&*')).map((b) =>
        (b.subscription as Comp).target
      ),
    )
    await call('inbox_archive')
    let archived = (await readInbox(g, v, 'actor')).map((t) => t.eid)
    let shown = await call('mail_show')
    marks.push(
      (await g.read('.subscription.actor=actor&*')).map((b) =>
        (b.subscription as Comp).target
      ),
    )
    let rootShown = await call('mail_show', 'letter')
    await call('mail_reply')
    marks.push(
      (await g.read('.subscription.actor=actor&*')).map((b) =>
        (b.subscription as Comp).target
      ),
    )
    results.push({
      reference,
      before,
      archived,
      marks,
      shown: shown.map((b) => (b.content as Comp | undefined)?.body).filter(
        Boolean,
      ).join('\n'),
      rootShown: rootShown.map((b) => (b.content as Comp | undefined)?.body)
        .filter(Boolean).join('\n'),
      roots: await g.get(['subject', 'letter', 'reply']),
    })
  }
  return results
})()

test('inbox and mail tools follow Message-ID ancestry to the displayed thread', () => {
  for (let r of messageIds) {
    assertEquals(r.before, ['subject'], r.reference)
    assertEquals(r.archived, [], r.reference)
    assertEquals(r.marks, [['subject'], ['subject'], ['subject']], r.reference)
    assertEquals(r.shown.includes('Root letter'), true, r.reference)
    assertEquals(r.rootShown.includes('Reply letter'), true, r.reference)
    for (let root of r.roots) {
      assertEquals(root.opened, undefined)
      assertEquals(root.archived, undefined)
    }
  }
})
