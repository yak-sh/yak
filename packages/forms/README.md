# @yaks/forms

Form, question and registration rows, with pure functions for question progress
and sign-up availability. The caller supplies the rows, answers, time and count;
these functions read no storage and perform no effects. The `./fill` export
adapts form rows and HTTP calls to the interface components in @yaks/ux.

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

| Component      | Properties                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| `form`         | `opens`, `closes`, `capacity`, `thanks`, `closed`, `notify`, `seen`, `shares`                                   |
| `question`     | `form`, `label`, `kind`, `choices`, `required`, `hint`, `within`, `when`, `fills`, `relates`, `shared`, `order` |
| `registration` | `form`, `person`, `answers`, `at`                                                                               |
| `shared`       | `form`, `registration`, `answers`, `at`                                                                         |
| `waitlisted`   | stamped `at`, `by`, `via`                                                                                       |

Question kinds are `line`, `lines`, `choose`, `choices`, `check`, `date`,
`email`, `phone`, `address`, `file` and `repeat`. `fills` names a directory
property, such as `individual.born`. On a repeat, `relates` says what each entry
is to the person it is listed under: `child`, `parent`, `spouse` or `sibling`,
and absent when the entries are no relation. The core performs no directory
writes. `notify` lists recipient entity ids; delivery belongs to the caller.
`seen` is the app page that shows a sign-up (`signups?id={id}`), which the alert
to those people links to.

Registration state comes from marks. `registration.status` is `cancelled` when
it carries `cancelled{at, by, via, reason}`, then `waitlisted` when it carries
`waitlisted{at, by, via}`, then `done` when it carries `completed{at, by, via}`,
otherwise `open`. `registration.answers` holds answers; no separate answer
component is declared. The core reports missing answers and does not write
marks.

A registration declares @yaks/member's `"readers": "editor"`: whatever the app's
access, only its owners and editors read one, so a `public` form's sign-ups, and
a members' directory's, stay with the people who run it rather than every
reader.

## What a sign-up shares

A sign-up stays with the people who run the app unless its sender chooses
otherwise. `form.shares{question, is}` names the question that asks, and the
answer that shares; `question.shared` marks the top-level questions whose
answers are shown. `shared(form, answers)` returns those answers when the
visible answer to `shares.question` is `shares.is`, and `undefined` otherwise.

The host writes them to a `shared{form, registration, answers, at}` row beside
the registration. It declares `"readers": "viewer"`: the app's viewers, editors
and owners read it, and a visitor holding no role does not, whatever the app's
access. Deleting the registration deletes it. A prayer form asking "Share with
our church or just the prayer team?" shows the church's members the request and
the name, and keeps the email with the team:

```ts
import { type Form, shared } from '@yaks/forms'
import { equal } from '@yaks/testing'

let ask = (eid: string, more = {}) => ({
  entity: { eid },
  question: { form: 'prayer', label: eid, kind: 'line' as const, ...more },
})
let prayer: Form = {
  form: { shares: { question: 'with', is: 'Our church' } },
  questions: [
    ask('with'),
    ask('request', { shared: true }),
    ask('first', { shared: true }),
    ask('email'),
  ],
}
let answers = { request: 'Healing', first: 'Ann', email: 'ann@example.org' }
equal(shared(prayer, { ...answers, with: 'Our church' }), {
  request: 'Healing',
  first: 'Ann',
})
equal(shared(prayer, { ...answers, with: 'Just the team' }), undefined)
```

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

## What a form shows

`asked(form, answers)` lists the visible questions in order, each with its
`path`. A repeat also holds `entries`: for each entry answered so far, that
entry's visible questions. A form drawn from `asked` shows exactly what `next`
and `missing` count. `kept(form, answers)` keeps only the answers to visible
questions, so an answer given before a later answer hid its question is not
sent.

```ts
import { asked, type Form, kept } from '@yaks/forms'
import { equal } from '@yaks/testing'

let ask = (eid: string, kind: 'line' | 'choose' | 'repeat', more = {}) => ({
  entity: { eid },
  question: { form: 'kids', label: eid, kind, ...more },
})
let form: Form = {
  form: {},
  questions: [
    ask('children', 'repeat', { required: true }),
    ask('name', 'line', { within: 'children' }),
    ask('allergic', 'choose', { within: 'children', order: 1 }),
    ask('allergies', 'line', {
      within: 'children',
      order: 2,
      when: { question: 'allergic', is: 'Yes' },
    }),
  ],
}
let answers = {
  children: [{ name: 'Ada', allergic: 'No', allergies: 'nuts' }],
}
equal(
  asked(form, answers)[0].entries?.[0].map((a) => a.path),
  [['children', 0, 'name'], ['children', 0, 'allergic']],
)
equal(kept(form, answers), { children: [{ name: 'Ada', allergic: 'No' }] })
```

## Availability

`open(form, now, count)` takes an epoch-millisecond instant and the caller's
accepted-registration count. Opening is inclusive, closing exclusive, and
capacity is reached when `count >= capacity`. Absent dates or capacity impose no
limit; zero capacity accepts nobody. Invalid dates or a non-finite instant
return false. While `open` is false a page shows `form.closed`. The core
implements no HTTP door, tools or registration side effects.

## Filling forms

`fill()` adapts form `question` rows to the kit's `Submit` and `Fields`,
providing question interpretation and calls to the app's form door. `at` is the
door's address: `./api/form/<alias>` in the page's own app, or another app's,
such as `/directory/api/form/kids-club`. The adapter reads the form with
`GET at`, which answers `{doc, form, open, questions}`, and posts `{answers}` to
the same address. An app adds a form by writing rows; its page writes no form
code.

```ts
import { h } from 'preact'
import { Submit, submitAt, submitOf } from '@yaks/ux'
import { type Door, fill } from '@yaks/forms/fill'
import { equal } from '@yaks/testing'

let door: Door = {
  doc: { title: 'Contact' },
  form: { thanks: 'Thanks, we’ll write back.' },
  open: true,
  questions: [{
    entity: { eid: 'name' },
    question: {
      form: 'contact',
      label: 'Your name',
      kind: 'line',
      required: true,
    },
  }],
}
let at = './api/form/contact'
let e = { entity: { eid: submitAt(at) }, Submit: { content: door } }
let tree = h(
  Submit<Door>,
  fill({
    at,
    e,
    onChange: (b) => e = b as typeof e,
    read: () => Promise.resolve(door),
  }),
)
equal(tree.props.at, at)
equal(submitOf<Door>(e).content?.doc?.title, 'Contact')
```

Pass a durable draft desk as `fill({…, drafts})`, or mount `tree` under `Ux`
with the host's `drafts`: answers are read from it and kept synchronously on
every change, including repeat entries and hidden follow-up answers. The page
graph keeps loading and send status, with `Submit.values` mirroring the draft
for readers; it is not the draft's source.

A connected page supplies its store client, person and scoped recovery storage
to the existing [draft desk](../draft/README.md). This binding needs the page's
live connection and host:

```ts ignore
import { h, render } from 'preact'
import { Ux } from '@yaks/ux'
import { desk } from '@yaks/draft'

let typed = desk(client, {
  by: () => person,
  stash: storage,
})
render(h(Ux, { host: { ...host, drafts: typed } }, tree), root)
// On page teardown, after unmounting:
// typed.close()
```

The draft place names the resolved absolute form door, so a reload, another tab
or another interface finds the same answers, and different apps' relative form
addresses stay separate. A closed tab keeps pending typing in the desk's
recovery storage until the store accepts it. A successful send spends the draft;
a refusal keeps it. A newer edit made while a send waits remains a draft.

What it draws:

- **Each kind its control.** `line`, `email`, `phone` and `date` are one-line
  fields typed for a phone's keyboard; `lines` and `address` are several lines
  (@yaks/ui's `Address` is a web address, not a postal one). `choose` is a row
  of radios to press, or a list to pick from past six choices; `choices` is a
  box for each; `check` is one box, and unticked is no answer, so a required one
  must be ticked. `file` uploads the chosen file to the form app and keeps its
  blob reference as the answer.
- **Repeat groups.** Each entry of a `repeat` is a card of its own questions,
  numbered from its label ("Child 1"), with Add and Remove. A required repeat
  starts with one entry and keeps at least one.
- **Conditions.** A question shows only while its `when` holds, from `asked()`.
  What is sent is `kept()`: an answer whose question has since hidden is not
  sent.
- **Required and optional.** An optional question's label says "(optional)".
  Sending checks `missing()` first; what is owed says so under its question, and
  nothing is sent.
- **Closed and thanks.** A form its door says is not `open` shows `form.closed`
  (or "This form is closed."). A sent one shows `form.thanks`, and a button to
  fill it in again. A JavaScript submission's refusal shows the door's own words
  and keeps every answer.
- **Without JavaScript.** It is a native `<form method="post" action={at}>`,
  each control named by its answer's path (`children.0.born`), with `required`
  set. The door takes URL-encoded controls as well as JSON. A native post
  redirects with 303 to the referring page (the app root without a same-origin
  referrer), preserving its query and fragment. Its `yak-form` query parameter
  is JSON containing the absolute form door URL as `at`, and either `sent: true`
  or `said` with the refusal. The page can render that feedback without script;
  Submit consumes its own feedback when mounted and removes the parameter, so
  filling it in again starts fresh. Without script, native redirects do not
  retain answers; a mounted Submit retains its draft across a refusal and spends
  it after a successful native return.

Its page state is `Submit{content, unread, values, tried, sending, sent, said}`
on `submitAt(at)`: the form as the door answered it, why it could not be read,
the current draft snapshot, and how sending went. `read` and `send` replace the
door calls (`get`, `post`).
