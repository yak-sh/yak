// A space's trial of the Plus plan (D-476): thirty days of it, with no
// card, whose clock stops while its owners are away and starts again when
// they come back. It is marks on the space, `plan_trial{at, through, paused,
// resumed, subscribed, told}`, and whether it runs, waits or has ended is
// computed from them here; workers/yak trial.ts writes the marks and sends
// the letters this says are due.
import { STARTER, SUBSCRIBED, type Tier } from './plans.ts'

let DAY_MS = 86_400_000

/** The trial's length, in days of its clock. */
export let DAYS: number = 30

/** How long nothing from an owner stops the clock. */
export let AWAY: number = 7 * DAY_MS

/** The days of the clock at which a reminder is due, latest last. */
export let REMIND: number[] = [21, 28]

/** A trial as the space wears it. `through` is the day it ends, moved later
 * by each time away once its owner is back; `paused` is when its clock
 * stopped, none while it runs; `told` the notes its owners were sent, by
 * key ({@link due}), separated by spaces. */
export type Trial = {
  at: string
  through: string
  paused?: string | null
  resumed?: string | null
  subscribed?: string | null
  told?: string | null
}

export type State = 'running' | 'paused' | 'ended'

/** Where a trial stands: its state, the time its clock has left and has run,
 * and the day it ends if its clock runs from now on. */
export type Standing = {
  state: State
  left: number
  ran: number
  through: string
}

let iso = (t: number) => new Date(t).toISOString()

/** A trial begun at `now`. A new space's owner is told of it as they sign
 * up, so it starts told; an existing space's starts untold, and its notice
 * is the first note due. */
export let begun = (now: number, told = true): Trial => ({
  at: iso(now),
  through: iso(now + DAYS * DAY_MS),
  told: told ? 'started' : '',
})

// When the clock stops for an owner last seen at `last`: a week on, never
// before the trial began.
let stops = (t: Trial, last: number) => Math.max(Date.parse(t.at), last + AWAY)

/**
 * The trial at `now`, its owners last seen at `last` where that was read.
 * A pause written and not yet lifted is one, unless they were seen since;
 * without a mark, a week since they were seen is one.
 *
 * ```ts
 * import { begun, trialOf } from '@yaks/platform/trial'
 * import { equal } from '@yaks/testing'
 *
 * let day = 86_400_000
 * let t = begun(Date.parse('2026-12-01T00:00:00Z'))
 * let at = Date.parse(t.at)
 * equal(trialOf(t, at + 10 * day, at + 9 * day).state, 'running')
 * equal(trialOf(t, at + 10 * day, at + 9 * day).left, 20 * day)
 * // away since day 2: the clock stopped on day 9, with 21 days left
 * equal(trialOf(t, at + 40 * day, at + 2 * day).state, 'paused')
 * equal(trialOf(t, at + 40 * day, at + 2 * day).left, 21 * day)
 * equal(trialOf(t, at + 31 * day, at + 30 * day).state, 'ended')
 * ```
 */
export let trialOf = (
  t: Trial,
  now: number,
  last?: number | null,
): Standing => {
  let through = Date.parse(t.through)
  let length = DAYS * DAY_MS
  let held = t.paused ? Date.parse(t.paused) : null
  if (held != null && last != null && last > held) {
    through += last - held
    held = null
  }
  if (held == null && last != null) {
    let stop = stops(t, last)
    if (stop <= now && stop < through) held = stop
  }
  if (held != null && held < through) {
    let left = through - held
    return {
      state: 'paused',
      left,
      ran: length - left,
      through: iso(now + left),
    }
  }
  let left = Math.max(0, through - now)
  return {
    state: left ? 'running' : 'ended',
    left,
    ran: length - left,
    through: iso(through),
  }
}

/** Whether the trial still gives its space the Plus plan: running or
 * paused, read from its marks alone. */
export let inTrial = (t: Trial | null | undefined, now: number): boolean =>
  !!t && trialOf(t, now).state != 'ended'

/** The day the trial gives the Plus plan through, as of `now`: its end,
 * or for a paused one, its days left counted from now. None once ended.
 * It is the free time a subscription bought now starts after
 * (workers/yak billing.ts `freeThrough`). */
export let freeUntil = (
  t: Trial | null | undefined,
  now: number,
): string | null => {
  if (!t) return null
  let s = trialOf(t, now)
  return s.state == 'ended' ? null : s.through
}

/** What happened to a trial at an upkeep: its owners came back, or went
 * away. */
export type Moved = 'resumed' | 'paused'

/**
 * The marks a trial needs at `now`, its owners last seen at `last`: a
 * pause lifted, its days moved on by the time away, when they were seen
 * after it began; a pause written, back to a week after they were last
 * seen, when that week has passed and the trial had not ended. Null when
 * it needs none.
 *
 * ```ts
 * import { begun, upkept } from '@yaks/platform/trial'
 * import { equal } from '@yaks/testing'
 *
 * let day = 86_400_000
 * let t = begun(Date.parse('2026-12-01T00:00:00Z'))
 * let at = Date.parse(t.at)
 * equal(upkept(t, at + 12 * day, at + 2 * day)?.moved, ['paused'])
 * equal(upkept(t, at + 12 * day, at + 2 * day)?.patch.paused, '2026-12-10T00:00:00.000Z')
 * let away = { ...t, paused: '2026-12-10T00:00:00.000Z' }
 * equal(upkept(away, at + 15 * day, at + 15 * day)?.patch, {
 *   paused: null,
 *   resumed: '2026-12-16T00:00:00.000Z',
 *   through: '2027-01-06T00:00:00.000Z',
 * })
 * equal(upkept(t, at + 3 * day, at + 2 * day), null)
 * ```
 */
export let upkept = (
  t: Trial,
  now: number,
  last: number | null,
): { patch: Partial<Trial>; moved: Moved[] } | null => {
  let patch: Partial<Trial> = {}
  let moved: Moved[] = []
  let through = Date.parse(t.through)
  let held = t.paused ? Date.parse(t.paused) : null
  if (held != null && last != null && last > held) {
    through += last - held
    held = null
    Object.assign(patch, {
      paused: null,
      resumed: iso(last),
      through: iso(through),
    })
    moved.push('resumed')
  }
  if (held == null && last != null) {
    let stop = stops(t, last)
    if (stop <= now && stop < through) {
      patch.paused = iso(stop)
      moved.push('paused')
    }
  }
  return moved.length ? { patch, moved } : null
}

/** A note an owner is sent about their trial, by the key `told` keeps:
 * the notice an existing space's trial began, the reminders, a pause (one
 * for each, keyed by when it began) and its end. */
export type Note = 'started' | 'day21' | 'day28' | 'paused' | 'ended'

let keyOf = (t: Trial, note: Note) =>
  note == 'paused' ? `paused:${t.paused}` : note

let toldOf = (t: Trial) => new Set((t.told ?? '').split(' ').filter(Boolean))

/**
 * The note due on a trial at `now`, read from its marks, and the `told`
 * that records it sent; null when none is. Its end first, then a pause that
 * began after the trial did (an existing space that starts paused has its
 * notice), then the latest reminder its clock has reached, then the notice.
 * Each is sent once, and a later reminder counts the earlier as said.
 *
 * ```ts
 * import { begun, due } from '@yaks/platform/trial'
 * import { equal } from '@yaks/testing'
 *
 * let day = 86_400_000
 * let t = begun(Date.parse('2026-12-01T00:00:00Z'))
 * let at = Date.parse(t.at)
 * equal(due(t, at + day), null)
 * equal(due(t, at + 22 * day)?.note, 'day21')
 * equal(due(t, at + 29 * day), { note: 'day28', told: 'started day21 day28' })
 * equal(due({ ...t, told: 'started day21 day28' }, at + 31 * day)?.note, 'ended')
 * equal(due(begun(at, false), at + day)?.note, 'started')
 * ```
 */
export let due = (
  t: Trial,
  now: number,
): { note: Note; told: string } | null => {
  let told = toldOf(t)
  let s = trialOf(t, now)
  let said = (...notes: Note[]) => ({
    note: notes[notes.length - 1],
    told: [...told, ...notes.map((n) => keyOf(t, n))]
      .filter((k, i, all) => all.indexOf(k) == i).join(' '),
  })
  if (s.state == 'ended') return told.has('ended') ? null : said('ended')
  if (
    s.state == 'paused' && t.paused && Date.parse(t.paused) > Date.parse(t.at)
  ) {
    return told.has(keyOf(t, 'paused')) ? null : said('paused')
  }
  let reached = REMIND.filter((d) => s.ran >= d * DAY_MS)
    .map((d) => `day${d}` as Note)
  if (reached.length && !told.has(reached[reached.length - 1])) {
    return said(...reached)
  }
  return told.has('started') ? null : said('started')
}

/** Whole days, rounded up: how a trial's time is said to a person. */
export let days = (ms: number): number => Math.ceil(ms / DAY_MS)

/** A space's trial row as {@link tally} reads it: the trial, and the tier
 * its plan says it pays for, where it pays. */
export type Tallied = { trial: Trial; tier?: Tier | null }

/** The trials on the platform at `now`, and what happened to them since
 * `since`: begun, subscribed and ended in the window, where every one
 * stands now, and the median days of the clock the trials subscribed or
 * ended in the window ran. */
export type Tally = {
  started: number
  converted: number
  ended: number
  running: number
  paused: number
  over: number
  paying: number
  ran: number | null
}

/**
 * The trials counted, from their rows alone.
 *
 * ```ts
 * import { begun, tally } from '@yaks/platform/trial'
 * import { equal } from '@yaks/testing'
 *
 * let day = 86_400_000
 * let at = Date.parse('2026-12-01T00:00:00Z')
 * let rows = [
 *   { trial: begun(at) },
 *   { trial: { ...begun(at), subscribed: '2026-12-05T00:00:00Z' }, tier: 'plus' as const },
 *   { trial: begun(at - 40 * day) },
 * ]
 * equal(tally(rows, at - day, at + 10 * day), {
 *   started: 2, converted: 1, ended: 0, running: 1, paused: 0, over: 1,
 *   paying: 1, ran: 4,
 * })
 * ```
 */
export let tally = (rows: Tallied[], since: number, now: number): Tally => {
  let ran: number[] = []
  let n: Tally = {
    started: 0,
    converted: 0,
    ended: 0,
    running: 0,
    paused: 0,
    over: 0,
    paying: 0,
    ran: null,
  }
  for (let { trial: t, tier } of rows) {
    let s = trialOf(t, now)
    let bought = t.subscribed ? Date.parse(t.subscribed) : null
    if (Date.parse(t.at) >= since) n.started++
    if (bought != null && bought >= since) n.converted++
    if (tier == 'plus' || tier == 'pro') n.paying++
    else n[s.state == 'ended' ? 'over' : s.state]++
    let ended = bought == null && s.state == 'ended' &&
      Date.parse(s.through) >= since
    if (ended) n.ended++
    if (bought != null && bought >= since) ran.push(trialOf(t, bought).ran)
    else if (ended) ran.push(s.ran)
  }
  if (ran.length) {
    let sorted = ran.sort((a, b) => a - b)
    let mid = sorted.length >> 1
    let ms = sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2
    n.ran = Math.round(ms / DAY_MS * 10) / 10
  }
  return n
}

/** The tally in lines, as admin_funnel and the daily digest say it. */
export let tallyLines = (t: Tally, since: string): string[] => [
  `Trials since ${since}: ${t.started} begun, ${t.converted} subscribed, ` +
  `${t.ended} ended`,
  `  Now: ${t.running} running, ${t.paused} paused while away, ${t.over} ` +
  `ended without subscribing, ${t.paying} paying`,
  ...t.ran == null
    ? []
    : [`  Median days a trial ran before it was bought or ended: ${t.ran}`],
]

/** What a trial letter is written from: the space's address, its
 * Operator's name, its trial's days left, the page its plans are on, and
 * the plan it tries and its price a month. */
export type Lettered = {
  slug: string
  operator: string
  left: number
  plans: string
  plan: string
  price: number
}

let dayWord = (n: number) => `${n} ${n == 1 ? 'day' : 'days'}`

/**
 * A note about a trial as its letter, in its Operator's voice, from the
 * space's own address (workers/yak trial.ts). A letter about time away
 * never asks for money: it says the days are waiting, and offers help.
 *
 * ```ts
 * import { letter } from '@yaks/platform/trial'
 * import { equal } from '@yaks/testing'
 *
 * let about = {
 *   slug: 'ada',
 *   operator: 'Wren',
 *   left: 21,
 *   plans: 'https://yaks.app/manage/billing?space=ada',
 *   plan: 'the Plus plan',
 *   price: 12,
 * }
 * equal(letter('paused', about).subject, 'Your trial is waiting for you')
 * equal(letter('paused', about).body.includes('$'), false)
 * equal(letter('ended', about).body.includes('Your apps keep running'), true)
 * ```
 */
export let letter = (
  note: Note,
  a: Lettered,
): { subject: string; body: string } => {
  let left = dayWord(a.left)
  let hello = `Hi, it's ${a.operator}, the Operator of ${a.slug}.`
  let after =
    'After the trial, your apps keep running and everyone you share them ' +
    'with can keep using them. Nothing is deleted. Making new apps and new ' +
    'versions waits until you subscribe.'
  let early = `Subscribing before the trial ends keeps the ${left} you have ` +
    `left and adds $${SUBSCRIBED} of AI use: ${a.plans}`
  let said: Record<Note, { subject: string; body: string[] }> = {
    started: {
      subject: `${a.slug} has a ${DAYS}-day trial of ${a.plan}`,
      body: [
        hello,
        `yaks.app no longer has a free plan. Instead, every space starts ` +
        `with ${DAYS} days of ${a.plan}, free and with no card, and ` +
        `${a.slug} has its ${DAYS} days from today: as many apps as you ` +
        `like, your own domain, payments, and $${STARTER} of AI use.`,
        `The days only count while you're using yaks.app. If you're away ` +
        `for a week, the clock stops until you're back.`,
        after,
        early,
        `If there's anything you'd like help with, reply to this letter.`,
      ],
    },
    day21: {
      subject: `${left} left in your trial`,
      body: [
        hello,
        `You have ${left} left in ${a.slug}'s trial, and they only count ` +
        `while you're here. If there's an app you've been meaning to make, ` +
        `or something you'd like changed, reply and tell me what you have ` +
        `in mind. I can start on it.`,
        early,
      ],
    },
    day28: {
      subject: `${left} left in your trial`,
      body: [
        hello,
        `${a.slug}'s trial has ${left} left.`,
        after,
        early,
        `If something is in the way, reply and tell me.`,
      ],
    },
    paused: {
      subject: 'Your trial is waiting for you',
      body: [
        hello,
        `It's been a week since you were last on yaks.app, so I've stopped ` +
        `the clock on ${a.slug}'s trial. You still have ${left}, and they ` +
        `start again whenever you're back.`,
        `Your apps are still up, and the people you shared them with can ` +
        `keep using them.`,
        `If something got in the way, or there's an app you'd like and ` +
        `haven't had time for, reply and tell me. I can start on it.`,
      ],
    },
    ended: {
      subject: `${a.slug}'s trial has ended`,
      body: [
        hello,
        `${a.slug}'s trial of ${a.plan} has ended.`,
        `Your apps keep running, and everyone you shared them with can keep ` +
        `using them. Nothing is deleted. Making new apps and new versions ` +
        `waits until you subscribe to ${a.plan}, $${a.price} a month: ` +
        a.plans,
        `If you'd like to talk over whether it's right for you, reply to ` +
        `this letter.`,
      ],
    },
  }
  let { subject, body } = said[note]
  return { subject, body: [...body, a.operator].join('\n\n') }
}
