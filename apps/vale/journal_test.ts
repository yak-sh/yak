// The quest list reveals completions on request and keeps selection in its graph.
import { equal, ok, test } from '@yaks/testing'
import { type Task } from './journal.ts'
import { withJournal } from './journal_fixture.ts'

let task = (
  id: string,
  state: Task['state'] = 'taken',
  pinned = false,
): Task => ({
  id,
  title: `${id} & its reward`,
  giver: 'someone',
  from: 'Someone',
  level: 'mossvale',
  gives: '10 xp',
  says: 'Bring it back.',
  state,
  pinned,
  steps: [{
    text: 'Gather things',
    have: 1,
    need: 3,
    done: state == 'done',
    level: 'mossvale',
  }],
})

test('quest selection and tracking preserve list nodes, scroll and quest meaning', () =>
  withJournal(({ body, view, pins, click }) => {
    let quest = task('errand', 'taken', true)
    view.show([quest], 'mossvale')
    let list = body.querySelector<HTMLElement>('.Split_List')!
    let row = list.querySelector('[data-select]')!
    equal(row.querySelector('.Tile_Title')!.textContent, quest.title)
    ok(row.querySelector('.Tile_Icon .Glyph'))
    equal(row.querySelector('.Tile_End')!.getAttribute('aria-label'), 'Tracked')
    equal(
      row.querySelector('.Tile_Sub')!.textContent,
      'Gather things · 1 / 3',
    )
    list.scrollTop = 37
    click('[data-select]')
    equal(list.querySelector('[data-select]'), row)
    equal(list.scrollTop, 37)
    equal(row.getAttribute('aria-current'), 'true')
    click('[data-pin]')
    equal(pins, [[quest.id, false]])
    view.show([{ ...quest, pinned: false }], 'mossvale')
    equal(
      body.querySelector('[data-pin]')!.getAttribute('aria-pressed'),
      'false',
    )
    equal(list.querySelector('[data-select]'), row)
    equal(list.scrollTop, 37)
    equal(body.querySelector('.Journal_Says')!.textContent, quest.says)
  }))

for (let pinned of [false, true]) {
  test(`Completed quests start hidden, including pinned=${pinned}`, () =>
    withJournal(({ body, view, click }) => {
      let quests = [
        task('active'),
        task('offer', 'open'),
        task('finished', 'done', pinned),
        task('locked', 'locked'),
      ]
      let rows = () =>
        [...body.querySelectorAll('[data-select]')].map((row) =>
          row.getAttribute('data-select')
        )
      view.show(quests, 'mossvale')
      equal(rows(), ['active', 'offer'])
      equal(
        body.querySelector('[data-completed]')!.textContent,
        'Completed · 1',
      )
      equal(
        body.querySelector('[data-completed]')!.getAttribute('aria-expanded'),
        'false',
      )
      click('[data-completed]')
      equal(rows(), ['active', 'offer', 'finished'])
      equal(
        body.querySelector('[data-completed]')!.getAttribute('aria-expanded'),
        'true',
      )
      click('[data-select=finished]')
      equal(body.querySelector('.Journal_Title')!.textContent, quests[2].title)
      equal(body.querySelector('[data-pin]'), null)
      click('[data-completed]')
      equal(rows(), ['active', 'offer'])
      equal(body.querySelector('.Journal_Title'), null)
      view.show(quests, 'mossvale')
      equal(rows(), ['active', 'offer'])
    }))
}
