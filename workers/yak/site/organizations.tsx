/** @jsxImportSource preact */
// The landing page for an organization's office (variant.ts `organization`):
// a church, a club, a town office or a small business that has a website and
// nobody on staff to look after it. It pitches the Pro plan as a web person
// on staff, and says what the office asked of that pitch: what the
// organization gets, who is behind it and who fixes its mistakes. Only its
// own address shows it, so that address is its canonical one.
//
// Its box is the churches page's, a first build with no sign-up from the web
// address of the site they have now (newcomer.ts `worded`, `REBUILDING`).
// Everything it promises is read from where it is done: the forms, directory
// and calendar from forms.ts, @yaks/people and calendar.ts; errors, the
// kept versions and the restores from docs/errors.md; support from
// support.ts; the numbers from meter.ts, versions.ts, recover.ts and directory.ts.
import { Button, Card, Field, Form } from '@yaks/ui'
import { html } from '@yaks/mail'
import { GET_PLAN } from '@yaks/platform/routes'
import { KEEPING, START } from '../newcomer.ts'
import { BLOCK, LETTERS, PRICE, YEARLY } from '../meter.ts'
import { KEEP } from '../versions.ts'
import { WINDOW } from '../recover.ts'
import { GRACE } from '../directory.ts'
import { MINUTES } from './churches.tsx'
import { Page } from './frame.tsx'

/** Where the page lives. */
export let PATH = '/organizations'

let days = (ms: number) => ms / 86_400_000

/** What a person types what they pay for, each a tool the Pro plan's site
 * holds in its place. */
let PAID = [
  ['website', 'Your website'],
  ['forms', 'Forms and sign-ups'],
  ['directory', 'Member directory'],
  ['calendar', 'Calendar'],
]

let sample = (slug: string, said: string) => (
  <a href={`https://yourname.yaks.app/${slug}/`} data-cta='examples'>
    {said} <span aria-hidden='true'>↗</span>
  </a>
)

type Mail = { from: string; to: string; subject: string; body: string }

// The exchange the page shows took place: an email sent to the demo space's
// assistant on 2026-11-11 about its visitor card
// (https://yourname.yaks.app/visitors/), and the answer that came back 39
// seconds later, each word for word. The people in it are made up. To show
// another, email yourname@yaks.app from a member's address and copy both
// letters from the mailbox they arrive in.
let ASKED: Mail = {
  from: 'admin@bot.yak.sh',
  to: 'yourname@yaks.app',
  subject: 'Visitor cards',
  body:
    'Pastor Dan called Tom Reyes this morning. Can you tick him off the visitor card list, and tell me who is still waiting for a call?',
}
let ANSWERED: Mail = {
  from: 'yourname@yaks.app',
  to: 'admin@bot.yak.sh',
  subject: 'Re: Visitor cards',
  body:
    `Tom Reyes is ticked off as called. There was only one Tom Reyes, and I checked that the saved row shows it.

One visitor is still waiting for a call:

- **Grace Lindqvist**
  - Phone: 555-0109
  - Email: grace.lindqvist@bot.yak.sh
  - Note: "My husband is having surgery on Thursday. Please pray for him."

Cove
yourname’s Operator`,
}

// A letter as its reader got it: its body is drawn by the function that
// makes every letter's HTML (@yaks/mail `html`), under who sent it and its
// subject.
let Letter = (
  { by, mail, back }: { by: string; mail: Mail; back?: boolean },
) => (
  <Card as='div' class={`Letter${back ? ' Letter-back' : ''}`}>
    <p class='Letter_By'>{by}</p>
    <p class='Letter_Head'>
      <b>{mail.subject}</b>
      <br />
      From {mail.from} to {mail.to}
    </p>
    <div
      class='Letter_Body'
      dangerouslySetInnerHTML={{ __html: html(mail.body) }}
    />
  </Card>
)

export let Organizations = () => (
  <Page
    name={`yaks.app for organizations — like having a web person on staff, for $${PRICE.pro} a month`}
    title={`yaks.app for organizations — like having a web person on staff, for $${PRICE.pro} a month`}
    description={`An AI assistant looks after your organization's website. Email it what you need and it makes the change, and we fix what it gets wrong. Type your website's address for a free private preview, with no sign-up. $${PRICE.pro} a month for the whole organization.`}
    path={PATH}
    kind='Home'
    head={
      <>
        <script src='cta.js' defer />
        <script src='saving.js' defer />
      </>
    }
  >
    <section class='Hello' aria-labelledby='hello'>
      <div class='Hello_Copy'>
        <p class='Hello_Kicker'>
          For churches, clubs, town offices and small businesses
        </p>
        <h1 class='Title Title-hero' id='hello'>
          Like having a web person on staff, for ${PRICE.pro} a month.
        </h1>
        <p class='Note'>
          An AI assistant looks after your website. You email it what you need,
          it makes the change, and our small company fixes what it gets wrong.
        </p>
        <Form method='post' action={START} id='start'>
          <input type='hidden' name='org' value='organization' />
          <Form.Field>
            <Form.Label for='say'>
              Type your website's address for a free preview: a copy of your
              site, built new, that only you can open
            </Form.Label>
            <Form.Line>
              <Field
                id='say'
                name='say'
                required
                maxLength={4000}
                autocapitalize='none'
                autocorrect='off'
                spellcheck={false}
                enterkeyhint='go'
                placeholder='yourorganization.org'
                aria-describedby='try'
              />
              <Button mod='go' type='submit' data-cta='start'>
                Build a free preview
              </Button>
            </Form.Line>
            <Form.Hint id='try'>
              No sign-up. It takes about {MINUTES}{' '}
              minutes, and the site you have now is not changed.
            </Form.Hint>
          </Form.Field>
        </Form>
      </div>
      <div class='Letters' role='group' aria-labelledby='asked'>
        <p class='Note Note-small' id='asked'>
          An email to the assistant, and its answer 39 seconds later
        </p>
        <Letter by='The office writes' mail={ASKED} />
        <Letter by='The assistant writes back' mail={ANSWERED} back />
      </div>
    </section>
    <section class='Yours' aria-labelledby='missing'>
      <h2 class='Title' id='missing'>
        Sign-up forms, a member directory and a calendar, added to your website
      </h2>
      <dl class='Yours_List'>
        <div>
          <dt class='Yours_Term'>Sign-up forms</dt>
          <dd class='Yours_Detail'>
            For an event, a class or volunteers. What people enter is saved, and
            you see who signed up.{' '}
            {sample('potluck', 'Try a sample sign-up sheet')}
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>A members-only directory</dt>
          <dd class='Yours_Detail'>
            Families, photos and birthdays. Only the people you invite can open
            it, signing in with a code sent to their email.{' '}
            {sample('directory', 'Try the sample directory')}
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>A calendar people add to their phones</dt>
          <dd class='Yours_Detail'>
            Members add your calendar to the calendar on their own phone, and it
            stays up to date as you change it.
          </dd>
        </div>
      </dl>
      <p class='Note Note-small'>
        These three were first built for a church office. Ask for what your
        office needs, such as a calendar for the park pavilion that emails you
        each request and reminds you of one that has waited two days.
      </p>
    </section>
    <section class='How' aria-labelledby='together'>
      <h2 class='Title' id='together'>
        People type their details once
      </h2>
      <p class='Note'>
        A forms tool, a directory and a calendar bought separately each keep
        their own list of people. Here they are parts of one website:
      </p>
      <ul class='Plan_List'>
        <li class='Plan_Item'>
          A member who is signed in and signs up for the picnic doesn't type
          their name and phone number again. The form already has them from the
          directory.
        </li>
        <li class='Plan_Item'>
          A detail the directory didn't have yet, such as a phone number, is
          added from what they type on the form. What it already has is left
          alone.
        </li>
        <li class='Plan_Item'>
          What a member signs up for shows on the calendar on their own phone.
        </li>
      </ul>
    </section>
    <section class='Cost' aria-labelledby='saving'>
      <h2 class='Title' id='saving'>
        One plan in place of several subscriptions
      </h2>
      <p class='Note'>
        The website, the forms, the directory and the calendar are ${PRICE
          .pro} a month together, or ${YEARLY.pro}{' '}
        a year, with no charge per person.
      </p>
      <Form as='div' class='Saving' data-saving={PRICE.pro} hidden>
        <p class='Form_Label' id='paying'>
          Type what you pay each month now, to compare
        </p>
        <div class='Saving_Fields' role='group' aria-labelledby='paying'>
          {PAID.map(([name, said]) => (
            <Form.Field>
              <Form.Label for={`pay-${name}`}>{said}</Form.Label>
              <Field
                id={`pay-${name}`}
                type='number'
                inputmode='decimal'
                min='0'
                step='any'
                placeholder='$ a month'
              />
            </Form.Field>
          ))}
        </div>
        <output class='Saving_Said' aria-live='polite' />
        <Form.Hint>
          Nothing you type here is sent to us. Don't count accounting, online
          giving or a newsletter service: yaks.app doesn't do those.
        </Form.Hint>
      </Form>
    </section>
    <section class='How' aria-labelledby='how'>
      <h2 class='Title' id='how'>The office asks, and the change is made</h2>
      <ol class='Steps'>
        <li class='Steps_Item'>
          <h3 class='Step_Name'>It starts from the site you have</h3>
          <p class='Note'>
            Type your website's address above. The preview has what your site
            says: who you are, where and when, and what's coming up. It has the
            words but not the pictures, and you send those to the assistant
            afterward. A preview you don't keep is deleted after {days(KEEPING)}
            {' '}
            days.
          </p>
        </li>
        <li class='Steps_Item'>
          <h3 class='Step_Name'>You ask for changes by email or chat</h3>
          <p class='Note'>
            Write the way you would to a person on staff: “Here are Tuesday's
            minutes. Please post them.” The assistant makes the change and
            writes back to say what it did.
          </p>
        </li>
        <li class='Steps_Item'>
          <h3 class='Step_Name'>It goes online at your own web address</h3>
          <p class='Note'>
            Until then only you can see the preview. When you are ready you
            choose a plan, and the assistant walks you through pointing your web
            address, like{' '}
            <b>yourorganization.org</b>, at the new site. It is the one
            technical step. Then the new site takes the old one's place there.
          </p>
        </li>
      </ol>
    </section>
    <section class='Yours' aria-labelledby='behind'>
      <h2 class='Title' id='behind'>We watch for mistakes and fix them</h2>
      <p class='Note'>
        The assistant is AI, and AI gets things wrong. This is what happens when
        it does.
      </p>
      <dl class='Yours_List Yours_List-pairs'>
        <div>
          <dt class='Yours_Term'>
            A broken page or form is recorded as it happens
          </dt>
          <dd class='Yours_Detail'>
            When a page fails on a visitor's phone, or a form doesn't save, it
            is written down that moment. The assistant starts on it right away:
            it finds the cause, fixes it and puts the fix online. When you sign
            in, you see each one and what was done about it.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>When the fault is ours, we fix it</dt>
          <dd class='Yours_Detail'>
            Sometimes the cause is our own software and not your site. We are
            told as it happens, and we fix it. The assistant can also report a
            problem to us on your behalf, and our answer comes back to you.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>A wrong fact is put right by asking</dt>
          <dd class='Yours_Detail'>
            No software can know that a meeting date is wrong. Each time it
            changes something, the assistant tells you what it changed, so you
            can check it. Reply that it is wrong, and it is corrected.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>Any change can be put back</dt>
          <dd class='Yours_Detail'>
            The last {KEEP}{' '}
            versions of your site are kept, so you can ask for it as it was
            before a change. Sign-ups or directory entries changed or lost by
            mistake can be restored as they stood at any time in the last{' '}
            {days(WINDOW)} days, and anything deleted stays in the trash for
            {' '}
            {days(GRACE)} days.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>The site and what is in it are yours</dt>
          <dd class='Yours_Detail'>
            Ask for everything in it as a file or a spreadsheet whenever you
            like, or delete it. We never sell what is in it or share it with
            advertisers, as <a href='/privacy'>the privacy page</a>{' '}
            says. There is no contract. If you stop paying, the plan runs to the
            end of the month you paid for. After that nothing is deleted, and
            the site has the Free plan's limits, which don't include your own
            web address.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>You can write to us</dt>
          <dd class='Yours_Detail'>
            yaks.app is made by Yak Shaving LLC, a small company in Sturgis,
            Michigan. Write to{' '}
            <a href='mailto:hello@yaks.app'>hello@yaks.app</a>{' '}
            and we answer. Support is by email.
          </dd>
        </div>
      </dl>
    </section>
    <section class='Cost' aria-labelledby='cost'>
      <h2 class='Title' id='cost'>
        ${PRICE.pro} a month for the whole organization
      </h2>
      <div class='Plans'>
        <Card as='div' class='Plan Plan-pro'>
          <h3 class='Plan_Price'>
            ${PRICE.pro}
            <span class='Plan_Per'>&#32;a month</span>
          </h3>
          <p class='Note Note-small'>
            This is the Pro plan. Paid by the year it is ${YEARLY.pro}{' '}
            a year. One price, however many people you have.
          </p>
          <ul class='Plan_List'>
            <li class='Plan_Item'>
              Your office asks by email or chat, and the change is made
            </li>
            <li class='Plan_Item'>
              No charge per person: staff, members and visitors cost nothing
              extra
            </li>
            <li class='Plan_Item'>
              Your own web address, like <b>yourorganization.org</b>
            </li>
            <li class='Plan_Item'>The AI assistant's work is included</li>
            <li class='Plan_Item'>
              {LETTERS.pro.toLocaleString('en-US')}{' '}
              emails a month sent or received by your site, such as the list
              each Friday of who is coming to Saturday's food pantry shift
            </li>
            <li class='Plan_Item'>Support from us, by email</li>
          </ul>{' '}
          <Button mod='go' href={GET_PLAN} data-cta='pro'>
            Get Started
          </Button>
        </Card>
      </div>
      <p class='Note Note-small'>
        Tax is included, and the bill never grows by itself. If a very busy
        month uses up the AI work the plan includes, the assistant waits until
        the 1st, unless you choose to buy more, ${BLOCK}{' '}
        at a time and paid in advance. Your site stays online either way. There
        are two smaller plans, Free and ${PRICE.plus}{' '}
        a month, for a site that needs less.{' '}
        <a href='/pricing'>Compare the plans</a>, where the assistant is called
        your Operator.
      </p>
    </section>
    <Card class='Join' aria-labelledby='join'>
      <h2 class='Title' id='join'>Start with the website you have now</h2>
      <p class='Join_Doors'>
        <Button mod='go' href='#say' data-cta='join'>Type its address</Button>
      </p>
      <p class='Note Note-small'>Free to try.</p>
    </Card>
  </Page>
)
