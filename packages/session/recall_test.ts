// A comment the host's person wrote reaches the session it is owed to with
// what they said before on its subject; anyone else's comment arrives alone.

import { graph } from '@yaks/graph'
import { kernelDoc } from '@yaks/kernel/vocab'
import { provenanceDoc } from '@yaks/provenance'
import { docDoc } from '@yaks/doc'
import { mailDoc } from '@yaks/mail/vocab'
import { notifyDoc } from '@yaks/notify/vocab'
import { ram } from '@yaks/ram'
import { toolsDoc } from '@yaks/tools/vocab'
import { loadVocab } from '@yaks/vocab'
import { equal, test } from '@yaks/testing'
import { feed, heard, input } from './bus.ts'
import { sessionDoc } from './comp.ts'
import { sessions } from './plugin.ts'
import { recall } from './recall.ts'
import { statusComputed } from './status.ts'

let vocab = loadVocab([
  kernelDoc,
  provenanceDoc,
  docDoc,
  mailDoc,
  notifyDoc,
  sessionDoc,
  toolsDoc,
])
let comment = (eid: string, target: string, by: string, body: string) => ({
  entity: { eid },
  comment: { target },
  doc: { body },
  created: { by, at: '2026-02-01T00:00:00Z' },
})
let seen = async () => {
  let g = graph({
    vocab,
    storage: ram(vocab, { computed: statusComputed }),
    plugins: [sessions()],
  })
  await g.apply([
    { entity: { eid: 'ada' }, doc: { title: 'Ada' } },
    { entity: { eid: 'bob' }, doc: { title: 'Bob' } },
    { entity: { eid: 'native' }, session: { id: 'native' } },
    { entity: { eid: 'outside' }, session: { id: 'outside' } },
    {
      entity: { eid: 'start' },
      entry: { session: 'native' },
      content: { body: 'start' },
      using: {},
    },
    {
      entity: { eid: 'old' },
      entry: { session: 'outside' },
      content: { body: 'keep attachments immutable' },
      created: { by: 'ada', at: '2026-01-01T00:00:00Z' },
    },
    { entity: { eid: 'page' }, claim: { session: 'native' } },
    { entity: { eid: 'sheet' }, claim: { session: 'outside' } },
    comment('hers', 'page', 'ada', 'are attachment files still immutable?'),
    comment('other', 'page', 'bob', 'are attachment files still immutable?'),
    comment('again', 'sheet', 'ada', 'and the attachment files here?'),
  ], { trusted: true })
  let asked: string[] = []
  let host = {
    graph: g,
    config: { person: 'ada' },
    meaning: (words: string) => {
      asked.push(words)
      return Promise.resolve([{ entity: 'old', similarity: .9, excerpt: '' }])
    },
  }
  await feed(g, undefined, recall(host).beside)
  let body = async (item: string) => {
    let [said] = await g.get([input('native', item, '').entity.eid])
    return String((said?.content as { body?: string })?.body ?? '')
  }
  let hook = await heard(host, { session_id: 'outside' }) as {
    hookSpecificOutput?: { additionalContext: string }
  }
  return {
    hers: await body('hers'),
    other: await body('other'),
    hook: hook.hookSpecificOutput?.additionalContext ?? '',
    asked,
  }
}
let saw = await seen()
let EARLIER = '· 2026-01-01 · "keep attachments immutable"'

test("a native session's input carries what the person said before under their comment", () => {
  equal(saw.hers.includes('are attachment files still immutable?'), true)
  equal(saw.hers.includes(EARLIER), true)
})
test("another writer's comment arrives without the person's history", () => {
  equal(saw.other.includes('are attachment files still immutable?'), true)
  equal(saw.other.includes('Earlier words'), false)
})
test('the hook door sets it under a comment owed to an outside session', () => {
  equal(saw.hook.includes('and the attachment files here?'), true)
  equal(saw.hook.includes(EARLIER), true)
})
test('the recall is asked with the comment as it was written', () => {
  equal(saw.asked.includes('are attachment files still immutable?'), true)
})
