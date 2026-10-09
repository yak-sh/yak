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
import { attention, type Row, threads } from './mod.ts'
import { candidates, discussion, words } from './queries.ts'
import { runs } from './tools.ts'
import { inboxDoc } from './vocab.ts'

let tools = loadTools(inboxDoc, runs())
let row = (b: Bundle): Row => ({ eid: b.entity.eid, comps: b as Row['comps'] })
let vocab = loadVocab([kernelDoc, docDoc, callDoc, toolDoc, inboxDoc], [
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
  return { g, create }
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
  let made = await create(String(args.text), 'caller')
  let stored = (await g.get([made.entity.eid]))[0]
  assertEquals(stored.conversation, {})
  assertEquals(stored.doc, { title: '  Plan the work', body: text })
  assertEquals((stored.created as Comp).by, 'caller')
  let other = await create('Agent words', 'agent')
  assertEquals(
    ((await g.get([other.entity.eid]))[0].created as Comp).by,
    'agent',
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
  let made = await create('Question\nOriginal words', 'caller')
  let eid = made.entity.eid
  let who = { actor: 'caller' }
  let inbox = async () => {
    let first = (await g.read(candidates(who, words(g.vocab)))).map(row)
    let rest = (await g.read(discussion(first, words(g.vocab)))).map(row)
    return threads([...first, ...rest], who)
  }
  let thread = (await inbox()).find((t) => t.eid == eid)!
  assertEquals(thread.row.comps.conversation, {})
  assertEquals(thread.row.comps.doc?.body, 'Question\nOriginal words')
  assertEquals(thread.lane, 'Recent')
  await g.apply(attention(eid, 'archived'), { now: '2100-01-01T00:00:00.000Z' })
  assertEquals((await inbox()).some((t) => t.eid == eid), false)
  await g.apply([{
    entity: { eid: 'answer' },
    comment: { target: eid },
    doc: { body: 'An answer' },
    $actor: { by: 'agent' },
  }], { now: '2100-01-01T00:00:01.000Z' })
  await g.apply([{
    entity: { eid: 'followup' },
    comment: { target: eid, reply_to: 'answer' },
    doc: { body: 'Follow up' },
    $actor: { by: 'caller' },
  }], { now: '2100-01-01T00:00:02.000Z' })
  thread = (await inbox()).find((t) => t.eid == eid)!
  assertEquals(thread.lane, 'Replies')
  assertEquals(thread.messages.map((r) => r.eid), ['answer', 'followup'])
  assertEquals(thread.row.comps.doc?.body, 'Question\nOriginal words')
  assertEquals((await inbox()).some((t) => t.eid == 'answer'), false)
})
