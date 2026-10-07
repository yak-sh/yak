import './Entity.tsx'
import { changesOf } from '../wire.ts'
import { domainBundle } from '../domain-host.tsx'
import '../domain-host.tsx'
// Human-facing instruments use graph ids; browser clients keep their short
// handles.
import { test } from '@yaks/testing'
import '../testing.ts'
import { assertEquals } from '@std/assert'
import { cache, ent, useRoute } from '../live.ts'
import { act } from 'preact/test-utils'
import { drafts } from '@yaks/draft/input'
import { h } from 'preact'
import { derivedEid } from '@yaks/graph'
import { mount } from './mount.ts'
import { front } from './fields.tsx'
import {
  Branches,
  byline,
  commentPlace,
  Composer,
  composerBundles,
  prompt,
  viaName,
} from '@yaks/kernel/Comments'

let composerChanges = (...args: Parameters<typeof composerBundles>) =>
  changesOf(composerBundles(...args)).filter((c) => c.name != 'entity')

test('viaName names a session by its chip id, never its harness uuid', () => {
  cache.value = {
    session: {
      entity: { eid: 'session', num: 31 },
      session: { eid: 'session', id: 'raw-session-uuid' },
    },
    client: {
      entity: { eid: 'client', num: 7 },
      client: { eid: 'client', user_agent: '', ip: '' },
    },
  }
  assertEquals(viaName('session'), 'S-31')
  assertEquals(viaName('client'), 'web-7')
  assertEquals(viaName(), 'anon')
  cache.value = {}
})

test('graph-native prose is one ordered input entry', () => {
  assertEquals(composerChanges('session', 'keep going', true, 'input'), [
    { eid: 'input', name: 'entry', comp: { session: 'session' } },
    { eid: 'input', name: 'content', comp: { body: 'keep going' } },
  ])
  assertEquals(
    composerChanges('session', 'continue here', true, 'switch', {
      provider: 'openai',
      model: 'sol',
    }),
    [
      { eid: 'switch', name: 'entry', comp: { session: 'session' } },
      { eid: 'switch', name: 'content', comp: { body: 'continue here' } },
      {
        eid: 'switch',
        name: 'using',
        comp: { provider: 'openai', model: 'sol' },
      },
    ],
  )
  assertEquals(
    composerChanges('session', ':fix T-1', true, 'command').map((c) => c.name),
    ['doc', 'comment'],
  )
})

test('byline reads actor and instrument from the created stamp', () => {
  cache.value = {
    actor: {
      entity: { eid: 'actor', num: 2 },
      doc: { eid: 'actor', title: 'jeff', body: '' },
      person: { eid: 'actor' },
    },
    session: {
      entity: { eid: 'session', num: 31 },
      session: { eid: 'session', id: 'raw-session-uuid' },
    },
    comment: {
      entity: { eid: 'comment', num: 9 },
      created: { eid: 'comment', at: '', by: 'actor', via: 'session' },
      comment: { eid: 'comment', target: 'target' },
    },
  }
  assertEquals(byline(domainBundle(ent('comment'))), 'jeff · via S-31')
  cache.value = {}
})

test('composer names an unnamed session by its chip id', () => {
  cache.value = {
    session: {
      entity: { eid: 'session', num: 31 },
      session: { eid: 'session', id: 'raw-session-uuid', status: 'settled' },
    },
  }
  assertEquals(
    prompt(domainBundle(ent('session'))),
    'send to S-31… (resumes the session)',
  )
  cache.value = {}
})

test('a reply composer keeps its thread and its own draft place', () => {
  assertEquals(
    composerChanges('task', 'answer', false, 'reply', undefined, 'ask'),
    [
      { eid: 'reply', name: 'doc', comp: { title: '', body: 'answer' } },
      {
        eid: 'reply',
        name: 'comment',
        comp: { target: 'task', reply_to: 'ask' },
      },
    ],
  )
  assertEquals(commentPlace('task', false, 'ask'), 'task.reply:ask')
  assertEquals(commentPlace('task'), 'task.comment')
})

test('a thread shows answers under their question, not under unrelated notes', () => {
  cache.value = {
    task: { entity: { eid: 'task', num: 1 }, task: { eid: 'task' } },
    ask: {
      entity: { eid: 'ask', num: 2 },
      comment: { eid: 'ask', target: 'task' },
      doc: { eid: 'ask', title: '', body: 'Which one?' },
    },
    other: {
      entity: { eid: 'other', num: 3 },
      comment: { eid: 'other', target: 'task' },
      doc: { eid: 'other', title: '', body: 'Independent update' },
    },
    answer: {
      entity: { eid: 'answer', num: 4 },
      comment: { eid: 'answer', target: 'task', reply_to: 'ask' },
      doc: { eid: 'answer', title: '', body: 'First one' },
    },
  }
  let { root, free } = mount(h(Branches, {
    rows: ['answer', 'other', 'ask'].map(ent).map(domainBundle),
  }))
  try {
    let children = root.querySelector('.Notes_Children')!
    assertEquals(children.textContent!.includes('First one'), true)
    assertEquals(children.textContent!.includes('Independent update'), false)
    assertEquals(
      root.textContent!.indexOf('First one') <
        root.textContent!.indexOf('Independent update'),
      true,
    )
    root.querySelector('button')!.click()
    assertEquals(front.ent(derivedEid('commentBox|ask'))?.commentBox, {
      open: true,
    })
  } finally {
    free()
    cache.value = {}
  }
})

test('shared comment send line keeps drafts, sends by submit or Enter once and leaves Shift+Enter alone', async () => {
  let eid = 'dddddddd-3333-4333-8333-dddddddddddd'
  cache.value = {
    [eid]: {
      entity: { eid, num: 19 },
      doc: { eid, title: 'Comment target' },
      task: { eid },
    },
  }
  let sent: import('../types.ts').Change[] = []
  let restore = useRoute((frame) => {
    if (
      frame && typeof frame == 'object' && 'apply' in frame &&
      Array.isArray(frame.apply)
    ) sent.push(...frame.apply)
  })
  let seen = mount(h(Composer, { eid }))
  let input = () => seen.root.querySelector('textarea') as HTMLTextAreaElement
  let type = (words: string) => {
    input().value = words
    input().dispatchEvent(
      new (input().ownerDocument.defaultView!.Event)('input', {
        bubbles: true,
      }),
    )
  }
  try {
    assertEquals(seen.root.querySelector('form')?.contains(input()), true)
    assertEquals(seen.root.querySelector('button')?.disabled, true)
    await act(() => type('Draft kept across remount'))
    seen.free()
    seen = mount(h(Composer, { eid }))
    assertEquals(input().value, 'Draft kept across remount')
    await act(() => {
      seen.root.querySelector('form')!.dispatchEvent(
        new (input().ownerDocument.defaultView!.Event)('submit', {
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    assertEquals(
      sent.filter((c) => c.name == 'comment').length,
      1,
      JSON.stringify(sent),
    )
    assertEquals(drafts.text(commentPlace(eid)), '')
    await act(() => type('Second words'))
    let key = (shift: boolean) =>
      Object.assign(
        new (input().ownerDocument.defaultView!.Event)('keydown', {
          bubbles: true,
          cancelable: true,
        }),
        { key: 'Enter', shiftKey: shift },
      )
    let newline = key(true)
    await act(() => {
      input().dispatchEvent(newline)
    })
    assertEquals(newline.defaultPrevented, false)
    assertEquals(sent.filter((c) => c.name == 'comment').length, 1)
    await act(() => {
      input().dispatchEvent(key(false))
    })
    assertEquals(sent.filter((c) => c.name == 'comment').length, 2)
    assertEquals(input().value, '')
  } finally {
    useRoute(restore)
    seen.free()
    cache.value = {}
  }
})
