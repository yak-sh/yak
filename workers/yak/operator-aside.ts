// The aside in the chat's header (operator-page.ts `talkPage`): what the
// conversation is doing now, and the helpers it set going, each with how it
// stands, its step and how long it has taken. In the right margin where the
// page is wide enough; elsewhere, a phone among them, a summary at the
// header's right end, a dot for the turn and for each helper and a "+N" past
// `DOTS`, that a press opens to the whole list. The Builder object works out
// what it holds (operator-view.ts `turnOf`, `helping`) and sends it on the
// page's socket as data; this draws it, in the Builder for the page's first
// drawing and in the browser as `_talk.js` (operator-rows.ts) for each frame,
// and says how long each has lasted, which the page keeps current.
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { Button, Card, Dot, Rows, State } from '@yaks/ui/parts'

/** What a conversation's turn is doing while it runs, and since when. */
export type Turn = { what: string; since: string }

/** How a helper stands. */
export type Standing = 'running' | 'waiting' | 'done' | 'failed' | 'stopped'

/** A helper as the aside lists it: the run it opens, what it was asked, how
 * it stands, its step under way, when it began, and when it ended. */
export type HelperLine = {
  session: string
  href?: string
  title: string
  standing: Standing
  step: string
  since: string
  until?: string
}

/** What the aside holds: the turn under way, and the helpers. */
export type Aside = { turn: Turn | null; helpers: HelperLine[] }

/** Whether a helper is still at it. */
export let going = (h: Pick<HelperLine, 'standing'>) =>
  h.standing == 'running' || h.standing == 'waiting'

/**
 * How long something has lasted, from `since` to `until` or `now`, in the
 * fewest units that say it.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { lasted } from './operator-aside.ts'
 * let at = '2026-11-08T15:00:00.000Z'
 * let now = Date.parse(at)
 * equal(lasted(at, undefined, now + 4_400), '4s')
 * equal(lasted(at, undefined, now + 192_000), '3m 12s')
 * equal(lasted(at, '2026-11-08T16:04:30.000Z'), '1h 4m')
 * equal(lasted('', undefined, now), '')
 * ```
 */
export let lasted = (since: string, until?: string, now = Date.now()) => {
  let from = Date.parse(since)
  if (!Number.isFinite(from)) return ''
  let to = until ? Date.parse(until) : now
  let s = Math.max(0, Math.floor((to - from) / 1000))
  let [hours, minutes, seconds] = [s / 3600, (s % 3600) / 60, s % 60]
    .map(Math.floor)
  return hours
    ? `${hours}h ${minutes}m`
    : minutes
    ? `${minutes}m ${seconds}s`
    : `${seconds}s`
}

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

// How long, kept current by the page (`[data-since]`).
let For = (
  { since, until, now }: { since: string; until?: string; now: number },
) =>
  h('time', {
    class: 'Talk_Time',
    'data-since': since,
    'data-until': until,
    dateTime: since,
  }, lasted(since, until, now))

/** The turn under way, in a line: what it is doing and for how long, or that
 * nothing runs. */
export let TurnNow = ({ turn, now }: { turn: Turn | null; now: number }) =>
  h(
    'p',
    { class: 'Talk_Turn', 'data-turn': '' },
    turn
      ? [
        h(State, { mod: ['pulse', 'active'] }, turn.what.replace(/…$/, '')),
        ' · ',
        h(For, { since: turn.since, now }),
      ]
      : h(State, null, 'Nothing running'),
  )

/** How a helper stands, in a word in its tone. */
export let Stands = ({ standing }: { standing: Standing }) => {
  let [word, tone] = WORD[standing]
  return h(State, { mod: tone }, word)
}

/** A helper as a row: what it was asked, linked to its run, over how it
 * stands, its step and how long it took. */
export let Helper = (
  { helper: x, now }: { helper: HelperLine; now: number },
) =>
  h(
    Rows.Item,
    { id: `help-${x.session}`, 'data-going': going(x) ? '' : undefined },
    h(
      Rows.Main,
      null,
      h(Rows.Name, null, x.href ? h('a', { href: x.href }, x.title) : x.title),
      h(
        Rows.Meta,
        null,
        h(Stands, { standing: x.standing }),
        x.step ? ` · ${x.step.replace(/…$/, '')}` : null,
        ' · ',
        h(For, { since: x.since, until: x.until, now }),
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
    Button,
    {
      type: 'button',
      class: 'Talk_Glance',
      'data-glance': '',
      'aria-expanded': open ? 'true' : 'false',
      'aria-controls': 'aside-now',
      'aria-label': label,
    },
    dots.map((mod) => h(Dot, { mod, 'aria-hidden': 'true' })),
    more
      ? h('span', { class: 'Talk_More', 'aria-hidden': 'true' }, `+${more}`)
      : null,
  )
}

/** The aside: the summary, then Now, and Helpers while there are any.
 * Hidden while nothing runs and no helper was started. */
export let Aside = (
  { aside, now, open = false }: { aside: Aside; now: number; open?: boolean },
) =>
  h(
    'aside',
    {
      class: 'Talk_Aside',
      'data-aside': '',
      'data-open': open ? '' : undefined,
      'aria-label': 'What is happening now',
      hidden: !aside.turn && !aside.helpers.length,
    },
    h(Glance, { aside, open }),
    h(
      'div',
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
          aside.helpers.map((helper) => h(Helper, { helper, now })),
        ),
      ),
    ),
  )

/** The aside as HTML, its list shown or not. */
export let asideHtml = (aside: Aside, open = false, now = Date.now()) =>
  renderToString(h(Aside, { aside, now, open }))

/** The summary's button as HTML. */
export let glanceHtml = (aside: Aside, open = false) =>
  renderToString(h(Glance, { aside, open }))

/** The turn's line as HTML. */
export let turnHtml = (turn: Turn | null, now = Date.now()) =>
  renderToString(h(TurnNow, { turn, now }))

/** A helper's row as HTML. */
export let helperHtml = (helper: HelperLine, now = Date.now()) =>
  renderToString(h(Helper, { helper, now }))

/** The helpers to list, those at work first, then the newest: at most
 * `most`. */
export let ordered = (helpers: HelperLine[], most = 8) =>
  helpers.toSorted((a, b) =>
    Number(going(b)) - Number(going(a)) || b.since.localeCompare(a.since)
  ).slice(0, most)
