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

let fill = (
  vocab: Vocab,
  person: Bundle,
  values: Record<string, unknown>,
): Bundle => {
  let held = fields(person, 'individual')
  let props = vocab.props('individual')
  let patch = Object.fromEntries(
    Object.entries(values).filter(([k, v]) =>
      props.includes(k) && empty(held[k]) && !empty(v)
    ),
  )
  return directoryPhone({ entity: person.entity, individual: patch })
}

// The path, including the repeat index, makes retries and partial answers find
// the same guest again. It does not identify people across registrations.
let guest = (registration: string, path: (string | number)[]) =>
  derivedEid(JSON.stringify(['registration-person', registration, path]))

// Only a guest entirely represented by these answers is disposable. An editor
// may have added directory details or notes while the sign-up was unfinished.
let captured = (row: Bundle, values: Record<string, unknown>) =>
  Object.keys(row).every((name) =>
    ['entity', 'individual', 'phone', 'created', 'updated'].includes(name)
  ) && Object.entries(fields(row, 'individual')).every(([prop, value]) =>
    prop == 'status' ? value == 'guest' : same(value, values[prop])
  ) && Object.entries(fields(row, 'phone')).every(([prop, value]) =>
    prop == 'number' && same(value, number(values.phone))
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

export let directoryForms = (vocab: Vocab): Plugin => ({
  name: 'yak/form-directory',
  admission: () => true,
  hooks: {
    rules: hook(['registration', 'individual'], (bundles, tx) => {
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
              (candidates) =>
                candidates.find((b) =>
                  phone && number(fields(b, 'phone').number) == phone
                ) ?? candidates.find((b) =>
                  address && email(fields(b, 'individual').email) == address
                ),
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
      let register = (patch: Bundle) =>
        after(tx.get([patch.entity.eid], ['registration']), ([before]) => {
          let registration = {
            ...fields(before, 'registration'),
            ...fields(patch, 'registration'),
          }
          if (!registration.form) return
          return after(
            tx.read(
              `.question.form=${quoted(String(registration.form))}`,
            ),
            (rows) => {
              let form: Form = { form: {}, questions: rows as Question[] }
              let answers = registration.answers as Answers ?? {}
              let groups = new Map<
                string,
                { path: (string | number)[]; values: Record<string, unknown> }
              >()
              groups.set('[]', { path: [], values: {} })
              let contacts = new Map<string, Record<string, unknown>>()
              for (let { question, path, value } of answered(form, answers)) {
                let prop = question.question.fills?.match(
                  /^individual\.([a-z_]+)$/,
                )
                  ?.[1]
                let scope = path.slice(0, -1), key = JSON.stringify(scope)
                let kind = question.question.kind
                if (kind == 'phone' || kind == 'email') {
                  contacts.set(key, { ...contacts.get(key), [kind]: value })
                }
                if (!prop) continue
                let group = groups.get(key) ?? { path: scope, values: {} }
                group.values[prop] = value
                groups.set(key, group)
              }
              let parents = new Map<string, string>()
              let taken = new Set<string>()
              return each(
                [...groups].sort((a, b) => a[1].path.length - b[1].path.length),
                undefined as void,
                (_, [key, { path, values }]) => {
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
                          { entity: { eid }, individual: { status: 'guest' } }
                        if (!found) save(who)
                        save(fill(vocab, who, values))
                        parents.set(key, who.entity.eid)
                        taken.add(who.entity.eid)
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
                                if (owned && captured(held, values)) {
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
                                }
                              },
                            )
                          }
                        } else if (rel && !matched) {
                          out.push({
                            entity: {
                              eid: derivedEid(
                                JSON.stringify([
                                  'registration-parent',
                                  patch.entity.eid,
                                  path,
                                ]),
                              ),
                            },
                            relation: {
                              kind: rel.kind,
                              [rel.entry]: who.entity.eid,
                              [other(rel.entry)]: outer,
                            },
                          })
                        }
                        return undefined
                      },
                    ))
                },
              )
            },
          )
        })
      let registrations = vocab.comp('registration') && vocab.comp('question')
        ? bundles.filter((b) => b.registration && !dead(b))
        : []
      if (!registrations.length) return out.map(directoryPhone)
      return after(
        each(registrations, undefined as void, (_, b) => register(b)),
        () => out.map(directoryPhone),
      )
    }),
  },
})
