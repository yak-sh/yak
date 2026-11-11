// An app's own people, read as pure functions over rows the caller read: who
// a phone, an address and a name belong to, what a person's empty properties
// take from answers, and a typed address as a household's parts. The rule a
// sign-up settles by is ./graph's.

import { type Bundle, type Comp, dead } from '@yaks/graph'
import { same } from '@yaks/fp'
import { e164 } from '@yaks/phone/mobile'
import { typesOf, type Vocab } from '@yaks/vocab'
import { peopleDoc } from './vocab.ts'

/** The words this package declares. */
export type Word = 'individual' | 'household' | 'relation'

let fields = (row: Bundle | undefined, name: string): Comp =>
  row?.[name] as Comp ?? {}
let empty = (v: unknown) => v == null || typeof v == 'string' && !v.trim()
let folded = (v: unknown) => typeof v == 'string' ? v.trim().toLowerCase() : ''
let number = (v: unknown) => typeof v == 'string' ? e164(v) : null
let quoted = (v: string) => JSON.stringify(v)

/**
 * Whether a store keeps `word` as this package means it: the store declares
 * the component, and each property they both declare has this package's type.
 * An app that named @yaks/people is lent the words and speaks them; one that
 * declares them itself speaks them while its declaration agrees, which an
 * installed church directory's does. One that means something else by
 * `individual` does not, and its rows are left alone.
 *
 * ```ts
 * import { loadVocab, type PropSchema } from '@yaks/vocab'
 * import { peopleDoc } from '@yaks/people/vocab'
 * import { speaks, unlike } from '@yaks/people'
 * import { equal } from '@yaks/testing'
 * let own = (props: Record<string, PropSchema>) =>
 *   loadVocab([{ $defs: { individual: { component: true, properties: props } } }])
 * equal(speaks(loadVocab([peopleDoc]), 'individual'), true)
 * equal(speaks(own({ first: { type: 'string' } }), 'individual'), true)
 * equal(speaks(own({ first: { type: 'number' } }), 'individual'), false)
 * equal(speaks(own({}), 'household'), false)
 * equal(unlike(own({ first: { type: 'number' } })), ['individual'])
 * ```
 */
export let speaks = (vocab: Vocab, word: Word): boolean => {
  if (!vocab.comp(word)) return false
  let held = vocab.def(word)?.properties ?? {}
  let props = peopleDoc.$defs?.[word]?.properties ?? {}
  return Object.entries(props).every(([prop, s]) =>
    !held[prop] || typesOf(s).every((t) => typesOf(held[prop]).includes(t))
  )
}

/** The words a store declares that it does not keep as this package means
 * them ({@link speaks}): what a deploy tells an app whose `individual` is
 * something else, since a sign-up there leaves its rows alone. */
export let unlike = (vocab: Vocab): Word[] =>
  (['individual', 'household', 'relation'] as const).filter((word) =>
    vocab.comp(word) && !speaks(vocab, word)
  )

/** The addresses one value holds: a household's row may list two. */
/// addresses('Ann@x.org, bo@x.org') -> ['ann@x.org', 'bo@x.org']
/// addresses(3) -> []
export let addresses = (value: unknown): string[] =>
  typeof value == 'string'
    ? value.split(/[\s,;]+/).map(folded).filter((a) => a.includes('@'))
    : []

/** Whether a row is somebody who can sign in or sign up: not deleted, and
 * not of the deceased. */
/// living({ entity: { eid: 'a' }, individual: { deceased: true } }) -> false
/// living({ entity: { eid: 'a' }, phone: { number: '+15555550100' } }) -> true
export let living = (row: Bundle): boolean =>
  !dead(row) && fields(row, 'individual').deceased !== true

/** The address a person's row lists, as it is typed. */
/// emailOf({ entity: { eid: 'a' }, individual: { email: 'ann@x.org' } }) -> 'ann@x.org'
/// emailOf(undefined) -> undefined
export let emailOf = (row: Bundle | undefined): string | undefined => {
  let email = fields(row, 'individual').email
  return typeof email == 'string' ? email : undefined
}

/** `row` as it reads with `phone` typed as the person's number: what a
 * sign-up by text starts from, since the platform received the text from it. */
/// withPhone({ entity: { eid: 'a' }, individual: { first: 'Ann' } }, '+15555550100').individual -> { first: 'Ann', phone: '+15555550100' }
export let withPhone = (row: Bundle | undefined, phone: string): Comp => ({
  ...row,
  individual: { ...fields(row, 'individual'), phone },
})

/** A person's row with the phone they typed carried as `phone{number}` in
 * E.164 form, which is what a sign-up by phone is matched on. The typed value
 * stays as it was. */
/// numbered({ entity: { eid: 'a' }, individual: { phone: '(555) 555-0100' } }).phone -> { number: '+15555550100' }
export let numbered = (row: Bundle): Bundle => {
  let individual = fields(row, 'individual')
  return !dead(row) && Object.hasOwn(individual, 'phone')
    ? {
      ...row,
      phone: { ...fields(row, 'phone'), number: number(individual.phone) },
    }
    : row
}

/**
 * What `values` adds to `row`'s `comp`: a property it has no value for, and
 * to a list, the items it lacks. A value already there is never replaced, so
 * a sign-up fills a person's blanks and leaves what the app wrote.
 */
export let filled = (
  vocab: Vocab,
  comp: string,
  row: Bundle,
  values: Record<string, unknown>,
): Bundle => {
  let held = fields(row, comp)
  let patch = Object.fromEntries(
    Object.entries(values).flatMap(([k, v]): [string, unknown][] => {
      if (!vocab.props(comp).includes(k) || empty(v)) return []
      if (!vocab.prop(comp, k)?.types?.includes('array')) {
        return empty(held[k]) ? [[k, v]] : []
      }
      let had = Array.isArray(held[k]) ? held[k] as unknown[] : []
      let more = [v].flat().filter((x) =>
        !empty(x) && !had.some((h) => same(h, x))
      )
      return more.length ? [[k, [...had, ...more]]] : []
    }),
  )
  let out = { entity: row.entity, [comp]: patch }
  return comp == 'individual' ? numbered(out) : out
}

const tail = /^(.+?),?\s+([A-Za-z]{2})\.?\s+(\d{5}(?:-\d{4})?)$/
const state = /^([A-Za-z]{2})\.?\s+(\d{5}(?:-\d{4})?)$/

/** A typed postal address as a household's parts: its last line read as
 * "City, ST 12345" where it reads so, its first line as the street and any
 * between as the second. What does not read so stays in the street lines. */
/// address('12 Elm St\nSpringfield, il 62704') -> { street: '12 Elm St', city: 'Springfield', region: 'IL', postal: '62704' }
export let address = (text: unknown): Record<string, string> => {
  let split = (s: string, by: string | RegExp) =>
    s.split(by).map((l) => l.trim()).filter(Boolean)
  let lines = split(typeof text == 'string' ? text : '', '\n')
  if (lines.length == 1) lines = split(lines[0], ',')
  let last = lines.at(-1) ?? '', end = last.match(tail)
  let short = !end && lines.length > 2 ? last.match(state) : null
  let place = end
    ? { city: end[1], region: end[2], postal: end[3], rest: lines.slice(0, -1) }
    : short
    ? {
      city: lines.at(-2)!,
      region: short[1],
      postal: short[2],
      rest: lines.slice(0, -2),
    }
    : { rest: lines }
  let { rest, ...where } = place
  let [street, ...more] = rest
  return Object.fromEntries(
    Object.entries({
      street,
      street2: more.join(', '),
      ...where,
      region: where.region?.toUpperCase(),
    }).filter(([, v]) => !empty(v)),
  ) as Record<string, string>
}

/**
 * Whether `row` may be the person `values` describe, as far as names go. Two
 * people may share a phone or an email (a couple, a household line), so a
 * contact alone does not make a sign-up someone's: the first names must not
 * disagree either, allowing for a short form of the name (Matt, Matthew).
 */
/// alike({ entity: { eid: 'a' }, individual: { first: 'Matthew' } }, { first: 'matt' }) -> true
/// alike({ entity: { eid: 'a' }, individual: { first: 'Ann' } }, { first: 'Bo' }) -> false
export let alike = (row: Bundle, values: Record<string, unknown>): boolean => {
  let held = folded(fields(row, 'individual').first),
    given = folded(values.first)
  return !held || !given || held.startsWith(given) || given.startsWith(held)
}

/** Whether `row` is the relative `values` describe: the first name agrees,
 * and the last name and birthday agree wherever both sides have one. */
/// named({ entity: { eid: 'a' }, individual: { first: 'Bo', born: '2019-01-02' } }, { first: 'bo' }) -> true
/// named({ entity: { eid: 'a' }, individual: { first: 'Bo', born: '2019-01-02' } }, { first: 'Bo', born: '2020-01-02' }) -> false
export let named = (row: Bundle, values: Record<string, unknown>): boolean => {
  let held = fields(row, 'individual')
  return !!folded(values.first) &&
    ['first', 'last', 'born'].every((prop) =>
      !folded(held[prop]) || !folded(values[prop]) ||
      folded(held[prop]) == folded(values[prop])
    )
}

/** Of `candidates`, the person a phone, an address and a first name belong
 * to: one whose name is {@link alike}, wearing the phone, else listing the
 * address. */
export let matching = (
  candidates: Bundle[],
  values: Record<string, unknown>,
): Bundle | undefined => {
  let phone = number(values.phone), email = folded(values.email)
  let fits = candidates.filter((b) => alike(b, values))
  return fits.find((b) =>
    phone && number(fields(b, 'phone').number) == phone
  ) ??
    fits.find((b) => email && folded(fields(b, 'individual').email) == email)
}

/** The lines a store is read with for the people a phone or an address may
 * belong to: whoever wears the number, and in a store that {@link speaks}
 * `individual`, whoever lists the address. */
export let seeking = (
  vocab: Vocab,
  { phone, email }: { phone?: string | null; email?: string | null },
): string[] => {
  let number = phone && e164(phone), address = folded(email)
  let people = speaks(vocab, 'individual')
  return [
    ...number ? [`.phone.number=${quoted(number)}&*`] : [],
    ...address && people
      ? [`.individual.email~=${quoted(address)}&?phone`]
      : [],
  ]
}

/**
 * Who the proved phone and address belong to among rows read by
 * {@link seeking}: a living person wearing the number, else one whose
 * `individual.email` lists the address. Only what the platform proved is
 * theirs should be passed, never a typed answer.
 */
export let whose = (
  rows: Bundle[],
  { phone, email }: { phone?: string | null; email?: string | null },
): Bundle | undefined => {
  let number = phone && e164(phone), address = folded(email)
  return rows.find((row) =>
    living(row) && !!number && fields(row, 'phone').number == number
  ) ?? rows.find((row) =>
    living(row) && !!address &&
    addresses(fields(row, 'individual').email).includes(address)
  )
}
