// Form progress and availability over supplied rows and answers. The caller
// loads the rows and supplies the time and registration count.

import { same } from '@yaks/fp'

/** The kinds a question can ask. */
export type Kind =
  | 'line'
  | 'lines'
  | 'choose'
  | 'choices'
  | 'check'
  | 'date'
  | 'email'
  | 'phone'
  | 'address'
  | 'file'
  | 'repeat'

/** The stored properties of a form. Absent limits impose no restriction. */
export type Settings = {
  opens?: string
  closes?: string
  capacity?: number
  thanks?: string
  closed?: string
  notify?: readonly string[]
}

/** A question row, retaining its entity id as the answer's key. */
export type Question = {
  entity: { eid: string }
  question: {
    form: string
    label: string
    kind: Kind
    choices?: readonly string[]
    required?: boolean
    hint?: string
    within?: string
    when?: { question: string; is: unknown }
    fills?: string
    order?: number
  }
}

/** A form's component together with its loaded question rows. */
export type Form = { form: Settings; questions: readonly Question[] }

/** Answers keyed by question eid; a repeat answer is an array of Answers. */
export type Answers = Readonly<Record<string, unknown>>

/** Native controls named by answer path, decoded using their question kinds.
 * Repeat indices order entries; omitted controls have no answer. */
export let posted = (form: Form, fields: URLSearchParams): Answers => {
  let read = (within?: string, prefix = ''): Answers =>
    Object.fromEntries(
      form.questions.filter((q) => q.question.within == within)
        .flatMap<[string, unknown]>(({ entity: { eid }, question: q }) => {
          let name = prefix + eid
          if (q.kind == 'repeat') {
            let indices = [
              ...new Set([...fields.keys()].flatMap((key) => {
                if (!key.startsWith(name + '.')) return []
                let index = key.slice(name.length + 1).split('.')[0]
                return /^(0|[1-9]\d*)$/.test(index) ? [index] : []
              })),
            ].sort((a, b) => Number(a) - Number(b))
            return indices.length
              ? [[eid, indices.map((i) => read(eid, `${name}.${i}.`))]]
              : []
          }
          let values = fields.getAll(name).map((v) =>
            q.kind == 'check' && v == 'true' ? true : v
          )
          return values.length
            ? [[
              eid,
              q.kind == 'choices' || values.length > 1 ? values : values[0],
            ]]
            : []
        }),
    )
  return kept(form, read())
}

/** An unanswered question and its path into registration.answers. */
export type Owed = { question: Question; path: (string | number)[] }

let filled = (value: unknown): boolean =>
  value != null &&
  (typeof value != 'string' || value.trim() != '') &&
  (!Array.isArray(value) || value.length > 0)

let scope = (value: unknown): Answers =>
  value != null && typeof value == 'object' && !Array.isArray(value)
    ? value as Answers
    : {}

let visible = (
  q: Question,
  scopes: readonly Answers[],
  questions: readonly Question[],
  seen: readonly string[] = [],
): boolean => {
  let when = q.question.when
  if (!when) return true
  if (seen.includes(q.entity.eid)) return false
  let source = questions.find((q) => q.entity.eid == when.question)
  if (!source || !visible(source, scopes, questions, [...seen, q.entity.eid])) {
    return false
  }
  let answers = scopes.find((answers) => Object.hasOwn(answers, when.question))
  return answers != null && same(answers[when.question], when.is)
}

let ordered = (questions: readonly Question[]): Question[] =>
  [...questions].sort((a, b) =>
    (a.question.order ?? 0) - (b.question.order ?? 0) ||
    (a.entity.eid < b.entity.eid ? -1 : a.entity.eid > b.entity.eid ? 1 : 0)
  )

let owed = (
  questions: readonly Question[],
  scopes: readonly Answers[],
  within?: string,
  path: (string | number)[] = [],
): Owed[] =>
  questions.filter((q) =>
    q.question.within == within && visible(q, scopes, questions)
  )
    .flatMap((q): Owed[] => {
      let key = q.entity.eid, value = scopes[0][key], here = [...path, key]
      if (q.question.kind == 'repeat') {
        return Array.isArray(value) && (value.length || !q.question.required)
          ? value.flatMap((item, i) =>
            owed(questions, [scope(item), ...scopes], key, [...here, i])
          )
          : value === null && !q.question.required
          ? []
          : [{ question: q, path: here }]
      }
      return filled(value) || (value === null && !q.question.required)
        ? []
        : [{ question: q, path: here }]
    })

/** Required visible questions still unanswered, including each repeat entry. */
export let missing = (form: Form, answers: Answers): Owed[] =>
  owed(ordered(form.questions), [answers]).filter((q) =>
    q.question.question.required
  )

/** The next visible question owed: required first, then optional; null skips
 * an optional question. Returns undefined when none remain. */
export let next = (form: Form, answers: Answers): Owed | undefined => {
  let pending = owed(ordered(form.questions), [answers])
  return pending.find((q) => q.question.question.required) ?? pending[0]
}

/** Visible answered questions, retaining their location within repeat entries. */
export let answered = (
  form: Form,
  answers: Answers,
): (Owed & { value: unknown })[] => {
  let questions = ordered(form.questions)
  let walk = (
    scopes: readonly Answers[],
    within?: string,
    path: (string | number)[] = [],
  ): (Owed & { value: unknown })[] =>
    questions.filter((q) =>
      q.question.within == within && visible(q, scopes, questions)
    ).flatMap((q) => {
      let value = scopes[0][q.entity.eid], here = [...path, q.entity.eid]
      return q.question.kind == 'repeat'
        ? Array.isArray(value)
          ? value.flatMap((item, i) =>
            walk([scope(item), ...scopes], q.entity.eid, [...here, i])
          )
          : []
        : filled(value)
        ? [{ question: q, path: here, value }]
        : []
    })
  return walk([answers])
}

/** A visible question where it stands in the answers; a repeat also holds
 * each entry's visible questions, one list per entry answered so far. */
export type Asked = Owed & { entries?: Asked[][] }

let shown = (
  questions: readonly Question[],
  scopes: readonly Answers[],
  within?: string,
  path: (string | number)[] = [],
): Asked[] =>
  questions.filter((q) =>
    q.question.within == within && visible(q, scopes, questions)
  ).map((q) => {
    let key = q.entity.eid, value = scopes[0][key], here = [...path, key]
    return q.question.kind == 'repeat'
      ? {
        question: q,
        path: here,
        entries: (Array.isArray(value) ? value : []).map((item, i) =>
          shown(questions, [scope(item), ...scopes], key, [...here, i])
        ),
      }
      : { question: q, path: here }
  })

/** The questions to ask now, in order: what a form shows for these answers. */
export let asked = (form: Form, answers: Answers): Asked[] =>
  shown(ordered(form.questions), [answers])

/** The answers to visible questions only, so an answer given before its
 * question was hidden is not sent. */
export let kept = (form: Form, answers: Answers): Answers => {
  let keep = (asked: Asked[], scope: Answers): Answers =>
    Object.fromEntries(
      asked.filter((a) => Object.hasOwn(scope, a.question.entity.eid))
        .map((a) => {
          let key = a.question.entity.eid, value = scope[key]
          return [
            key,
            a.entries && Array.isArray(value)
              ? a.entries.map((entry, i) =>
                keep(entry, value[i] as Answers ?? {})
              )
              : value,
          ]
        }),
    )
  return keep(asked(form, answers), answers)
}

/** Whether sign-ups are accepted at this instant and registration count.
 * Opening is inclusive, closing exclusive; an invalid date fails closed. */
export let open = (
  { form }: Pick<Form, 'form'>,
  now: number,
  count: number,
): boolean =>
  Number.isFinite(now) &&
  (form.opens == null || now >= Date.parse(form.opens)) &&
  (form.closes == null || now < Date.parse(form.closes)) &&
  (form.capacity == null || count < form.capacity)
