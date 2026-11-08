// A registration and the directory changes it entails settle in one write.
import { answered, type Answers, type Form, type Question } from '@yaks/forms'
import { after } from '@yaks/fp'
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
      let person = async (eid: string): Promise<Bundle | undefined> => {
        let [held] = await tx.get([eid], ['individual', 'phone'])
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
      }
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
      let match = async (values: Record<string, unknown>, except: string) => {
        let phone = number(values.phone), address = email(values.email)
        let lines = [
          ...phone ? [`.individual&.phone.number=${quoted(phone)}&*`] : [],
          ...address ? [`.individual.email~=${quoted(address)}&?phone`] : [],
        ]
        let loaded = (await Promise.all(lines.map((q) => tx.read(q)))).flat()
        let ids = [
          ...new Set([...written.keys(), ...loaded.map((b) => b.entity.eid)]),
        ]
        let candidates = (await Promise.all(
          ids.filter((id) => id != except).map(person),
        ))
          .filter((b): b is Bundle => !!b)
        return candidates.find((b) =>
          phone && number(fields(b, 'phone').number) == phone
        ) ??
          candidates.find((b) =>
            address && email(fields(b, 'individual').email) == address
          )
      }
      let register = async (patch: Bundle) => {
        let [before] = await tx.get([patch.entity.eid], ['registration'])
        let registration = {
          ...fields(before, 'registration'),
          ...fields(patch, 'registration'),
        }
        if (!registration.form) return
        let rows = await tx.read(
          `.question.form=${quoted(String(registration.form))}`,
        )
        let form: Form = { form: {}, questions: rows as Question[] }
        let answers = registration.answers as Answers ?? {}
        let groups = new Map<
          string,
          { path: (string | number)[]; values: Record<string, unknown> }
        >()
        groups.set('[]', { path: [], values: {} })
        let contacts = new Map<string, Record<string, unknown>>()
        for (let { question, path, value } of answered(form, answers)) {
          let prop = question.question.fills?.match(/^individual\.([a-z_]+)$/)
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
        for (
          let [key, { path, values }] of [...groups].sort((a, b) =>
            a[1].path.length - b[1].path.length
          )
        ) {
          let eid = !path.length && typeof registration.person == 'string'
            ? registration.person
            : guest(patch.entity.eid, path)
          let provisional = guest(patch.entity.eid, [])
          let held = await person(eid)
          let found = !path.length && (!held || eid == provisional)
            ? await match({ ...values, ...contacts.get(key) }, provisional) ??
              held
            : held
          let who = found ??
            { entity: { eid }, individual: { status: 'guest' } }
          if (!found) save(who)
          save(fill(vocab, who, values))
          parents.set(key, who.entity.eid)
          if (!path.length) {
            out.push({
              entity: patch.entity,
              registration: { person: who.entity.eid },
            })
            if (eid == provisional && held && who.entity.eid != eid) {
              let refs = await tx.read(`.refs=${quoted(eid)}&*`)
              let owned = refs.every((r) =>
                r.entity.eid == patch.entity.eid ||
                fields(r, 'relation').kind == 'parent' &&
                  fields(r, 'relation').a == eid
              )
              if (owned) {
                out.push(
                  ...refs.filter((r) => r.relation).map((r) => ({
                    entity: r.entity,
                    relation: { a: who.entity.eid },
                  })),
                )
                out.push({ entity: { eid }, $delete: true })
                written.delete(eid)
              }
            }
          } else {
            let parent = parents.get(JSON.stringify(path.slice(0, -2))) ??
              parents.get('[]')!
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
              relation: { kind: 'parent', a: parent, b: who.entity.eid },
            })
          }
        }
      }
      let registrations = vocab.comp('registration') && vocab.comp('question')
        ? bundles.filter((b) => b.registration && !dead(b))
        : []
      if (!registrations.length) return out.map(directoryPhone)
      return after(
        registrations.reduce(
          (done, b) => done.then(() => register(b)),
          Promise.resolve(),
        ),
        () => out.map(directoryPhone),
      )
    }),
  },
})
