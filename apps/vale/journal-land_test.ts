// Land membership, bounded local suggestions and journal ordering share the
// same task rows the tracker and journal render.
import { equal, ok, test } from '@yaks/testing'
import { withJournal } from './journal_fixture.ts'
import { GIVERS, QUESTS } from './quests.ts'
import { landsOf, quest, type Task, tracked } from './journal.ts'

let task = (
  id: string,
  level: string,
  state: Task['state'] = 'taken',
  have = 0,
  pinned = false,
): Task => ({
  id,
  level,
  state,
  pinned,
  title: id,
  giver: 'wren',
  from: 'Wren',
  gives: '',
  says: '',
  steps: [{ text: 'Gather', level, have, need: 10, done: have >= 10 }],
})

test('every authored quest has its work land, including cross-land asks', () => {
  for (let q of QUESTS) {
    ok(q.level)
    equal(
      quest({ quest: q, state: 'open', have: 0, pinned: false }).level,
      q.level,
    )
  }
  let away = QUESTS.find((q) =>
    q.level != GIVERS.find((g) => g.id == q.giver)?.level
  )!
  ok(away)
  let offered = quest({ quest: away, state: 'open', have: 0, pinned: false })
  equal(offered.level, away.level)
  equal(offered.steps[0].level, GIVERS.find((g) => g.id == away.giver)!.level)
})

test('the quest card follows three quests at most: pins first, then the local work nearest done', () => {
  let work = [
    task('offer', 'mossvale', 'open'),
    task('low', 'mossvale', 'taken', 1),
    task('high', 'mossvale', 'taken', 9),
    task('ready', 'mossvale', 'taken', 10),
    task('middle', 'mossvale', 'taken', 5),
    task('away', 'birchmere', 'taken', 10),
    task('done', 'mossvale', 'done', 10),
    task('locked', 'mossvale', 'locked'),
  ]
  let pins = [
    ...['a', 'b'].map((id) => task(id, 'birchmere', 'taken', 0, true)),
    task('here', 'mossvale', 'taken', 0, true),
  ]
  let ids = (rows: Task[], here = 'mossvale') =>
    tracked(rows, here).map((t) => t.id)
  equal(ids(work), ['ready', 'high', 'middle'])
  equal(ids([work[0], work[1]]), ['low', 'offer'])
  equal(ids([...work, pins[0]]), ['a', 'ready', 'high'])
  equal(ids([...work, ...pins]), ['here', 'a', 'b'])
  equal(ids([...work, ...pins], 'reedmarsh'), ['a', 'b', 'here'])
  equal(ids([work[6], work[7]]), [])
})

test('journal groups lands current first and keeps each lifecycle section', () => {
  let rows = [
    task('away', 'birchmere'),
    task('local-offer', 'mossvale', 'open'),
    task('local-done', 'mossvale', 'done', 10),
    task('local', 'mossvale'),
    task('local-pinned-offer', 'mossvale', 'open', 0, true),
    task('hidden', 'mossvale', 'locked'),
  ]
  let groups = landsOf(rows, 'mossvale')
  equal(groups.map((g) => g.level), ['mossvale', 'birchmere'])
  equal(groups[0].taken.map((t) => t.id), ['local-pinned-offer', 'local'])
  equal(groups[0].open.map((t) => t.id), ['local-offer'])
  equal(groups[0].done.map((t) => t.id), ['local-done'])
  equal(groups[1].taken.map((t) => t.id), ['away'])
  equal(landsOf(rows, 'birchmere').map((g) => g.level), [
    'birchmere',
    'mossvale',
  ])
  equal(landsOf([], 'mossvale'), [])
})

test('journal renders land headings with local work before remote work', () =>
  withJournal(({ body, view, click }) => {
    let rows = [
      task('away', 'birchmere'),
      task('local', 'mossvale'),
      task('offer', 'mossvale', 'open'),
      task('done', 'mossvale', 'done', 10),
    ]
    view.show(rows, 'mossvale')
    let shown = () =>
      [...body.querySelectorAll('[data-select]')].map((node) =>
        node.getAttribute('data-select')
      )
    equal(shown(), ['local', 'offer', 'away'])
    equal(
      body.querySelector('.Journal_Land .Section_Note')!.textContent,
      'Here',
    )
    click('[data-completed=mossvale]')
    equal(shown(), ['local', 'offer', 'done', 'away'])
    view.show(
      [task('away', 'birchmere'), task('local', 'mossvale')],
      'birchmere',
    )
    equal(shown(), ['away', 'local'])
  }))
