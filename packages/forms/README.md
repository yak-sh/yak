# @yaks/forms

Form, question and registration rows, with pure functions for question progress
and sign-up availability. The caller supplies the rows, answers, time and count;
these functions read no storage and perform no effects.

A **question** is a graph bundle with `entity.eid` and
`question{form, label,
kind, …}`. A **form** passed to the core contains its
`form` component and the loaded `questions` belonging to it. **Answers** are
keyed by question eid.

```ts
import { type Form, missing, next, open } from '@yaks/forms'
import { equal } from '@yaks/testing'

let form: Form = {
  form: { capacity: 20 },
  questions: [{
    entity: { eid: 'name' },
    question: {
      form: 'signup',
      label: 'Your name',
      kind: 'line',
      required: true,
    },
  }],
}
equal(next(form, {})?.path, ['name'])
equal(missing(form, { name: 'Sam' }), [])
equal(next(form, { name: 'Sam' }), undefined)
equal(open(form, Date.parse('2026-11-08T12:00:00Z'), 19), true)
equal(open(form, Date.parse('2026-11-08T12:00:00Z'), 20), false)
```

## Components

Load `formsDoc` from `@yaks/forms/vocab` beside `kernelDoc` from
`@yaks/kernel/vocab`, which declares the shared completion and cancellation
marks. Add `doc{title, body}` to a form for its title and introduction.

| Component      | Properties                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------ |
| `form`         | `opens`, `closes`, `capacity`, `thanks`, `notify`                                          |
| `question`     | `form`, `label`, `kind`, `choices`, `required`, `hint`, `within`, `when`, `fills`, `order` |
| `registration` | `form`, `person`, `answers`, `at`                                                          |
| `waitlisted`   | stamped `at`, `by`, `via`                                                                  |

Question kinds are `line`, `lines`, `choose`, `choices`, `check`, `date`,
`email`, `phone`, `address`, `file` and `repeat`. `fills` names a directory
property, such as `individual.born`; the core performs no directory writes.
`notify` lists recipient entity ids; delivery belongs to the caller.

Registration state comes from marks. `registration.status` is `cancelled` when
it carries `cancelled{at, by, via, reason}`, then `waitlisted` when it carries
`waitlisted{at, by, via}`, then `done` when it carries `completed{at, by, via}`,
otherwise `open`. `registration.answers` holds answers; no separate answer
component is declared. The core reports missing answers and does not write
marks.

## Question progress

`missing(form, answers)` returns required questions still owed.
`next(form, answers)` returns the first required question owed, then the first
optional question owed, or `undefined`. Each result is `{question, path}`:
`question` is the question bundle, and `path` locates its answer inside
`registration.answers`. Order is ascending `question.order` (absent is zero),
then entity eid for ties. The functions never mutate their inputs.

A blank string, null, absent value or empty array leaves a required answer
missing. `false` and `0` are answers. Set an optional answer to `null` to skip
it; deleting its key makes it owed again. These are progress checks; callers
validate answer values for their question kinds.

`when{question, is}` compares an earlier answer by value, including arrays and
objects. A hidden question's answer cannot activate another question. Within a
repeat entry, the comparison looks in that entry first, then its outer entries,
then the top-level answers. Questions below a hidden repeat are hidden too.

A repeat answer is an array of answer objects. Its children have
`question.within` set to the repeat question's eid. Missing or skipped optional
repeats owe no child answers; populated optional repeats owe their required
children. A required repeat needs at least one entry. For an answer such as
`{children: [{born: '2020-01-02'}, {}]}`, a missing second birth date has the
path `['children', 1, 'born']`. Nested repeats use the same structure. An empty
array answers an optional repeat without entries; null skips it.

## Availability

`open(form, now, count)` takes an epoch-millisecond instant and the caller's
accepted-registration count. Opening is inclusive, closing exclusive, and
capacity is reached when `count >= capacity`. Absent dates or capacity impose no
limit; zero capacity accepts nobody. Invalid dates or a non-finite instant
return false. This package implements no HTTP door, rendering, tools or
registration side effects.
