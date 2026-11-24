// A space improves a skill by trials (D-160631, T-161784): it brings cases,
// candidate texts of the skill are run on them and judged, a member picks
// between outputs, and the winner becomes the skill's next version. The rows
// and their running are @yaks/trial's, in the space's Operator store beside
// its skills; this file gives them the platform's two edges.
//
// - Who answers: the model a round names, among the Operator's providers,
//   charged to the space that set the round's cap through the one door every
//   model call is charged through (meter.ts `accounted`), at its measured
//   cost. A person's own machine answers none: a trial is the space's spend.
// - A pick: a person's choice between two outputs, which they make through
//   their Operator, is written as theirs, since it is their own act
//   (M-31958). Everything else a trial writes is the space's.
//
// Only members are offered the tools, so a visitor runs no trial and picks
// nothing.
//
// A round of matches (@yaks/trial/match) is between any sides, most often
// drafts of the space's apps, which a member taps between on the space's
// Matches page (matches.ts, `matching` here). A judge comparing them reads a
// draft as its files hold it (`seeing`), and is charged like every call of a
// round.
//
// A published skill's page shows every measured round's cases and outputs
// (skill-page.ts), so whoever brings a round's cases hears that before it
// runs: the answers of `trial_plan` and of `trial_cap`'s quote carry it,
// naming the page where the skill has one (`publicity`).
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { Model, Price } from '@yaks/model'
import type { Tool } from '@yaks/session'
import { find, gather } from '@yaks/trial/round'
import { type Answering, asking, type Ran } from '@yaks/trial/run'
import { type Card, deck, type Side } from '@yaks/trial/skill'
import { next } from '@yaks/trial/rating'
import { side, sides, vocab } from '@yaks/trial/sides'
import { render } from '@yaks/text'
import { running } from '@yaks/trial/effects'
import { measured, places } from '@yaks/trial/match'
import { r2RawObjects } from './lib/objects.ts'
import { talkPath } from '@yaks/platform/routes'
import { url as hostUrl } from '@yaks/platform/host'
import type { Directory } from './directory.ts'
import { directoryOf } from './directory.ts'
import { drafting } from './written.ts'
import { COPY } from './page-copy.ts'
import { spaceOf } from './operator-root.ts'
import type { Env } from './env.ts'
import { skillAt } from './skill-page.ts'
import { accounted } from './meter.ts'
import { MACHINE } from './operator-machine.ts'
import { notification } from './operator-updates.ts'
import type { OperatorStore } from './operator-store.ts'
import { refuse } from './tool.ts'

type Store = OperatorStore

/** What the Operator lends a space's trials: its providers, their prices,
 * and the model a round that names none is asked. */
export type Lending = {
  models: Record<string, Model>
  priced: (model: string, from: string) => Promise<Price | undefined>
  provider: string
  name: string
}

let comp = (b: Bundle | undefined, name: string) =>
  (b?.[name] ?? {}) as Record<string, unknown>

/** What whoever brings a round's cases hears before it runs: once a member
 * picks in it, its cases and outputs are on the page of the skill it
 * develops, now where the skill is published, or once it is. */
export let publicity = async (dir: Directory, env: Env, round: Bundle) => {
  let skill = String(comp(round, 'round').skill ?? '')
  let at = skill ? await dir.skillOffered({ eid: skill }) : null
  let where = at
    ? `on the skill's public page, ${skillAt(at.skill.published.name, env)}`
    : "on the skill's public page if it is ever published"
  return `Before setting a cap, tell whoever brought these cases: once a member picks in this round, its cases and every output show ${where}, for anyone to read. Leave out anything private.`
}

/** Who answers a round's calls: the model it names (else the Operator's),
 * charged to the space that set its cap (`capped.by`). */
export let answering =
  (env: Env, lent: Lending, round: Bundle): Answering => async (names) => {
    let from = names.provider ?? lent.provider
    let name = names.model ?? lent.name
    let base = from == MACHINE ? undefined : lent.models[from]
    if (!base) {
      throw refuse('arguments', `No ${from} provider answers a trial here.`)
    }
    let price = await lent.priced(name, from)
    if (!price) throw refuse('arguments', `${from} lists no price for ${name}.`)
    let space = String(comp(round, 'capped').by ?? '')
    return {
      model: accounted(
        env,
        (dir) => dir.at(space),
        base,
        () => Promise.resolve(price),
        undefined,
        from,
      ),
      name,
      price,
    }
  }

// Dollars as a person reads them; a run of a few calls may cost under a cent.
let usd = (n: number) => n > 0 && n < 0.01 ? 'under a cent' : `$${n.toFixed(2)}`

/** What the space's people are told once a run is over. */
export let told = (round: Bundle, ran: Ran) => {
  let title = String(comp(round, 'doc').title ?? 'A trial round')
  let more = [
    ran.failed ? `${ran.failed} said nothing readable` : '',
    ran.left ? `${ran.left} left unasked, stopped by ${ran.stopped}` : '',
  ].filter((s) => s)
  return `The trial round “${title}” ran: ${ran.returned} of its writers and judges came back${
    more.length ? `, ${more.join(', ')}` : ''
  }, for ${usd(ran.spent)}.`
}

/** The most of one file of a draft a judge is shown. */
export let SEEN = 24_000

/** The words of the space's drafts a judge compares, by eid: each draft's
 * front page and its copy as its files hold them. A draft closed, or of
 * another space, is not seen, so nothing of it is asked. */
export let seeing = (env: Env, store: Store) => async (eids: string[]) => {
  let dir = directoryOf(env.STORE)
  let space = await spaceOf(store)
  let raw = r2RawObjects(env.BLOBS)
  let seen = await Promise.all(eids.map(async (eid) => {
    let named = await dir.draftAt(eid)
    let held = named && await dir.appAt(named.app)
    if (!named || !held || held.app.space != space) return []
    let d = await drafting(raw, dir, held.app, named.draft)
    let file = async (path: string) => {
      if (!(path in d.files)) return ''
      let bytes = await d.view.read(`${d.root}/${path}`)
      let text = bytes ? new TextDecoder().decode(bytes).slice(0, SEEN) : ''
      return text ? `${path}:\n${text}` : ''
    }
    let words = (await Promise.all(['index.html', COPY].map(file)))
      .filter((w) => w).join('\n\n')
    return words ? [[eid, words] as [string, string]] : []
  }))
  return new Map(seen.flat())
}

/** Who answers a round's calls, and what its judges see. */
export let roundAsking = (
  env: Env,
  store: Store,
  lent: Lending,
  round: Bundle,
) => ({
  ...asking(store.g, answering(env, lent, round)),
  see: seeing(env, store),
})

/** Where the space's members tap through a round's pairs (matches.ts). */
export let tappingAt = async (
  env: Env,
  dir: Directory,
  store: Store,
  round: Bundle,
) => {
  let space = await dir.at(String(await spaceOf(store) ?? ''))
  return space
    ? `${
      hostUrl(env, talkPath('matches', space.slug))
    }?round=${round.entity.eid}`
    : undefined
}

/** The store's trials run as its effect, through `lent`. */
export let trialRunning = (store: Store, env: Env, lent: Lending) =>
  store.fx.handle(running(
    store.g,
    (round) => roundAsking(env, store, lent, round),
    {
      done: (round, ran) =>
        ran.asked + ran.left
          ? store.g.apply([
            notification({
              to: String(comp(round, 'capped').by),
              words: told(round, ran),
              about: round.entity.eid,
            }),
          ], { trusted: true })
          : undefined,
    },
  ))

// A card as the person reads it: its question, then the two sides, an
// output each part on its line and anything else as its view draws it.
let shown = (c: Card, parts: string[], n: number, of: number) => {
  let pitch = (label: string, p: Side) => {
    let output = (p.shown.writing as { output?: Record<string, string> })
      ?.output
    return `${label}:\n${
      output
        ? parts.filter((k) => output[k]).map((k) => `${k}: ${output[k]}`)
          .join('\n')
        : render(sides, p.shown, 'Side', vocab(), side(parts), 'plain')
    }`
  }
  return `Pair ${n} of ${of}${c.title ? ` (${c.title})` : ''}${
    c.question ? `\nAsks: ${c.question}` : ''
  }\n${pitch('First', c.first)}\n\n${pitch('Second', c.second)}`
}

// The cards to show next, by deck index: what the rating of the person's own
// picks says is closest, one after another, each question rated apart.
let upcoming = (cards: Card[], few: number): number[] => {
  let games = cards.map((c) => ({
    a: c.first.eid,
    b: c.second.eid,
    chose: c.preference ? c.chose ?? null : undefined,
    group: c.question ?? '',
  }))
  let picked: number[] = []
  while (picked.length < few) {
    let i = next(games, (j) => picked.includes(j))
    if (i == undefined) break
    picked.push(i)
  }
  return picked
}

let round = {
  type: 'string',
  description: 'The round: its key as planned, its id or its eid.',
}

/** A person's pick in one pair of a round, written as theirs: `first`,
 * `second` or `neither`, and why where they said. One row a person and pair,
 * so picking again changes it. */
export let pick = async (
  store: Store,
  person: string,
  c: Card,
  chose: string,
  why?: string,
  via?: string,
) => {
  let side = chose == 'first'
    ? c.first.eid
    : chose == 'second'
    ? c.second.eid
    : chose == 'neither'
    ? null
    : undefined
  if (side === undefined) {
    throw refuse('arguments', 'Pick first, second or neither.')
  }
  let eid = c.preference ??
    derivedEid(
      `preference|${person}|${c.first.eid}|${c.second.eid}${
        c.question ? `|${c.question}` : ''
      }`,
    )
  await store.g.apply([{
    entity: { eid },
    preference: {
      first: c.first.eid,
      second: c.second.eid,
      chose: side,
      ...c.pair ? { pair: c.pair } : {},
      ...why ? { why } : {},
    },
    $actor: { by: person, ...via ? { via } : {} },
  }])
}

/** The tools a member picks between a round's outputs with, as themselves:
 * the next pairs they have not picked in, and their pick. */
export let pickTools = (
  store: Store,
  person: string,
): Tool[] => {
  let cards = async (word: string) => {
    let all = await gather(store.g, await find(store.g, word))
    return deck(all, person)
  }
  return [{
    name: 'trial_pairs',
    title: 'Show the next pairs to pick between',
    step: {
      doing: 'Picking the next pairs for you to compare…',
      done: 'Picked the next pairs for you to compare',
    },
    readOnly: true,
    description:
      "The next pairs in a skill trial's round that this person has not picked between, each numbered for trial_pick: the ones their earlier picks leave closest, so a pair those already settle is not shown. Show them to the person as they are, never saying which variant wrote which, and ask the pair's question where it asks one, otherwise which they would rather read on from, or neither.",
    parameters: {
      type: 'object',
      properties: {
        round,
        few: { type: 'integer', description: 'How many pairs (default 3).' },
      },
      required: ['round'],
    },
    run: async (args) => {
      let d = await cards(String(args.round))
      let open = upcoming(d.cards, Number(args.few ?? 3))
      if (!open.length) {
        return {
          text: !d.cards.length
            ? `${d.title} has no pair with both outputs written yet.`
            : d.cards.every((c) => c.preference)
            ? `They have picked in every pair of ${d.title}.`
            : `Nothing is left to pick in ${d.title}: their picks settle the pairs they have not picked in.`,
          with: {},
        }
      }
      return {
        text: open.map((i) => shown(d.cards[i], d.parts, i + 1, d.cards.length))
          .join('\n\n-----\n\n'),
        with: {},
      }
    },
  }, {
    name: 'trial_pick',
    title: 'Record a pick between two outputs',
    step: { doing: 'Recording the pick…', done: 'Recorded the pick' },
    description:
      "Record this person's pick in one pair trial_pairs showed them: first, second or neither, and why if they said. Only their own words: never pick for them. Picking again in a pair changes the pick.",
    parameters: {
      type: 'object',
      properties: {
        round,
        pair: { type: 'integer', description: 'The pair’s number.' },
        chose: { type: 'string', enum: ['first', 'second', 'neither'] },
        why: { type: 'string', description: 'Why, in their words.' },
      },
      required: ['round', 'pair', 'chose'],
    },
    run: async (args, context) => {
      let d = await cards(String(args.round))
      let c = d.cards[Number(args.pair) - 1]
      if (!c) throw refuse('arguments', `${d.title} has no pair ${args.pair}.`)
      await pick(
        store,
        person,
        c,
        String(args.chose),
        args.why ? String(args.why) : undefined,
        context?.session,
      )
      return { text: `Recorded: ${args.chose} in pair ${args.pair}.`, with: {} }
    },
  }]
}

/** One side as the Matches page draws it: what the deck shows of it (an
 * attempt's parts, an image, a document), or only its eid, a draft of one of
 * the space's apps. */
export type Tapped = Card['first']['shown']

/** A round as a person taps through it: the pair to pick in next, numbered
 * as `trial_pairs` numbers it, how many pairs are left worth picking in and
 * how many they picked in, and where each side stands so far, with what was
 * measured of it. */
export type Tapping = {
  round: string
  title: string
  parts: string[]
  card?: {
    n: number
    question?: string
    first: Tapped & { label: string }
    second: Tapped & { label: string }
  }
  left: number
  picked: number
  places: { eid: string; label: string; shown: Tapped; measured: string }[]
}

/**
 * What a member does on the Matches page, as themselves: reads the rounds
 * with pairs left for them (`{}`), reads one (`{round}`), picks in one of
 * its pairs (`{round, pair, chose, why}`), or reads a picture a side of it
 * is (`{round, side}`: its address and media type).
 */
export let matching = async (
  store: Store,
  person: string,
  args: Record<string, unknown>,
) => {
  let str = (k: string) => typeof args[k] == 'string' ? args[k] as string : ''
  let read = async (word: string) => {
    let all = await gather(store.g, await find(store.g, word))
    return { all, d: deck(all, person) }
  }
  if (!str('round')) {
    let rounds = await store.g.read('.round .fields=entity.eid,doc.title')
    let open = await Promise.all(rounds.map(async (r) => {
      let { d } = await read(r.entity.eid)
      return {
        round: r.entity.eid,
        title: d.title,
        left: upcoming(d.cards, d.cards.length).length,
        of: d.cards.length,
      }
    }))
    return { rounds: open.filter((r) => r.of) }
  }
  let { all, d } = await read(str('round'))
  if (str('side')) {
    let side = d.cards.flatMap((c) => [c.first, c.second])
      .find((s) => s.eid == str('side'))
    let file = side?.shown.artifact as
      | { address?: string; media_type?: string }
      | undefined
    if (!file?.address) {
      throw refuse('missing', 'That round has no such picture.')
    }
    return { address: file.address, media_type: String(file.media_type ?? '') }
  }
  if (args.pair != null) {
    let c = d.cards[Number(args.pair) - 1]
    if (!c) throw refuse('arguments', `${d.title} has no pair ${args.pair}.`)
    await pick(store, person, c, str('chose'), str('why') || undefined)
    return read(str('round')).then(({ all, d }) => tapping(all, d))
  }
  return tapping(all, d)
}

let tapping = (all: Bundle[], d: ReturnType<typeof deck>): Tapping => {
  let open = upcoming(d.cards, d.cards.length)
  let c = open.length ? d.cards[open[0]] : undefined
  let placed = places(all)
  let shownOf = new Map(
    d.cards.flatMap((c) => [c.first, c.second]).map((s) => [s.eid, s.shown]),
  )
  // Each side is called by a letter in the order the round first shows it,
  // or by its title where it has one, never by what made it.
  let order = [...shownOf.keys()]
  let label = (eid: string) =>
    String((shownOf.get(eid)?.doc as { title?: unknown })?.title ?? '') ||
    `Side ${
      order.indexOf(eid) < 26
        ? String.fromCharCode(65 + order.indexOf(eid))
        : order.indexOf(eid) + 1
    }`
  let labelled = (s: Tapped) => ({ ...s, label: label(s.entity.eid) })
  return {
    round: d.round,
    title: d.title,
    parts: d.parts,
    ...c
      ? {
        card: {
          n: open[0] + 1,
          ...c.question ? { question: c.question } : {},
          first: labelled(c.first.shown),
          second: labelled(c.second.shown),
        },
      }
      : {},
    left: open.length,
    picked: d.cards.filter((c) => c.preference).length,
    places: placed.map((p) => ({
      eid: p.eid,
      label: label(p.eid),
      shown: shownOf.get(p.eid) ?? { entity: { eid: p.eid } },
      measured: measured(p, placed.length),
    })),
  }
}
