// The Operator's notifications as the push host draws them: a title saying
// what happened, the row's own words, its tag, and buttons for an OK.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { createElement as h } from 'react'
import { noticeOf } from '@yaks/push/notice'
import { resolve } from '@yaks/render'
import { loadVocab } from '@yaks/vocab'
import { pushViews, type Telling } from './operator-push.tsx'

let vocab = loadVocab({
  $defs: Object.fromEntries(
    [
      'notification',
      'reply',
      'doc',
      'decision',
      'operator_approval',
      'approval_ask',
    ].map((name) => [name, { component: true, properties: {} }]),
  ),
})
let ctx: Telling = {
  operator: 'Elihu',
  open: '/ana',
  icon: '/logo.png',
  badge: '/badge.png',
  answer: '/ana/updates',
}
let drawn = (e: Omit<Bundle, 'entity'>) => {
  let row = { entity: { eid: 'r1' }, ...e } as Bundle
  let view = resolve(pushViews, row, 'Push', vocab)!
  let { title, body, actions } = noticeOf(h(view.Render, { e: row, ctx }))!
  return { title, body, ...actions ? { actions } : {} }
}
let shown = { tag: 'r1', url: '/ana', icon: '/logo.png', badge: '/badge.png' }

test('a reply shows its own words, not the words it answers', () => {
  assertEquals(
    drawn({
      notification: { to: 'ana' },
      reply: { to: 'w1' },
      doc: {
        title: 'Reply to “can it print?”',
        body: 'Yes: [it prints](https://x.example) now.',
      },
    }),
    { title: 'Elihu replied', body: 'Yes: it prints now.' },
  )
})

test('a notice says its subject over its words', () => {
  let doc = { title: 'Recipes: fixed', body: 'It prints again.' }
  assertEquals(drawn({ notification: { to: 'ana' }, doc }), {
    title: 'Recipes: fixed',
    body: 'It prints again.',
  })
  assertEquals(
    drawn({ notification: { to: 'ana' }, doc: { body: 'Done.' } }).title,
    'Elihu sent a note',
  )
})

test('a question is asked, and an OK is answered by its buttons', () => {
  let decision = {
    question: 'Email bo@x.com?',
    choices: [{ label: 'Approve' }, { label: 'Decline' }],
  }
  assertEquals(drawn({ decision }), {
    title: 'Elihu asked',
    body: 'Email bo@x.com?',
  })
  assertEquals(drawn({ decision, operator_approval: {} }), {
    title: 'Elihu needs your OK',
    body: 'Email bo@x.com?',
    actions: ['Approve', 'Decline'].map((choice) => ({
      action: choice,
      title: choice,
      post: '/ana/updates',
      form: { choose: 'r1', choice },
    })),
  })
})

test('a notification is tagged by its row, opens where it is told, and wears the space’s icon', () => {
  let row = { entity: { eid: 'r1' }, decision: { question: 'Go?' } }
  let view = resolve(pushViews, row, 'Push', vocab)!
  let { title: _, body: __, ...rest } = noticeOf(
    h(view.Render, { e: row, ctx }),
  )!
  assertEquals(rest, shown)
})
