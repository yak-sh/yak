// The aside in the chat's header (operator-page.ts `talkPage`): what the
// conversation is doing now, and the helpers it set going, each with its
// title, how it stands and, while it works, its step and how long it has
// taken, or once it ended, how long ago. In the right margin where the
// page is wide enough; elsewhere, a phone among them, a summary at the
// header's right end, a dot for the turn and for each helper and a "+N" past
// `DOTS`, that a press opens to the whole list. The Builder object works out
// what it holds (operator-view.ts `turnOf`, `helping`) and sends it on the
// page's socket as data; this draws it, in the Builder for the page's first
// drawing and in the browser as `_talk.js` (operator-rows.ts) for each frame,
// and says how long each has lasted, which the page keeps current. A helper
// that ended leaves the list a day later (`KEPT`); its place in the
// conversation still opens it. A helper's row (`Work`) is the one every
// place on the page draws it with: the Helpers box, the step that started
// it, the band on its own page, and the admin's list of the Operator's work.
import { type ComponentChildren as Node, h } from 'preact'
import { Card, Dot, Popover, Rows, State } from '@yaks/ui/parts'

/** What a conversation's turn is doing while it runs, and since when. */
export type Turn = { what: string; since: string }

/** How a piece of work stands. */
export type Standing = 'running' | 'waiting' | 'done' | 'failed' | 'stopped'

/** A piece of work as its row draws it: the session it is, the page it
 * opens, its title, how it stands (nothing yet for a conversation no one
 * has spoken in), its step under way, when it began, when it ended, and the
 * line its final reply opens with, what it found or did. */
export type Work = {
  session: string
  href?: string
  title: string
  standing?: Standing
  step: string
  since: string
  until?: string
  recap?: string
}

/** A helper as the aside lists it: a piece of work, which always stands
 * some way. */
export type HelperLine = Work & { standing: Standing }

/** What the aside holds: the turn under way, and the helpers. */
export type Aside = { turn: Turn | null; helpers: HelperLine[] }

/** Whether a piece of work is still at it. */
export let going = ({ standing }: { standing?: Standing }) =>
  standing == 'running' || standing == 'waiting'

let WORD: Record<Standing, [string, string?]> = {
  running: ['Running', 'active'],
  waiting: ['Waiting', 'caution'],
  done: ['Done', 'positive'],
  failed: ['Failed', 'negative'],
  stopped: ['Stopped'],
}

// How each stands as a summary's dot: its word's tone, and what is at work
// breathes.
let TONE: Record<Standing, string | string[] | undefined> = {
  running: ['pulse', 'active'],
  waiting: WORD.waiting[1],
  done: WORD.done[1],
  failed: WORD.failed[1],
  stopped: WORD.stopped[1],
}

/** How a piece of work stands, in a word, wherever it is said: on the
 * page, and to a call's voice (operator-glance.ts). */
export let word = (standing: Standing) => WORD[standing][0]

/** The turn under way, in a line: what it is doing and for how long, or that
 * nothing runs. */
export let TurnNow = ({ turn, now }: { turn: Turn | null; now: number }) =>
  h(
    Popover.Line,
    { 'data-turn': '' },
    turn
      ? [
        h(State, { mod: ['pulse', 'active'] }, turn.what.replace(/…$/, '')),
        ' · ',
        h(Popover.Time, { at: turn.since, now, lasting: true }),
      ]
      : h(State, null, 'Nothing running'),
  )

/** How a helper stands, in a word in its tone. */
export let Stands = ({ standing }: { standing: Standing }) =>
  h(State, { mod: WORD[standing][1] }, word(standing))

/** A piece of work as a row, wherever it is drawn: its title in a line,
 * linked to its page, its recap on hover, over what `about` says of it
 * first, how it stands and, while it works, its step and how long it has
 * taken, or once it ended, how long ago. The page puts a newer drawing of a
 * helper in place of each by its session (`[data-help]`). */
export let Work = (
  { work: x, about = [], now = Date.now() }: {
    work: Work
    about?: Node[]
    now?: number
  },
) =>
  h(
    Rows.Item,
    { 'data-help': x.session, 'data-going': going(x) ? '' : undefined },
    h(
      Rows.Main,
      null,
      h(
        Rows.Name,
        { mod: 'line', title: x.recap ?? x.title },
        x.href ? h('a', { href: x.href }, x.title) : x.title,
      ),
      h(
        Rows.Meta,
        null,
        [
          ...about,
          x.standing && h(Stands, { standing: x.standing }),
          x.step.replace(/…$/, ''),
          x.until && !going(x)
            ? h(Popover.Time, { at: x.until, now })
            : h(Popover.Time, { at: x.since, now, lasting: true }),
        ].filter(Boolean).flatMap((part, i) => i ? [' · ', part] : [part]),
      ),
    ),
  )

/** How many dots the summary draws before it says how many more. */
export let DOTS = 4

/**
 * The summary's dots, the turn under way first and then each helper, as
 * the `Dot` tones and shapes that say how each stands, those past `DOTS`
 * counted in `more`; and what it says to a screen reader.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { glanceOf, type HelperLine } from './operator-aside.ts'
 * let helper = (standing: HelperLine['standing']): HelperLine =>
 *   ({ session: standing, title: '', standing, step: '', since: '' })
 * equal(glanceOf({ turn: null, helpers: [] }), {
 *   dots: [], more: 0, label: 'Nothing running',
 * })
 * equal(
 *   glanceOf({
 *     turn: { what: 'Thinking…', since: '' },
 *     helpers: (['running', 'done', 'done', 'failed', 'waiting'] as const)
 *       .map(helper),
 *   }),
 *   {
 *     dots: [['pulse', 'active'], ['pulse', 'active'], 'caution', 'positive'],
 *     more: 2,
 *     label: 'Working; helpers: 1 running, 2 done, 1 failed, 1 waiting',
 *   },
 * )
 * ```
 */
export let glanceOf = ({ turn, helpers }: Aside) => {
  let dots = [
    ...turn ? [TONE.running] : [],
    ...ordered(helpers, Infinity).map((x) => TONE[x.standing]),
  ]
  let counts = new Map<Standing, number>()
  for (let x of helpers) {
    counts.set(x.standing, (counts.get(x.standing) ?? 0) + 1)
  }
  let counted = [...counts].map(([standing, n]) => `${n} ${standing}`)
  return {
    dots: dots.slice(0, DOTS),
    more: Math.max(0, dots.length - DOTS),
    label: [
      turn ? 'Working' : 'Nothing running',
      ...counted.length ? [`helpers: ${counted.join(', ')}`] : [],
    ].join('; '),
  }
}

/** The summary's button: its dots and "+N", pressed to show or hide the
 * whole list (`[data-open]` on the aside). */
export let Glance = ({ aside, open }: { aside: Aside; open: boolean }) => {
  let { dots, more, label } = glanceOf(aside)
  return h(
    Popover.Trigger,
    {
      type: 'button',
      'data-glance': '',
      'aria-expanded': open ? 'true' : 'false',
      'aria-controls': 'aside-now',
      'aria-label': label,
    },
    dots.map((mod) => h(Dot, { mod, 'aria-hidden': 'true' })),
    more ? h(Popover.Count, { 'aria-hidden': 'true' }, `+${more}`) : null,
  )
}

/** The aside: the summary, then Now, and Helpers while there are any.
 * Hidden while nothing runs and no helper was started. */
export let Aside = (
  { aside, now, open = false }: { aside: Aside; now: number; open?: boolean },
) =>
  h(
    Popover,
    {
      class: 'Talk_Aside',
      mod: 'responsive',
      'data-aside': '',
      'data-open': open ? '' : undefined,
      'aria-label': 'What is happening now',
      hidden: !aside.turn && !aside.helpers.length,
    },
    h(Glance, { aside, open }),
    h(
      Popover.Body,
      { class: 'Talk_AsideIn', id: 'aside-now' },
      h(
        Card,
        null,
        h(Card.Head, null, h(Card.Title, null, 'Now')),
        h(TurnNow, { turn: aside.turn, now }),
      ),
      h(
        Card,
        { hidden: !aside.helpers.length, 'data-helpers': '' },
        h(Card.Head, null, h(Card.Title, null, 'Helpers')),
        h(
          Rows,
          { 'data-helping': '' },
          aside.helpers.map((helper) => h(Work, { work: helper, now })),
        ),
      ),
    ),
  )

/** How long a helper stays listed once it ended, in milliseconds. */
export let KEPT = 86_400_000

/**
 * The helpers to list: those at work first, then the newest, without those
 * that ended more than `KEPT` before `now`; at most `most`.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { ordered, type HelperLine } from './operator-aside.ts'
 * let now = Date.parse('2026-11-13T12:00:00Z')
 * let helper = (session: string, standing: HelperLine['standing'], since: string, until?: string): HelperLine =>
 *   ({ session, title: '', standing, step: '', since, ...until ? { until } : {} })
 * equal(ordered([
 *   helper('old', 'done', '2026-11-10T09:00:00Z', '2026-11-10T09:01:00Z'),
 *   helper('new', 'done', '2026-11-13T09:00:00Z', '2026-11-13T09:01:00Z'),
 *   helper('long', 'running', '2026-11-09T09:00:00Z'),
 * ], 8, now).map((h) => h.session), ['long', 'new'])
 * ```
 */
export let ordered = (helpers: HelperLine[], most = 8, now = Date.now()) =>
  helpers.filter((x) =>
    going(x) || !x.until || !(now - Date.parse(x.until) >= KEPT)
  ).toSorted((a, b) =>
    Number(going(b)) - Number(going(a)) || b.since.localeCompare(a.since)
  ).slice(0, most)
