// A registration and the directory changes it entails settle in one write.
import { answered, type Answers, type Form, type Question } from '@yaks/forms'
import { after, each, same } from '@yaks/fp'
import {
  type Bundle,
  type Comp,
  dead,
  derivedEid,
  hook,
  type Plugin,
} from '@yaks/graph'
import { e164 } from '@yaks/phone/mobile'
import type { Vocab } from '@yaks/vocab'

let fields = (row: Bundle | undefined, name: string): Comp =>
  row?.[name] as Comp ?? {}
let empty = (v: unknown) => v == null || typeof v == 'string' && !v.trim()
let email = (v: unknown) => typeof v == 'string' ? v.trim().toLowerCase() : ''
let number = (v: unknown) => typeof v == 'string' ? e164(v) : null
let quoted = (v: string) => JSON.stringify(v)

/** Mirror a directory phone without changing the person's typed value. */
export let directoryPhone = (row: Bundle): Bundle => {
  let individual = fields(row, 'individual')
  return !dead(row) && Object.hasOwn(individual, 'phone')
    ? {
      ...row,
      phone: { ...fields(row, 'phone'), number: number(individual.phone) },
    }
    : row
}

// What `values` adds to `row`'s `comp`: a property it has no value for, and
// to a list, the items it lacks.
let fill = (
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
  return comp == 'individual' ? directoryPhone(out) : out
}

const tail = /^(.+?),?\s+([A-Za-z]{2})\.?\s+(\d{5}(?:-\d{4})?)$/
const state = /^([A-Za-z]{2})\.?\s+(\d{5}(?:-\d{4})?)$/

/** A typed postal address as a household's parts: its last line read as
 * "City, ST 12345" where it reads so, its first line as the street and any
 * between as the second. What does not read so stays in the street lines. */
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

// The path, including the repeat index, makes retries and partial answers find
// the same guest again. It does not identify people across registrations.
let guest = (registration: string, path: (string | number)[]) =>
  derivedEid(JSON.stringify(['registration-person', registration, path]))
let link = (registration: string, path: (string | number)[]) =>
  derivedEid(JSON.stringify(['registration-parent', registration, path]))
let home = (registration: string, path: (string | number)[]) =>
  derivedEid(JSON.stringify(['registration-household', registration, path]))

/** The eids of the people, households and relation rows a sign-up can have
 * created, each
 * derived from the sign-up and where in its answers the person stands. A row
 * the app wrote, or a person the sign-up matched, is at no such eid. */
export let signedUp = (
  registration: string,
  form: Form,
  answers: Answers,
): string[] => {
  let scopes = new Map<string, (string | number)[]>([['[]', []]])
  for (let { path } of answered(form, answers)) {
    scopes.set(JSON.stringify(path.slice(0, -1)), path.slice(0, -1))
  }
  return [...scopes.values()].flatMap((path) => [
    guest(registration, path),
    home(registration, path),
    ...path.length ? [link(registration, path)] : [],
  ])
}

// Only a guest entirely represented by these answers is disposable. An editor
// may have added directory details or notes while the sign-up was unfinished.
let only = (row: Bundle, names: string[]) =>
  Object.keys(row).every((name) =>
    [...names, 'entity', 'form_guest', 'created', 'updated'].includes(name)
  )
let captured = (
  row: Bundle,
  values: Record<string, unknown>,
  household: string,
) =>
  only(row, ['individual', 'phone']) &&
  Object.entries(fields(row, 'individual')).every(([prop, value]) =>
    prop == 'status'
      ? value == 'guest'
      : prop == 'household'
      ? value == household
      : same(value, values[prop])
  ) && Object.entries(fields(row, 'phone')).every(([prop, value]) =>
    prop == 'number' && same(value, number(values.phone))
  )
let housed = (row: Bundle | undefined, values: Record<string, unknown>) =>
  !!row && only(row, ['household']) &&
  Object.entries(fields(row, 'household')).every(([prop, value]) =>
    same(value, values[prop])
  )

// What a repeat's `relates` names each entry, as the directory relation that
// says so: the side the entry takes, and whether the relation reads both ways.
let kin: Record<
  string,
  { kind: string; entry: 'a' | 'b'; mutual?: boolean }
> = {
  child: { kind: 'parent', entry: 'b' },
  parent: { kind: 'parent', entry: 'a' },
  spouse: { kind: 'spouse', entry: 'b', mutual: true },
  sibling: { kind: 'sibling', entry: 'b', mutual: true },
}
type Kin = typeof kin[string]
let other = (side: 'a' | 'b') => side == 'a' ? 'b' : 'a'
let folded = (v: unknown) => typeof v == 'string' ? v.trim().toLowerCase() : ''

// Two people may share a phone or an email (a couple, a household line), so a
// contact alone does not make a sign-up someone's: the first names must not
// disagree either, allowing for a short form of the name (Matt, Matthew).
let alike = (row: Bundle, values: Record<string, unknown>) => {
  let held = folded(fields(row, 'individual').first),
    given = folded(values.first)
  return !held || !given || held.startsWith(given) || given.startsWith(held)
}

// An entry is a relative already listed when the first name agrees, and the
// last name and birthday agree wherever both sides have one.
let named = (row: Bundle, values: Record<string, unknown>) => {
  let held = fields(row, 'individual')
  return !!folded(values.first) &&
    ['first', 'last', 'born'].every((prop) =>
      !folded(held[prop]) || !folded(values[prop]) ||
      folded(held[prop]) == folded(values[prop])
    )
}

// What a sign-up's directory work reads of it: a sign-up held for a bot's
// fills nothing until it is accepted, which takes the mark away.
let READ = ['registration', 'held']

export let directoryForms = (vocab: Vocab): Plugin => ({
  name: 'yak/form-directory',
  admission: () => true,
  hooks: {
    rules: hook(['registration', 'individual', 'held'], (bundles, tx) => {
      let out = [...bundles]
      let written = new Map(
        bundles.filter((b) => b.individual && !dead(b))
          .map((b) => [b.entity.eid, directoryPhone(b)]),
      )
      let person = (
        eid: string,
      ): Bundle | undefined | Promise<Bundle | undefined> =>
        after(tx.get([eid]), ([held]) => {
          let patch = written.get(eid)
          return patch
            ? {
              ...held,
              ...patch,
              individual: {
                ...fields(held, 'individual'),
                ...fields(patch, 'individual'),
              },
            }
            : held?.individual && !dead(held)
            ? held
            : undefined
        })
      let save = (row: Bundle) => {
        let was = written.get(row.entity.eid)
        written.set(row.entity.eid, {
          ...was,
          ...row,
          individual: {
            ...fields(was, 'individual'),
            ...fields(row, 'individual'),
          },
        })
        out.push(row)
      }
      let match = (values: Record<string, unknown>, except: string) => {
        let phone = number(values.phone), address = email(values.email)
        let lines = [
          ...phone ? [`.individual&.phone.number=${quoted(phone)}&*`] : [],
          ...address ? [`.individual.email~=${quoted(address)}&?phone`] : [],
        ]
        return after(
          each(
            lines,
            [] as Bundle[],
            (rows, q) => after(tx.read(q), (loaded) => [...rows, ...loaded]),
          ),
          (loaded) => {
            let ids = [
              ...new Set([
                ...written.keys(),
                ...loaded.map((b) => b.entity.eid),
              ]),
            ].filter((id) => id != except)
            return after(
              each(
                ids,
                [] as Bundle[],
                (rows, eid) =>
                  after(person(eid), (row) => row ? [...rows, row] : rows),
              ),
              (candidates) => {
                let fits = candidates.filter((b) => alike(b, values))
                return fits.find((b) =>
                  phone && number(fields(b, 'phone').number) == phone
                ) ?? fits.find((b) =>
                  address && email(fields(b, 'individual').email) == address
                )
              },
            )
          },
        )
      }
      // The people already related to `outer` as `rel` says.
      let relatives = (rel: Kin, outer: string) =>
        after(
          each(
            rel.mutual ? ['a', 'b'] as const : [rel.entry],
            [] as string[],
            (ids, side) =>
              after(
                tx.read(
                  `.relation.kind=${quoted(rel.kind)}&.relation.${
                    other(side)
                  }=${quoted(outer)}`,
                ),
                (rows) => [
                  ...ids,
                  ...rows.map((r) => String(fields(r, 'relation')[side])),
                ],
              ),
          ),
          (ids) =>
            each(
              [...new Set(ids)].filter((id) => id != outer),
              [] as Bundle[],
              (rows, eid) =>
                after(person(eid), (row) => row ? [...rows, row] : rows),
            ),
        )
      // Fill the household `eid` lives in with `house`, making them one at
      // the sign-up's `path` when they have none.
      let lodge = (
        eid: string,
        house: Record<string, unknown>,
        registration: string,
        path: (string | number)[],
      ) =>
        !vocab.comp('household') || !Object.keys(house).length
          ? undefined
          : after(person(eid), (row) => {
            let held = fields(row, 'individual').household
            let id = typeof held == 'string' ? held : home(registration, path)
            return after(tx.get([id]), ([found]) => {
              let alive = found?.household && !dead(found) ? found : undefined
              let patch = fill(
                vocab,
                'household',
                alive ?? { entity: { eid: id } },
                house,
              )
              let fills = Object.keys(fields(patch, 'household')).length
              if (!alive && !fills) return
              if (fills) {
                out.push(
                  alive ? patch : { ...patch, form_guest: { registration } },
                )
              }
              if (held != id) {
                save({ entity: { eid }, individual: { household: id } })
              }
            })
          })
      let register = (patch: Bundle) =>
        after(tx.get([patch.entity.eid], READ), ([before]) => {
          let registration = {
            ...fields(before, 'registration'),
            ...fields(patch, 'registration'),
          }
          let held = patch.held === undefined ? before?.held : patch.held
          if (!registration.form || held) return
          return after(
            tx.read(
              `.question.form=${quoted(String(registration.form))}`,
            ),
            (rows) => {
              let form: Form = { form: {}, questions: rows as Question[] }
              let answers = registration.answers as Answers ?? {}
              type Group = {
                path: (string | number)[]
                values: Record<string, unknown>
                house: Record<string, unknown>
                aspects: Record<string, Record<string, unknown>>
              }
              let groups = new Map<string, Group>()
              let start = (path: (string | number)[]): Group => ({
                path,
                values: {},
                house: {},
                aspects: {},
              })
              groups.set('[]', start([]))
              let contacts = new Map<string, Record<string, unknown>>()
              for (let { question, path, value } of answered(form, answers)) {
                let [comp, prop, ...more] =
                  question.question.fills?.split('.') ?? []
                let scope = path.slice(0, -1), key = JSON.stringify(scope)
                let kind = question.question.kind
                if (kind == 'phone' || kind == 'email') {
                  contacts.set(key, { ...contacts.get(key), [kind]: value })
                }
                if (more.length) continue
                let group = groups.get(key) ?? start(scope)
                if (comp == 'individual' && prop) group.values[prop] = value
                else if (comp == 'household' && prop) group.house[prop] = value
                else if (comp == 'household' && kind == 'address') {
                  Object.assign(group.house, address(value))
                } else if (
                  comp && prop && vocab.comp(comp) &&
                  !vocab.identity(comp).length
                ) {
                  // Another component on the person, such as one kept from
                  // the directory's members (`shown`). One identified by its
                  // properties, as `sms_consent` is, stands on its own entity.
                  group.aspects[comp] = {
                    ...group.aspects[comp],
                    [prop]: value,
                  }
                } else continue
                groups.set(key, group)
              }
              let parents = new Map<string, string>()
              let taken = new Set<string>()
              return each(
                [...groups].sort((a, b) => a[1].path.length - b[1].path.length),
                undefined as void,
                (_, [key, { path, values, house, aspects }]) => {
                  let eid =
                    !path.length && typeof registration.person == 'string'
                      ? registration.person
                      : guest(patch.entity.eid, path)
                  let provisional = guest(patch.entity.eid, [])
                  let outer = path.length
                    ? parents.get(JSON.stringify(path.slice(0, -2))) ??
                      parents.get('[]')!
                    : ''
                  let rel = path.length
                    ? kin[
                      String(
                        form.questions.find((q) => q.entity.eid == path.at(-2))
                          ?.question.relates,
                      )
                    ]
                    : undefined
                  // A listed relative is found again rather than copied.
                  let relative = (held: Bundle | undefined) =>
                    held || !rel ? undefined : after(
                      relatives(rel, outer),
                      (listed) =>
                        listed.find((b) =>
                          !taken.has(b.entity.eid) && named(b, values)
                        ),
                    )
                  // What the sign-up's person, now `who`, entails: the
                  // sign-up names them, a provisional guest they turned out
                  // to be is folded into them, and a repeat entry is related
                  // to the person it is listed under.
                  let settle = (
                    who: Bundle,
                    matched: Bundle | undefined,
                    held: Bundle | undefined,
                  ) => {
                    if (!path.length) {
                      out.push({
                        entity: patch.entity,
                        registration: { person: who.entity.eid },
                      })
                      if (
                        eid == provisional && held && who.entity.eid != eid
                      ) {
                        return after(
                          tx.read(`.refs=${quoted(eid)}&*`),
                          (refs) => {
                            let side = (r: Bundle) =>
                              (['a', 'b'] as const).find((s) =>
                                fields(r, 'relation')[s] == eid
                              )
                            let owned = refs.every((r) =>
                              r.entity.eid == patch.entity.eid || side(r)
                            )
                            let derived = home(patch.entity.eid, [])
                            if (owned && captured(held, values, derived)) {
                              out.push(
                                ...refs.filter((r) => r.relation).map((
                                  r,
                                ) => ({
                                  entity: r.entity,
                                  relation: { [side(r)!]: who.entity.eid },
                                })),
                              )
                              out.push({ entity: { eid }, $delete: true })
                              written.delete(eid)
                              return after(
                                after(
                                  person(who.entity.eid),
                                  (row) =>
                                    fields(row, 'individual').household ==
                                        derived
                                      ? []
                                      : tx.get([derived]),
                                ),
                                ([left]) => {
                                  if (housed(left, house)) {
                                    out.push({
                                      entity: { eid: derived },
                                      $delete: true,
                                    })
                                  }
                                },
                              )
                            }
                          },
                        )
                      }
                    } else if (rel && !matched) {
                      out.push({
                        entity: { eid: link(patch.entity.eid, path) },
                        relation: {
                          kind: rel.kind,
                          [rel.entry]: who.entity.eid,
                          [other(rel.entry)]: outer,
                        },
                        form_guest: { registration: patch.entity.eid },
                      })
                    }
                    return undefined
                  }
                  return after(person(eid), (held) =>
                    after(
                      !path.length && (!held || eid == provisional)
                        ? match(
                          { ...values, ...contacts.get(key) },
                          provisional,
                        )
                        : relative(held),
                      (matched) => {
                        let found = matched ?? held
                        let who = found ??
                          {
                            entity: { eid },
                            individual: { status: 'guest' },
                            form_guest: { registration: patch.entity.eid },
                          }
                        if (!found) save(who)
                        save(fill(vocab, 'individual', who, values))
                        for (let [comp, props] of Object.entries(aspects)) {
                          let row = fill(vocab, comp, who, props)
                          if (Object.keys(fields(row, comp)).length) save(row)
                        }
                        parents.set(key, who.entity.eid)
                        taken.add(who.entity.eid)
                        return after(
                          lodge(who.entity.eid, house, patch.entity.eid, path),
                          () => settle(who, matched, held),
                        )
                      },
                    ))
                },
              )
            },
          )
        })
      let registrations = vocab.comp('registration') && vocab.comp('question')
        ? bundles.filter((b) => (b.registration || b.held === null) && !dead(b))
        : []
      if (!registrations.length) return out.map(directoryPhone)
      return after(
        each(registrations, undefined as void, (_, b) => register(b)),
        () => out.map(directoryPhone),
      )
    }),
  },
})
