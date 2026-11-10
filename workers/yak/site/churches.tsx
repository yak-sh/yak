/** @jsxImportSource preact */
// The landing page for a church office (variant.ts `church`): what a church
// gets in the words its office uses, what yaks.app has built for one, and the
// one plan a church pays for. Only its own address shows it, which is where an
// ad for churches points, so that address is its canonical one. Its box is the
// home page's: a first build, with no sign-up.
import { Button, Card, Field } from '@yaks/ui'
import { GET_PLAN } from '../route.ts'
import { START } from '../newcomer.ts'
import { FREE, PRICE, YEARLY } from '../meter.ts'
import { Page, Yours } from './frame.tsx'

/** Where the page lives. */
export let PATH = '/churches'

export let Churches = () => (
  <Page
    name='yaks.app for churches — your website, sign-up forms, directory and calendar in one place'
    title='yaks.app for churches — your website, sign-up forms, directory and calendar in one place'
    description={`Tell yaks.app what your church needs, and it builds your website, sign-up forms, member directory and calendar, and changes them whenever you ask. Free to try, $${PRICE.pro} a month for your whole church.`}
    path={PATH}
    kind='Home'
    head={<script src='cta.js' defer />}
  >
    <section class='Hello' aria-labelledby='hello'>
      <div class='Hello_Copy'>
        <p class='Hello_Kicker'>For church offices</p>
        <h1 class='Title Title-hero' id='hello'>
          Your church's website, sign-up forms, directory and calendar, in one
          place.
        </h1>
        <p class='Note'>
          <label for='say'>
            Tell yaks.app what your church needs. It builds it for you, and
            changes it whenever you ask.
          </label>
        </p>
        <form class='Hello_Ask' method='post' action={START}>
          <Field
            class='Hello_Field'
            lines
            id='say'
            name='say'
            required
            maxLength={4000}
            placeholder='What does your church office need? A sign-up form, a directory, a new website…'
          />
          <Button mod='go' type='submit' data-cta='start'>
            Build it free
          </Button>
        </form>
        <p class='Note Note-small'>
          Free to try, with no sign-up. <a href='#cost'>${PRICE.pro} a month</a>
          {' '}
          for your whole church.
        </p>
      </div>
    </section>
    <section class='Yours' aria-labelledby='built'>
      <h2 class='Title' id='built'>Built on yaks.app for a church</h2>
      <dl class='Yours_List'>
        <div>
          <dt class='Yours_Term'>A church website</dt>
          <dd class='Yours_Detail'>
            With its sermons, its events, and sign-up forms for kids' club,
            youth group and the things on the calendar.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>A members-only directory</dt>
          <dd class='Yours_Detail'>
            Families, photos, birthdays and anniversaries.{' '}
            <a href='https://yourname.yaks.app/directory/' data-cta='examples'>
              Try the sample directory <span aria-hidden='true'>↗</span>
            </a>
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>A calendar for everyone's phone</dt>
          <dd class='Yours_Detail'>
            Members add the church calendar to their own phones, and it stays up
            to date.
          </dd>
        </div>
      </dl>
    </section>
    <section class='How' aria-labelledby='how'>
      <h2 class='Title' id='how'>
        You ask in plain words, and the change is made
      </h2>
      <ol class='Steps'>
        <li class='Steps_Item'>
          <h3 class='Step_Name'>Your church gets an Operator</h3>
          <p class='Note'>
            It is an AI helper that does the building. Nobody has to learn a
            website builder.
          </p>
        </li>
        <li class='Steps_Item'>
          <h3 class='Step_Name'>Email it or chat with it</h3>
          <p class='Note'>
            Ask the way you would ask a volunteer who is good with computers:
            “Put the Christmas Eve service times on the home page.” It makes the
            change and writes back.
          </p>
        </li>
        <li class='Steps_Item'>
          <h3 class='Step_Name'>
            Only the people you invite see what is private
          </h3>
          <p class='Note'>
            Members sign in with their email to open the directory, and nobody
            else can. What is in it stays yours, to take with you or delete
            whenever you like.
          </p>
        </li>
      </ol>
    </section>
    <section class='Cost' aria-labelledby='cost'>
      <h2 class='Title' id='cost'>
        One plan in place of several subscriptions
      </h2>
      <p class='Note'>
        A website builder, a forms tool, a directory and a calendar are often
        paid for one by one. On yaks.app they live together at one address, like
        {' '}
        <Yours name='yourchurch' />, or at your own domain, like{' '}
        <b>yourchurch.org</b>.
      </p>
      <div class='Plans'>
        <Card as='div' class='Plan'>
          <h3 class='Plan_Price'>Free</h3>
          <p class='Note Note-small'>To try it, for as long as you like.</p>
          <ul class='Plan_List'>
            <li class='Plan_Item'>{FREE.apps} apps</li>
            <li class='Plan_Item'>Unlimited visitors</li>
            <li class='Plan_Item'>
              An address like <Yours name='yourchurch' />
            </li>
          </ul>{' '}
          <Button mod='go' href='/login'>Start Free</Button>
        </Card>
        <Card as='div' class='Plan Plan-pro'>
          <h3 class='Plan_Price'>
            ${PRICE.pro}
            <span class='Plan_Per'>&#32;a month</span>
          </h3>
          <p class='Note Note-small'>
            The Pro plan, or ${YEARLY.pro}{' '}
            a year. Your staff ask the Operator by email or chat, and it makes
            the change.
          </p>
          <ul class='Plan_List'>
            <li class='Plan_Item'>Unlimited apps</li>
            <li class='Plan_Item'>Everyone you invite is free</li>
            <li class='Plan_Item'>
              Your own domain, like <b>yourchurch.org</b>
            </li>
            <li class='Plan_Item'>AI use included</li>
          </ul>{' '}
          <Button mod='go' href={GET_PLAN} data-cta='pro'>
            Get Started
          </Button>
        </Card>
      </div>
      <p class='Note Note-small'>
        Tax is included. <a href='/pricing'>Compare plans and limits</a>.
      </p>
    </section>
    <Card class='Join' aria-labelledby='join'>
      <h2 class='Title' id='join'>Start with one thing your office needs</h2>
      <p class='Join_Doors'>
        <Button mod='go' href='#say' data-cta='join'>Tell us what it is</Button>
      </p>
      <p class='Note Note-small'>Free to try.</p>
    </Card>
  </Page>
)
