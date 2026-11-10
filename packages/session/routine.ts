// The rule on a knock or an arriving letter: whose it is, settled in the
// write that leaves it.
//
// A project wearing `helper{persona, provider, model, effort}` has its
// operator's routine taken by a helper (./help.ts). An item is routine when
// it is addressed to that operator and is neither of the two things the
// operator's own session is for.
//
// Addressed to the operator:
//
// - a knock at the project, at a project filed under it at any depth, or at a
//   session a person opened (`session.operator`) wearing a persona homed
//   there;
// - a letter that arrived (no `deliver`) for one of those projects or for an
//   address filed under one (@yaks/mail's `mail.target`), unless it answers a
//   letter another session wrote that may still hear the answer
//   (./listen.ts).
//
// The operator's own:
//
// - a person's act or words: `knock.from` (@yaks/notify), else whoever wrote
//   the knock, wears `person`; a letter's `mail.from` is a person's address.
//   A watcher's knock telling of the owner's comment or answer, his text and
//   his mail all name him so.
// - a helper's hand-up: the knock was written through a session wearing
//   `helping`.
//
// A routine item gets `routine{project}` in the same batch, so no listener
// ever reads it as the operator's (./listen.ts leaves it out) and
// `session_help` is owed by the commit that wrote it.

import type { Bundle, Comp, Eid } from '@yaks/graph/bundle'
import { hook, type HookContext } from '@yaks/graph/plugin'
import type { Tx } from '@yaks/graph'
import { writers } from '@yaks/graph'
import { and, eq, fields, list, present } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import { SESSION } from './comp.ts'

/** On a project: its operator's routine goes to a helper. */
export let HELPER = 'helper'
/** On a session: a helper, and the project whose operator it helps. */
export let HELPING = 'helping'
/** On a knock or a letter: a helper's to take. */
export let ROUTINE = 'routine'

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp
let str = (v: unknown): string => typeof v == 'string' ? v : ''
let unique = (ids: string[]): Eid[] => [...new Set(ids.filter(Boolean))]

// What an item is addressed to: a knock's target, or the entity a letter
// that arrived is for.
let target = (b: Bundle): string =>
  str(comp(b, 'knock').target) ||
  (b.mail && !b.deliver ? str(comp(b, 'mail').target) : '')

// Which of `ids` wear `name`.
let wearing = async (tx: Tx, ids: Eid[], name: string): Promise<Set<Eid>> =>
  new Set(
    (ids.length ? await tx.get(ids, [name]) : [])
      .filter((b) => b[name]).map((b) => b.entity.eid),
  )

// How far up a line of projects is followed: a longer one is a cycle.
let DEPTH = 8

// The nearest project wearing `helper` at or above each of these projects.
// An operator hears what is held for its persona's home and for every
// project filed under it (./listen.ts `below`), so its helper takes the same.
let nearest = async (tx: Tx, projects: Eid[]): Promise<Map<Eid, Eid>> => {
  let found = new Map<Eid, Eid>()
  let at = new Map(projects.map((p) => [p, p]))
  for (let depth = 0; at.size && depth < DEPTH; depth++) {
    let rows = new Map(
      (await tx.get(unique([...at.values()]), [HELPER, 'project', 'filed']))
        .map((b) => [b.entity.eid, b]),
    )
    for (let [start, here] of [...at]) {
      let b = rows.get(here)
      let up = b?.project ? str(comp(b, 'filed').project) : ''
      if (b?.[HELPER]) found.set(start, here)
      if (b?.[HELPER] || !up) at.delete(start)
      else at.set(start, up)
    }
  }
  return found
}

// The helped project each addressed entity leads to: from a project, itself
// or the nearest above it; from a session a person opened, the home of the
// persona it wears; from an address, the project it is filed under.
let helped = async (tx: Tx, targets: Eid[]): Promise<Map<Eid, Eid>> => {
  let rows = await tx.get(targets, [
    HELPER,
    SESSION,
    'project',
    'email',
    'filed',
  ])
  let worn = (b: Bundle) =>
    comp(b, SESSION).operator == true ? str(comp(b, SESSION).persona) : ''
  let personas = unique(rows.map(worn))
  let home = new Map(
    (personas.length ? await tx.get(personas, ['persona']) : [])
      .map((b) => [b.entity.eid, str(comp(b, 'persona').home)]),
  )
  let lead = (b: Bundle) =>
    b[HELPER] || b.project
      ? b.entity.eid
      : home.get(worn(b)) ?? (b.email ? str(comp(b, 'filed').project) : '')
  let leads = unique(rows.map(lead))
  let projects = leads.length ? await nearest(tx, leads) : new Map<Eid, Eid>()
  return new Map(
    rows.filter((b) => projects.has(lead(b)))
      .map((b) => [b.entity.eid, projects.get(lead(b))!]),
  )
}

// The addresses among these that a person wears.
let personal = async (
  tx: Tx,
  vocab: Vocab | undefined,
  addresses: string[],
): Promise<Set<string>> =>
  new Set(
    addresses.length && vocab?.comp('person') && vocab.comp('email')
      ? (await tx.read(and(
        present('person'),
        eq('email.address', list(...addresses)),
        fields('email.address'),
      ))).map((b) => str(comp(b, 'email').address))
      : [],
  )

// The letters among these that answer one another session wrote and may
// still hear the answer to: that session's, not the project's. A session a
// person opened is the operator the letter is addressed to already.
let answering = async (tx: Tx, letters: Bundle[]): Promise<Set<Bundle>> => {
  let to = (b: Bundle) => str(comp(b, 'mail').reply_to)
  let answered = unique(letters.map(to))
  let writer = new Map(
    (answered.length ? await tx.get(answered, ['created']) : [])
      .map((b) => [b.entity.eid, str(comp(b, 'created').via)]),
  )
  let sessions = unique([...writer.values()])
  let open = new Set(
    (sessions.length ? await tx.get(sessions, [SESSION]) : [])
      .filter((b) =>
        b[SESSION] && comp(b, SESSION).ended != true &&
        comp(b, SESSION).operator != true
      ).map((b) => b.entity.eid),
  )
  return new Set(letters.filter((b) => open.has(writer.get(to(b)) ?? '')))
}

let routed = async (
  bundles: Bundle[],
  items: Bundle[],
  tx: Tx,
  vocab?: Vocab,
) => {
  let project = await helped(tx, unique(items.map(target)))
  let mine = items.filter((b) => project.has(target(b)))
  if (!mine.length) return bundles
  let knocks = mine.filter((b) => b.knock)
  let letters = mine.filter((b) => !b.knock)
  let writer = writers(bundles)
  let from = (b: Bundle) =>
    str(comp(b, 'knock').from) || str(writer(b.entity.eid).by)
  let via = (b: Bundle) => str(writer(b.entity.eid).via)
  let sender = (b: Bundle) => str(comp(b, 'mail').from).toLowerCase()
  let people = await wearing(tx, unique(knocks.map(from)), 'person')
  let helpers = await wearing(tx, unique(knocks.map(via)), HELPING)
  let persons = await personal(tx, vocab, unique(letters.map(sender)))
  let theirs = await answering(tx, letters)
  let routine = new Set([
    ...knocks.filter((b) => !people.has(from(b)) && !helpers.has(via(b))),
    ...letters.filter((b) => !persons.has(sender(b)) && !theirs.has(b)),
  ])
  return bundles.map((b) =>
    routine.has(b)
      ? { ...b, [ROUTINE]: { project: project.get(target(b)) } }
      : b
  )
}

/** The write hook that marks a routine knock or letter `routine{project}`. */
export let routing = hook(
  ['knock', 'mail'],
  (bundles, tx, _err, context?: HookContext) => {
    let items = bundles.filter((b) => target(b) && !(ROUTINE in b))
    let vocab = (context?.graph as { vocab?: Vocab } | undefined)?.vocab
    return items.length ? routed(bundles, items, tx, vocab) : bundles
  },
)
