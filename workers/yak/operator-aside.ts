// What the chat is doing now (operator-page.ts `talkPage`), at the top of the
// pane at the page's right (frame.ts `Aside`): what the conversation is
// doing, and the helpers it set going, each with its title, how it stands
// and, while it works, its step and how long it has taken, or once it ended,
// how long ago. Where the pane is not in sight (put away, or a phone), the
// bar's button to it wears a summary (`Glance`), a dot for the turn and for
// each helper and a "+N" past `DOTS`. The Builder object works out
// what it holds (operator-view.ts `turnOf`, `helping`) and sends it on the
// page's socket as data; this draws it, in the Builder for the page's first
// drawing and in the browser as `_talk.js` (operator-rows.ts) for each frame,
// and says how long each has lasted, which the page keeps current. A helper
// that ended leaves the list a day later (`KEPT`); its place in the
// conversation still opens it. A helper's row (`Work`) is the one every
// place on the page draws it with: the Helpers box, the step that started
// it, the aside on its own page, and the admin's list of the Operator's work.
import { type ComponentChildren as Node, h } from 'preact'
import { Card, Dot, More, Popover, Rows, State } from '@yaks/ui/parts'
import type { Doing } from './mascot.ts'

/** What a conversation's turn is doing while it runs, and since when. */
export type Turn = { what: string; since: string }

/** How a piece of work stands. */
export type Standing = 'running' | 'waiting' | 'done' | 'failed' | 'stopped'

/** A piece of work as its row draws it: the session it is, the page it
 * opens, its title, how it stands (nothing yet for a conversation no one
 * has spoken in), its step under way, when it began, when it ended, the
 * line its final reply opens with, what it found or did, and for a helper,
 * where it runs (yaks.app, or a machine by its name) and its model. */
export type Work = {
  session: string
  href?: string
  title: string
  standing?: Standing
  step: string
  since: string
  until?: string
  recap?: string
  runs?: string
  model?: string
}

/** A helper as the aside lists it: a piece of work, which always stands
 * some way. */
export type HelperLine = Work & { standing: Standing }

/** What the aside holds: the turn under way, and the helpers. On a helper's
 * own page it holds the helper itself (`self`) in the turn's place, which
 * says how it stands, once. */
export type Aside = {
  turn: Turn | null
  helpers: HelperLine[]
  self?: HelperLine
}

/** Whether a piece of work is still at it. */
export let going = ({ standing }: { standing?: Standing }) =>
  standing == 'running' || standing == 'waiting'

/** How long a turn runs before its work counts as long. */
export let LONG = 20_000

/**
 * Whether the conversation is at work that will take a while, `now`: a
 * helper running, or its turn going for `LONG` or more. That is when the
 * page offers an alert for when it is done (operator-page.ts
 * `alertsOffer`).
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { long } from './operator-aside.ts'
 * let now = Date.parse('2026-11-20T09:00:30Z')
 * let turn = (since: string) => ({ what: 'Thinking…', since })
 * let helper = { session: 's', title: '', step: '', since: '' }
 * equal(long({ turn: null, helpers: [] }, now), false)
 * equal(long({ turn: turn('2026-11-20T09:00:20Z'), helpers: [] }, now), false)
 * equal(long({ turn: turn('2026-11-20T09:00:00Z'), helpers: [] }, now), true)
 * equal(long({ turn: null, helpers: [{ ...helper, standing: 'running' }] }, now), true)
 * equal(long({ turn: null, helpers: [{ ...helper, standing: 'done' }] }, now), false)
 * ```
 */
export let long = (aside: Aside, now: number) =>
  aside.helpers.some((x) => x.standing == 'running') ||
  !!aside.turn && now - Date.parse(aside.turn.since) >= LONG

// What a conversation is doing while it works, each a loop the yak plays
// over and over (mascot.ts `MOVES`).
let AT_WORK: Doing[] = ['thinking', 'tool', 'writing']

/**
 * What the yak beside the box shows, for what the conversation is `doing`
 * and its helpers (mascot.ts `MOVES`). While the conversation works, that.
 * Once it rests, he shows its helpers: at work while any of them runs, as
 * when the conversation uses a tool, and thinking while they only wait to
 * run. He is one yak for however many there are; the summary's dots count
 * them. With none of them going, how the conversation ended.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { showing, type HelperLine } from './operator-aside.ts'
 * let helpers = (...standings: HelperLine['standing'][]): HelperLine[] =>
 *   standings.map((standing) =>
 *     ({ session: standing, title: '', standing, step: '', since: '' }))
 * equal(showing('writing', helpers('running')), 'writing')
 * equal(showing('idle', helpers('done', 'running', 'waiting')), 'tool')
 * equal(showing('done', helpers('running')), 'tool')
 * equal(showing('idle', helpers('waiting', 'failed')), 'thinking')
 * equal(showing('done', helpers('done', 'failed', 'stopped')), 'done')
 * equal(showing('idle', []), 'idle')
 * ```
 */
export let showing = (doing: Doing, helpers: HelperLine[]): Doing =>
  AT_WORK.includes(doing)
    ? doing
    : helpers.some((x) => x.standing == 'running')
    ? 'tool'
    : helpers.some(going)
    ? 'thinking'
    : doing

let WORD: Record<Standing, [string, (string | string[])?]> = {
  running: ['Running', ['pulse', 'active']],
  waiting: ['Waiting', 'caution'],
  done: ['Done', 'positive'],
  failed: ['Failed', 'negative'],
  stopped: ['Stopped'],
}

// How each stands beside its title: a pip whose shape says it.
let MARK: Record<Standing, string[]> = {
  running: ['pulse', 'active'],
  waiting: ['ring', 'caution'],
  done: ['check', 'positive'],
  failed: ['cross', 'negative'],
  stopped: ['dashed'],
}

// How each stands as a summary's dot: its word's tone, what is at work
// breathing.
let TONE = (standing: Standing) => WORD[standing][1]

/** How a piece of work stands, in a word, wherever it is said: on the
 * page, and to a call's voice (operator-glance.ts). */
export let word = (standing: Standing) => WORD[standing][0]

/** How a piece of work stands as a pip beside its title, whose shape says
 * it, and its word to a screen reader. */
export let Mark = ({ standing }: { standing: Standing }) =>
  h(Dot, { mod: MARK[standing], role: 'img', 'aria-label': word(standing) })

/** The turn under way, in a line: what it is doing and for how long, and
 * hidden while nothing runs. */
export let TurnNow = ({ turn, now }: { turn: Turn | null; now: number }) =>
  h(
    Popover.Line,
    { 'data-turn': '', hidden: !turn },
    turn && [
      h(State, { mod: TONE('running') }, turn.what.replace(/…$/, '')),
      ' · ',
      h(Popover.Time, { at: turn.since, now, lasting: true }),
    ],
  )

/** A piece of work as a row, wherever it is drawn: a pip saying how it
 * stands (its word for a screen reader) beside its title in a line, the row
 * opening its page, over what `about` says of it first and, while it works,
 * its step and how long it has taken, or once it ended, how long ago; then what it came to (its recap), where it runs and
 * its model, in lines, or with `fold` (the Helpers box) under a `More`
 * fold, closed unless `open`. The page puts a newer drawing of a helper in
 * place of each by its session (`[data-help]`). */
export let Work = (
  { work: x, about = [], now = Date.now(), fold = false, open = false }: {
    work: Work
    about?: Node[]
    now?: number
    fold?: boolean
    open?: boolean
  },
) => {
  let recap = x.recap && !going(x)
    ? h(Rows.Meta, { 'data-recap': '' }, x.recap)
    : null
  let runs = x.runs || x.model
    ? h(
      Rows.Meta,
      { mod: 'line', 'data-runs': '' },
      [x.runs, x.model].filter(Boolean).join(' · '),
    )
    : null
  let more = recap || runs ? [recap, runs] : null
  let title = [x.standing && h(Mark, { standing: x.standing }), ' ', x.title]
  return h(
    Rows.Item,
    { 'data-help': x.session, 'data-going': going(x) ? '' : undefined },
    h(
      Rows.Link,
      x.href ? { as: 'a', href: x.href } : null,
      h(Rows.Name, { mod: 'line', title: x.title }, title),
      h(
        Rows.Meta,
        null,
        [
          ...about,
          going(x) && x.step.replace(/…$/, ''),
          x.until && !going(x)
            ? h(Popover.Time, { at: x.until, now })
            : h(Popover.Time, { at: x.since, now, lasting: true }),
        ].filter(Boolean).flatMap((part, i) => i ? [' · ', part] : [part]),
      ),
    ),
    more && fold
      ? h(
        More,
        { mod: 'quiet', open, 'data-fold': '' },
        h(More.Summary, null, 'More'),
        h(More.Body, null, more),
      )
      : more,
  )
}

/** A helper as its conversation shows it, under the newest reply of the
 * turn that started it: its row on a card of its own, so it reads at a
 * glance on a phone, breathing while it works and, once it ended, saying
 * what it came to. The same drawing is the web page's and the iOS app's
 * (operator-draw.ts `helperRow`). */
export let Helping = ({ work, now }: { work: HelperLine; now?: number }) =>
  h(Card, null, h(Rows, null, h(Work, { work, now })))

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
export let glanceOf = ({ turn, helpers, self }: Aside) => {
  let dots = [
    ...turn ? [TONE('running')] : [],
    ...self ? [TONE(self.standing)] : [],
    ...ordered(helpers, Infinity).map((x) => TONE(x.standing)),
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
      self ? word(self.standing) : turn ? 'Working' : 'Nothing running',
      ...counted.length ? [`helpers: ${counted.join(', ')}`] : [],
    ].join('; '),
  }
}

/** The summary the bar's button to the aside wears (frame.ts `Aside`'s
 * `mark`) where the aside is put away: dots and "+N" after the icon. Its
 * `data-label` describes the activity to screen readers. */
export let Glance = ({ aside }: { aside: Aside }) => {
  let { dots, more, label } = glanceOf(aside)
  return h(
    'span',
    {
      class: 'Talk_Glance',
      'data-glance': '',
      'data-label': label,
    },
    dots.map((mod) => h(Dot, { mod, 'aria-hidden': 'true' })),
    more ? h(Popover.Count, { 'aria-hidden': 'true' }, `+${more}`) : null,
  )
}

/** The aside: on a helper's page the helper's own row (`self`), which says
 * how it stands, when it began or ended, what it came to and its model;
 * then Helpers while anything runs or a helper was started, the turn under
 * way at its top (but on a helper's page), and below them `reach`, the ways
 * to reach the Operator (operator-ways.ts). Hidden while nothing runs, no
 * helper was started and there is nothing below them. */
export let Aside = (
  { aside, now, reach }: { aside: Aside; now: number; reach?: Node },
) =>
  h(
    'div',
    {
      class: 'Talk_Aside',
      id: 'aside-now',
      'data-aside': '',
      'aria-label': 'What is happening now',
      hidden: !aside.turn && !aside.helpers.length && !aside.self && !reach,
    },
    aside.self
      ? h(
        Card,
        { 'data-self': '' },
        h(Rows, null, h(Self, { self: aside.self, now })),
      )
      : null,
    h(
      Card,
      {
        hidden: !aside.helpers.length && (!!aside.self || !aside.turn),
        'data-helpers': '',
      },
      h(Card.Head, null, h(Card.Title, null, 'Helpers')),
      aside.self ? null : h(TurnNow, { turn: aside.turn, now }),
      h(
        Rows,
        { 'data-helping': '' },
        aside.helpers.map((helper) =>
          h(Work, { work: helper, now, fold: true })
        ),
      ),
    ),
    reach,
  )

/** A helper's own row on its own page, which opens nowhere: it is there. */
export let Self = ({ self, now }: { self: HelperLine; now?: number }) =>
  h(Work, { work: { ...self, href: undefined }, now })

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
