import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { WriteRefused } from '@yaks/client'
import { bindMatches } from './operator-matches-browser.ts'
import { type Matches, matchesPage, matchesRow } from './operator-matches.ts'
import { graph } from './page-graph_fixture_test.ts'
import {
  AT,
  matchesViewOf,
  page,
  SPACE,
  tapping,
} from './operator-matches_fixture_test.ts'

// A window at `at`, and the addresses it was moved to.
let windowAt = (at: string) => {
  let location = new URL(at)
  let moved: string[] = []
  let move = (_: unknown, __: string, to: string) => {
    moved.push(to)
    location.search = new URL(to, location.href).search
  }
  return {
    moved,
    win: {
      location,
      history: { pushState: move, replaceState: move },
      addEventListener: () => {},
    } as unknown as Window,
  }
}

let ROUNDS: Matches = {
  rounds: [{ round: 'covers', title: 'Covers', left: 1, of: 1 }],
}

// The page at `round` bound to a page graph holding the rounds and the
// round `covers`, each pick answered by `answer`.
let bound = (
  { round = '', answer = ok }: {
    round?: string
    answer?: (b: Bundle[]) => Promise<Bundle[]>
  } = {},
) => {
  let root = page(matchesViewOf(round), round ? tapping() : ROUNDS)
  let g = graph(answer)
  let held = (r: string, read: Matches) =>
    g.set(matchesPage(SPACE, r), [matchesRow(SPACE, r, read)])
  held('', ROUNDS)
  held('covers', tapping())
  let { win, moved } = windowAt(`${AT}${round ? `?round=${round}` : ''}`)
  bindMatches(root, g, win)
  let doc = root.ownerDocument
  // A press of the pair's button `chose`, `why` typed first.
  let pick = async (chose: string, why = '') => {
    let form = root.querySelector('form[data-pick]')!
    form.querySelector<HTMLInputElement>('[name=why]')!.value = why
    let event = new doc.defaultView!.Event('submit', {
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(event, 'submitter', {
      value: form.querySelector(`button[value=${chose}]`),
    })
    form.dispatchEvent(event)
    await new Promise((go) => setTimeout(go))
  }
  return { root, g, held, pick, moved }
}
let ok = (b: Bundle[]) => Promise.resolve(b)
let picks = (g: ReturnType<typeof bound>['g']) =>
  g.wrote.map((b) => b.map((r) => r.pickMatch))
let words = (root: HTMLElement) => root.textContent!.replace(/\s+/g, ' ').trim()

test('a pick goes through the page graph as the pair’s, and the round it answers is drawn', async () => {
  let { root, g, held, pick } = bound({
    round: 'covers',
    answer: (b) => {
      held('covers', tapping({ left: 0 }))
      return Promise.resolve(b)
    },
  })
  await pick('second', ' warmer ')
  equal(picks(g), [[{
    space: SPACE,
    round: 'covers',
    pair: 1,
    chose: 'second',
    why: 'warmer',
  }]])
  equal(root.querySelector('form[data-pick]'), null)
  equal(words(root).includes('your pick settles the rest'), true)
})

test('a pick refused is said under the pair, which stays to pick in', async () => {
  let { root, pick } = bound({
    round: 'covers',
    answer: (b) =>
      Promise.reject(
        new WriteRefused(b, {
          error: 'arguments',
          message: 'Covers has no pair 1.',
        } as never),
      ),
  })
  await pick('neither')
  let said = root.querySelector<HTMLElement>('[data-said]')!
  equal([said.hidden, said.textContent], [false, 'Covers has no pair 1.'])
  equal(
    [...root.querySelectorAll('button')].some((b) =>
      (b as HTMLButtonElement).disabled
    ),
    false,
  )
})

test('a pick made elsewhere redraws the round, and a round followed from the list is drawn at once from the rows held', () => {
  let { root, held, moved } = bound()
  held('', { rounds: [{ round: 'covers', title: 'Covers', left: 0, of: 1 }] })
  equal(words(root).includes('Covers · nothing left to pick'), true)
  root.querySelector<HTMLElement>('a[href*="round=covers"]')!.click()
  equal(moved, ['/ada/matches?round=covers'])
  equal(
    root.querySelector('form[data-pick] [name=pair]')?.getAttribute('value'),
    '1',
  )
  held('covers', tapping({ n: 2 }))
  equal(
    root.querySelector('form[data-pick] [name=pair]')?.getAttribute('value'),
    '2',
  )
})

test('until its row is in, the page stays as the server drew it', () => {
  let root = page(matchesViewOf('covers'), tapping())
  let before = root.innerHTML
  let { win } = windowAt(`${AT}?round=covers`)
  bindMatches(root, graph(ok), win)
  equal(root.innerHTML, before)
})
