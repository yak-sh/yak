import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { WriteRefused } from '@yaks/client'
import { graph } from './page-graph_fixture_test.ts'
import { bindPeople } from './people-browser.ts'
import {
  byLine,
  DIARY,
  holder,
  page,
  roster,
  SPACE,
  watched,
} from './people_fixture_test.ts'
import { holderRows, holders } from './people-rows.ts'

let names = (root: Element) =>
  [...root.querySelectorAll('.Rows_Name')].map((n) => n.textContent)

// The page bound to a graph holding `rows`, its writes answered by `answer`.
let bound = (
  rows = watched(),
  answer = (b: Bundle[]) => Promise.resolve(b),
) => {
  let at = page(rows)
  let g = graph(answer)
  for (let [line, held] of byLine(rows)) g.set(line, held)
  bindPeople(at.root, g)
  return { ...at, g }
}

let flush = () => new Promise((r) => setTimeout(r, 0))

let press = (at: ReturnType<typeof bound>, form: HTMLFormElement) => {
  form.dispatchEvent(
    new at.window.Event('submit', { bubbles: true, cancelable: true }),
  )
  return flush()
}

let said = (form: Element) => {
  let s = form.querySelector<HTMLElement>('[data-said]')!
  return [s.textContent, s.hidden]
}

test('the People page draws its rows again as they move', () => {
  let at = bound(watched({ holders: roster(holder('cy', 'viewer', 'invite')) }))
  equal(names(at.root), ['ada', 'cy'])
  at.g.set(
    holders(SPACE.eid),
    holderRows('person-ada', SPACE.eid, roster(holder('cy', 'viewer'))),
  )
  equal(names(at.root), ['ada', 'cy'])
  equal(at.root.textContent!.includes('not accepted yet'), false)
  at.g.set(holders(SPACE.eid), holderRows('person-ada', SPACE.eid, roster()))
  equal(names(at.root), ['ada'])
})

test('until its rows are in, the People page stays as the server drew it', () => {
  let { root } = page()
  let before = root.innerHTML
  bindPeople(root, graph((b) => Promise.resolve(b)))
  equal(root.innerHTML, before)
})

test('an invitation is written through the page graph, and its form says what came of it', async () => {
  let at = bound(watched(), (b) =>
    Promise.resolve(
      b.map((x) => ({
        ...x,
        memberAdd: { ...x.memberAdd as object, said: 'Invitation sent.' },
      })),
    ))
  let form = at.root.querySelector<HTMLFormElement>('[data-people=memberAdd]')!
  let email = form.querySelector<HTMLInputElement>('[name=invite]')!
  email.value = ' bo@example.com '
  for (let o of form.querySelectorAll('[name=app] option')) {
    o.toggleAttribute('selected', o.getAttribute('value') == DIARY.slug)
  }
  await press(at, form)
  equal(at.g.wrote.map((b) => b[0].memberAdd), [{
    space: SPACE.eid,
    email: 'bo@example.com',
    app: DIARY.slug,
    role: 'editor',
  }])
  equal(said(form), ['Invitation sent.', false])
  equal(email.value, '')
  // A redraw as the invitation comes in keeps what the form said.
  at.g.set(
    holders(SPACE.eid),
    holderRows(
      'person-ada',
      SPACE.eid,
      roster(holder('bo', 'editor', 'invite', DIARY.eid)),
    ),
  )
  equal(names(at.root), ['ada', 'bo'])
  equal(said(form), ['Invitation sent.', false])
})

test('a refused invitation says why, and keeps what was typed', async () => {
  let at = bound(watched(), () =>
    Promise.reject(
      new WriteRefused([], {
        error: 'arguments',
        message: 'That address cannot be invited.',
      }),
    ))
  let form = at.root.querySelector<HTMLFormElement>('[data-people=memberAdd]')!
  let email = form.querySelector<HTMLInputElement>('[name=invite]')!
  email.value = 'nobody@example'
  await press(at, form)
  equal(email.value, 'nobody@example')
  equal(said(form), ['That address cannot be invited.', false])
})

test('each row button writes its act, naming the row', async () => {
  let at = bound(watched({
    holders: roster(
      holder('cy', 'viewer', 'invite'),
      holder('ann', 'editor', 'grant', DIARY.eid),
    ),
    spaces: [
      { ...SPACE, title: 'Gift shop' },
      { eid: 'space-farm', slug: 'farm', title: 'Farm' },
    ],
    admitted: [{
      operator: 'space-bake',
      slug: 'bake',
      title: 'Bake',
      role: 'editor',
    }],
  }))
  for (
    let act of [
      'inviteAgain',
      'memberRemove',
      'operatorAdmit',
      'operatorOut',
    ]
  ) {
    for (
      let form of at.root.querySelectorAll<HTMLFormElement>(
        `[data-people=${act}]`,
      )
    ) await press(at, form)
  }
  equal(
    at.g.wrote.map(([b]) => Object.entries(b).find(([k]) => k != 'entity')),
    [
      ['inviteAgain', {
        space: SPACE.eid,
        invite: holder('cy', 'viewer', 'invite').place,
      }],
      ['memberRemove', { space: SPACE.eid, email: 'cy@example.com' }],
      ['memberRemove', {
        space: SPACE.eid,
        email: 'ann@example.com',
        app: DIARY.slug,
      }],
      ['operatorAdmit', {
        space: SPACE.eid,
        operator: 'space-farm',
        role: 'editor',
      }],
      ['operatorOut', { space: SPACE.eid, operator: 'space-bake' }],
    ],
  )
})
