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
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { Model, Price } from '@yaks/model'
import type { Tool } from '@yaks/session'
import { find, gather } from '@yaks/trial/round'
import { type Answering, asking, type Ran } from '@yaks/trial/run'
import { type Card, deck } from '@yaks/trial/skill'
import { running } from '@yaks/trial/effects'
import type { Env } from './env.ts'
import { accounted } from './meter.ts'
import { MACHINE } from './operator-machine.ts'
import { notification } from './operator-updates.ts'
import type { operatorStore } from './operator-store.ts'
import { refuse } from './tool.ts'

type Store = ReturnType<typeof operatorStore>

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

/** The store's trials run as its effect, through `lent`. */
export let trialRunning = (store: Store, env: Env, lent: Lending) =>
  store.fx.handle(running(
    store.g,
    (round) => asking(store.g, answering(env, lent, round)),
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

// A card as the person reads it: the two outputs, each part on its line.
let shown = (c: Card, parts: string[], n: number, of: number) => {
  let pitch = (label: string, p: Card['first']) =>
    `${label}:\n${
      parts.filter((k) => p.parts[k]).map((k) => `${k}: ${p.parts[k]}`).join(
        '\n',
      )
    }`
  return `Pair ${n} of ${of}${c.title ? ` (${c.title})` : ''}\n${
    pitch('First', c.first)
  }\n\n${pitch('Second', c.second)}`
}

let round = {
  type: 'string',
  description: 'The round: its key as planned, its id or its eid.',
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
    readOnly: true,
    description:
      "The next pairs of outputs in a skill trial's round that this person has not picked between, each numbered for trial_pick. Show them to the person as they are, never saying which variant wrote which, and ask which they would rather read on from, or neither.",
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
      let open = d.cards.map((c, i) => [c, i + 1] as const)
        .filter(([c]) => !c.preference)
      if (!open.length) {
        return {
          text: d.cards.length
            ? `They have picked in every pair of ${d.title}.`
            : `${d.title} has no pair with both outputs written yet.`,
          with: {},
        }
      }
      return {
        text: open.slice(0, Number(args.few ?? 3)).map(([c, n]) =>
          shown(c, d.parts, n, d.cards.length)
        ).join('\n\n-----\n\n'),
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
      let chose = args.chose == 'first'
        ? c.first.eid
        : args.chose == 'second'
        ? c.second.eid
        : null
      // One row a person and pair: picking again changes it.
      let eid = c.preference ??
        derivedEid(`preference|${person}|${c.first.eid}|${c.second.eid}`)
      await store.g.apply([{
        entity: { eid },
        preference: {
          first: c.first.eid,
          second: c.second.eid,
          chose,
          ...args.why ? { why: String(args.why) } : {},
        },
        $actor: { by: person, via: context?.session },
      }])
      return { text: `Recorded: ${args.chose} in pair ${args.pair}.`, with: {} }
    },
  }]
}
