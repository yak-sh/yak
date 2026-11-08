// The aside in the chat's right margin (operator-page.ts `chatPage`): what
// the conversation is doing now, and the helpers it set going, each with how
// it stands, its step and how long it has taken. The Builder object works out
// what it holds (operator-view.ts `turnOf`, `helping`) and sends it on the
// page's socket as data; this draws it, in the Builder for the page's first
// drawing and in the browser as `_talk.js` (operator-rows.ts) for each frame,
// and says how long each has lasted, which the page keeps current.
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { Card, Rows, State } from '@yaks/ui/parts'

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

// How long, kept current by the page (`[data-since]`).
let For = (
  { since, until, now }: { since: string; until?: string; now: number },
) =>
  h('time', {
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

/** A helper as a row: what it was asked, linked to its run, over how it
 * stands, its step and how long it took. */
export let Helper = (
  { helper: x, now }: { helper: HelperLine; now: number },
) => {
  let [word, tone] = WORD[x.standing]
  return h(
    Rows.Item,
    { id: `help-${x.session}`, 'data-going': going(x) ? '' : undefined },
    h(
      Rows.Main,
      null,
      h(Rows.Name, null, x.href ? h('a', { href: x.href }, x.title) : x.title),
      h(
        Rows.Meta,
        null,
        h(State, { mod: tone }, word),
        x.step ? ` · ${x.step.replace(/…$/, '')}` : null,
        ' · ',
        h(For, { since: x.since, until: x.until, now }),
      ),
    ),
  )
}

/** The aside: Now, and Helpers while there are any. Hidden while nothing
 * runs and no helper was started. */
export let Aside = ({ aside, now }: { aside: Aside; now: number }) =>
  h(
    'aside',
    {
      class: 'Talk_Aside',
      'data-aside': '',
      'aria-label': 'What is happening now',
      hidden: !aside.turn && !aside.helpers.length,
    },
    h(
      'div',
      { class: 'Talk_AsideIn' },
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

/** The aside as HTML. */
export let asideHtml = (aside: Aside, now = Date.now()) =>
  renderToString(h(Aside, { aside, now }))

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
