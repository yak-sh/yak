---
doc:
  title: Forms and Sign-ups
guide:
  slug: forms
  brief: forms anyone can fill in, whose sign-ups email the person and the app's own people
  description: >-
    Forms and sign-up sheets as rows: a `form` with its `question` rows, the
    public door at ./api/form/<name> that shows one and takes its answers
    whatever the app's access, and what a sign-up sets off without any code: a
    `registration` only the app's owners and editors read, a letter to the
    person who signed up, and a letter with their answers to each person the
    form notifies. Opening and closing dates, a capacity, drawing a form on a
    page, and a plain HTML form that posts to the door.
---

# Forms and Sign-ups

The map is at <https://yaks.app/docs.md>. This page covers forms in full: the
rows that make one, the door a visitor fills it in through, and what a sign-up
sets off.

Use a form whenever somebody who is not a member sends the app something and
people have to hear about it: a sign-up sheet, a request to reserve a hall, a
visitor card, a question for the office. Two things make a form more than rows a
page writes:

- **Its sign-ups send email.** A visitor's own write can never send a letter
  (<https://yaks.app/docs/mail.md>, "Who may send email"). A sign-up through a
  form's door does: the platform writes the letters as the app.
- **Its sign-ups stay with the people who run the app.** A `registration` is
  read only by the app's owners and editors, whatever the app's `access`, so a
  public sign-up sheet never shows one visitor another's phone number.

## A form is rows

A form is an entity with `form` and a `doc` for its title and introduction. Each
thing it asks is a `question` row naming the form. Write them as an owner or
editor, with `graph_apply` or from a page:

    let saved = await apply({
      entity: { eid: '$office' },
      doc: { title: 'Parks office' },
      email: { address: 'parks@example.org' },
    })
    await apply([
      { entity: { eid: '$form' },
        alias: { name: 'pavilion' },
        doc: { title: 'Reserve the pavilion',
               body: 'Ask for a date and we will write back.' },
        form: { thanks: 'We have your request and will answer within two days.',
                notify: [saved.aliases.$office] } },
      { entity: { eid: '$name' },
        question: { form: '$form', label: 'Your name', kind: 'line',
                    required: true, order: 1 } },
      { entity: { eid: '$mail' },
        question: { form: '$form', label: 'Your email', kind: 'email',
                    order: 2 } },
      { entity: { eid: '$day' },
        question: { form: '$form', label: 'Which date?', kind: 'date',
                    required: true, order: 3 } },
    ])

The office is written first because `notify` is a list, and a page's `apply`
replaces an alias such as `$office` only where a property holds one eid, never
inside a list. The `alias` gives the form a name for its door's address; without
one the door is addressed by the form's eid. In `seed.json` an alias is replaced
wherever it appears, so there the rows are one list with `notify: ["$office"]`,
and every installed copy has the form.

**`form`** — all optional:

- `thanks` (text): what the person is told once they have signed up, on the page
  and in their letter.
- `notify` (a list of eids): who hears of each sign-up. Each is an entity with
  `email{address}`.
- `opens`, `closes` (date-times): the form takes sign-ups from `opens` up to,
  but not at, `closes`.
- `capacity` (number): how many sign-ups it takes. Cancelled ones do not count.
- `closed` (text): what the form says while it is not open or is full.

**`question`** — `form` (the form's eid), `label`, and `kind`, one of:

| kind      | asks for                          | its answer        |
| --------- | --------------------------------- | ----------------- |
| `line`    | one line of text                  | text              |
| `lines`   | several lines                     | text              |
| `email`   | an email address                  | text              |
| `phone`   | a phone number                    | text              |
| `address` | a postal address                  | text              |
| `date`    | a date                            | `YYYY-MM-DD`      |
| `choose`  | one of `choices`                  | the choice        |
| `choices` | any of `choices`                  | a list of choices |
| `check`   | a tick                            | `true` or absent  |
| `file`    | an upload                         | the upload's eid  |
| `repeat`  | a group asked once for each entry | a list of answers |

`choices` is the list a `choose` or `choices` question offers. `required: true`
refuses a sign-up without an answer, `hint` is a line shown under the label, and
`order` sorts the questions, lowest first. A question shown only after an
earlier answer carries `when: { question: <eid>, is: <answer> }`, and a question
asked inside a `repeat` carries `within: <the repeat's eid>`.

## The door: `./api/form/<name>`

Every app serves its forms at `./api/form/<name>`, where `<name>` is the form's
alias or its eid. The door answers anybody, signed in or not, whatever the app's
`access`: a private app can take sign-ups from the public through it, and
nothing else of the app is opened.

**`GET`** answers what a page needs to draw the form, and nothing about who
signed up:

    { "entity": { "eid": "…" },
      "doc": { "title": "Reserve the pavilion", "body": "…" },
      "form": { "thanks": "…" },
      "open": true,
      "questions": [
        { "entity": { "eid": "…" },
          "question": { "label": "Your name", "kind": "line",
                        "required": true, "order": 1 } } ] }

`open` is false before `opens`, from `closes` on, and once `capacity` is
reached. It never includes `notify`.

**`POST`** takes the answers, keyed by each question's eid, and answers `204`:

    await fetch('./api/form/pavilion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: { [nameEid]: 'Ana Ruiz',
                                        [dayEid]: '2027-06-14' } }),
    })

A sign-up that cannot be taken answers `400` with a sentence to show the person:
`Answer every required question.` or `This form is closed or full.`

A page draws a form from what `GET` answers, so adding a question later is a row
and not a change to the page:

    let at = './api/form/pavilion'
    let form = await (await fetch(at)).json()
    let box = document.querySelector('#form')
    let type = { email: 'email', phone: 'tel', date: 'date' }
    box.innerHTML = form.questions
      .sort((a, b) => (a.question.order ?? 0) - (b.question.order ?? 0))
      .map(({ entity, question: q }) => `
        <label>${q.label}
          <input name="${entity.eid}" type="${type[q.kind] ?? 'text'}"
            ${q.required ? 'required' : ''}>
        </label>`).join('') + '<button>Send</button>'
    box.onsubmit = async (e) => {
      e.preventDefault()
      let answers = Object.fromEntries(new FormData(box))
      let sent = await fetch(at, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers }),
      })
      box.replaceChildren(sent.ok ? form.form.thanks ?? 'Thank you.'
                                  : await sent.text())
    }

Escape `q.label` if anybody but the app's own people can write questions.

**A plain HTML form works too**, with no script. Name each control by its
question's eid and post to the door:

    <form method="post" action="./api/form/pavilion">
      <label>Your name <input name="…the name question's eid…" required></label>
      <button>Send</button>
    </form>

The door answers a form post by sending the browser back to the page it came
from with `?yak-form=` in its address: a JSON object holding `at`, the door's
address, and either `sent: true` or `said`, the sentence that refused it.

## What a sign-up sets off

Each sign-up the door takes does these, with no code in the app:

1. **A `registration` row** is written: `registration{form, answers, at}` with
   `completed`. `answers` is the object that was posted. Only the app's owners
   and editors can read it, so the page that lists sign-ups is one a member
   opens: `subscribe('.registration&.completed', draw)`.
2. **The person gets a letter**, when the form has an `email` question and they
   answered it. Its subject is the form's title and its body is `form.thanks`,
   or "Thank you for signing up for …" without one.
3. **Each person in `form.notify` gets a letter** saying there is a new sign-up,
   with every question answered and its answer, so they know who it was without
   opening the app.

The letters leave from the app's own address, moments after the sign-up, and
each is a row like any other letter: `.mail&.delivered` lists what went out
(<https://yaks.app/docs/mail.md>). The letters and the address rows written for
them wear `form_mail{registration, purpose}`, so like the sign-up they are read
only by the app's owners and editors, and deleting the sign-up deletes them. The
people a sign-up creates from its answers (the `individual` with status `guest`,
its `phone` and the `relation` rows between them) wear
`form_guest{registration}`, so they too are read only by the app's owners and
editors. A person the app wrote itself, which the sign-up matched, stays as the
app kept it.

Each letter counts toward the space's monthly email allowance.

What a form does _not_ do is anything later or anything that needs judgment: a
reminder two days on if nobody has answered, a reply that depends on what was
asked. That is the Operator's work. The space's owner asks it once, in words
("when a pavilion request comes in and I haven't answered in two days, remind
me"), and it keeps a subscription of its own on the sign-ups
(<https://yaks.app/docs/wakes.md>, "The Operator's subscriptions").

## A sign-up that holds a date

A request for a date usually wants two more things: the page should say when a
date is already taken, and a request should show on the calendar. Both are
`event` rows (<https://yaks.app/docs/components.md>): the page reads `.event`
before it posts, and writes one for the request beside the sign-up.

    let taken = await query('.event')
    if (taken.some((e) => e.event.starts == day)) return say('That day is taken.')
    await fetch(at, { method: 'POST', /* … the answers … */ })
    await apply({ entity: { eid: '$hold' },
                  doc: { title: 'Pavilion: requested' },
                  event: { starts: day } })

A visitor may write that row only in an `open` app, where anyone with the link
adds rows and changes only what they added. The app's events are then a calendar
feed at `./calendar.ics` that people add to the calendar on their phones. Leave
the person's name off the event's title: the feed is public.

Back to the map: <https://yaks.app/docs.md>
