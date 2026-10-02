import { test } from '@yaks/testing'
import '../testing.ts'
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { install } from '@yaks/tui'
import { Ux } from '@yaks/ux'
import { cache, config, owner, rows } from '../live.ts'
import { commentPlace, Composer } from '../components/Comments.tsx'
import { drafts } from '../components/drafts.ts'
import { App, spot, spots, terminal, trail } from './App.tsx'
import { click, control, field } from './forms.ts'
import { pane } from './paint.ts'

test('terminal forms resume a shared reply draft, keep it on close and send its reply target', async () => {
  let { root, free } = install()
  let target = root as unknown as Parameters<typeof render>[1]
  let eid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  let reply = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  let place = commentPlace(eid, false, reply)
  let prior = config.host
  config.host = ''
  cache.value = {
    [eid]: {
      entity: { eid, num: 1 },
      task: { eid },
      doc: { eid, title: 'Thread', body: '' },
    },
  }
  drafts.type(place, 'Keep these words')
  try {
    await act(() =>
      render(
        h(
          Ux,
          { host: terminal },
          h(
            'div',
            {},
            h(Composer, { eid, replyTo: reply }),
            h('footer', {}, 'status'),
          ),
        ),
        target,
      )
    )
    let lines = () =>
      pane(root).lines.map((line) => line.map((s) => s.text).join(''))
    let box = control(
      root,
      lines().findIndex((line) => line.includes('Keep these words')),
    )!
    assertEquals(box.localName, 'textarea')
    let edit = field(box)
    edit.key('!')
    edit.close()
    assertEquals(drafts.text(place), 'Keep these words!')
    edit = field(box)
    edit.key('\n')
    for (let c of 'More') edit.key(c)
    await act(() => edit.key('\r'))
    edit.close()
    let posted = rows().find((r) => r.comps.comment)?.comps
    assertEquals(posted?.comment?.target, eid)
    assertEquals(posted?.comment?.reply_to, reply)
    assertEquals(posted?.doc?.body, 'Keep these words!\nMore')
    assertEquals(drafts.text(place), '')
  } finally {
    render(null, target)
    free()
    config.host = prior
    cache.value = {}
  }
})

test('terminal home paints the inbox and its line controls can be activated', async () => {
  let { root, free } = install()
  let target = root as unknown as Parameters<typeof render>[1]
  owner.value = 'person'
  trail.value = []
  spots.value = {}
  cache.value = {
    person: {
      entity: { eid: 'person', num: 1 },
      person: { eid: 'person' },
      doc: { eid: 'person', title: 'Owner' },
    },
  }
  try {
    await act(() => render(h(Ux, { host: terminal }, h(App, {})), target))
    let lines = pane(root).lines.map((line) => line.map((s) => s.text).join(''))
    assertEquals(spot(), 0)
    for (let lane of ['Needs you', 'Replies', 'Updates', 'Recent']) {
      assertEquals(lines.some((line) => line.includes(lane)), true)
    }
    let at = lines.findIndex((line) => line.includes('Include archived'))
    await act(() => {
      click(control(root, at)!)
    })
    assertEquals(
      pane(root).lines.some((line) =>
        line.some((s) => s.text.includes('Hide archived'))
      ),
      true,
    )
  } finally {
    render(null, target)
    free()
    owner.value = undefined
    cache.value = {}
  }
})
