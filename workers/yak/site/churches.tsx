/** @jsxImportSource preact */
// The landing page for a church office (variant.ts `church`): what a church
// gets in the words its office uses, what yaks.app has built for one, and the
// one plan a church pays for. Only its own address shows it, which is where an
// ad for churches points, so that address is its canonical one. Its box is the
// home page's, a first build with no sign-up, asking for the web address of
// the site the church has now: the Operator reads it and builds theirs from
// it (newcomer.ts `worded`, `rebuilding`). Words typed in the box are built as
// an idea, as the home page's are.
import { Button, Card, Field } from '@yaks/ui'
import { GET_PLAN } from '../route.ts'
import { KEEPING, START } from '../newcomer.ts'
import { FREE, PRICE, YEARLY } from '../meter.ts'
import { Page, Yours } from './frame.tsx'

/** Where the page lives. */
export let PATH = '/churches'

/** About how many minutes a church's site takes, from the button to the
 * Operator saying it is live. Two live builds, each of a church's own site:
 * 2 minutes 50 seconds through this page's box, and 3 minutes 40 seconds
 * before the Operator was told how (newcomer.ts `rebuilding`). The page first
 * showed after 83 and 81 seconds. */
export let MINUTES = 3

export let Churches = () => (
  <Page
    name='yaks.app for churches — a new church website built from the one you have, and changed whenever you ask'
    title='yaks.app for churches — a new church website built from the one you have, and changed whenever you ask'
    description={`Type your church's web address and watch yaks.app build your new site from it, free to try and with no sign-up. Then change it by asking, by email or chat, and add sign-up forms, a member directory and a calendar. $${PRICE.pro} a month for your whole church.`}
    path={PATH}
    kind='Home'
    head={<script src='cta.js' defer />}
  >
    <section class='Hello' aria-labelledby='hello'>
      <div class='Hello_Copy'>
        <p class='Hello_Kicker'>For church offices</p>
        <h1 class='Title Title-hero' id='hello'>
          <label for='say'>
            Type your church's web address, and watch yaks.app build your new
            site.
          </label>
        </h1>
        <p class='Note'>
          Your church's name, service times and what's on this week, read from
          the site you have now. To change anything, you ask it by email or
          chat.
        </p>
        <form class='Hello_Ask' method='post' action={START}>
          <input type='hidden' name='org' value='church' />
          <Field
            class='Hello_Field Hello_Field-line'
            id='say'
            name='say'
            required
            maxLength={4000}
            autocapitalize='none'
            autocorrect='off'
            spellcheck={false}
            enterkeyhint='go'
            placeholder='yourchurch.org'
          />
          <Button mod='go' type='submit' data-cta='start'>
            Build my site free
          </Button>
        </form>
        <p class='Note Note-small'>
          Free to try, with no sign-up. yaks.app reads the site at that address
          and builds a preview of it that only you can open, marked on every
          page as a preview. It takes about {MINUTES}{' '}
          minutes, and the site you have now isn't changed. It goes online only
          once you sign up and connect your church's web address, which shows
          the site is yours. No website yet? Type what your church needs
          instead.
        </p>
      </div>
    </section>
    <section class='How' aria-labelledby='how'>
      <h2 class='Title' id='how'>
        It starts from your site, and you change it by asking
      </h2>
      <ol class='Steps'>
        <li class='Steps_Item'>
          <h3 class='Step_Name'>You watch your new site being built</h3>
          <p class='Note'>
            A chat opens and says what it is doing. Your new site shows as it is
            made, the page itself after a minute or two, and it is ready to open
            in about {MINUTES}{' '}
            minutes. The site you have now is only read. Nothing on it changes.
          </p>
        </li>
        <li class='Steps_Item'>
          <h3 class='Step_Name'>Keep it, and put it online</h3>
          <p class='Note'>
            If you like what you see, give your email and it is yours, free. If
            you don't, it is deleted after {KEEPING / 86_400_000}{' '}
            days. To put it online, connect your church's web address to it: a
            record you add where that address is registered shows the site is
            yours, and only then can anyone else open it.
          </p>
        </li>
        <li class='Steps_Item'>
          <h3 class='Step_Name'>Ask for changes by email or chat</h3>
          <p class='Note'>
            Your church gets an Operator, an AI helper that does the building.
            Ask it the way you would ask a volunteer who is good with computers:
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
    <section class='Yours' aria-labelledby='built'>
      <h2 class='Title' id='built'>
        What else yaks.app has built for a church
      </h2>
      <dl class='Yours_List'>
        <div>
          <dt class='Yours_Term'>Sign-up forms on the website</dt>
          <dd class='Yours_Detail'>
            For kids' club, youth group and the things on the calendar, beside
            the church's sermons and events.
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
      <h2 class='Title' id='join'>Start with the website you have now</h2>
      <p class='Join_Doors'>
        <Button mod='go' href='#say' data-cta='join'>Type its address</Button>
      </p>
      <p class='Note Note-small'>Free to try, with no sign-up.</p>
    </Card>
  </Page>
)
