/** @jsxImportSource preact */
// The home page that leads with what a visitor gets, an app built from their
// description, and names the Operator only once the app is in hand. It is a
// home page `/` is split with (variant.ts `describe`), so its canonical
// address is the home page's, and its box and plans are the home page's own.
import { Button, Card, Field } from '@yaks/ui'
import { START } from '../newcomer.ts'
import { FREE } from '../meter.ts'
import { Page, Yours } from './frame.tsx'
import { Cost, Examples } from './home.tsx'
import { Idle } from '../mascot.ts'

// The apps its carousel turns through, things for work first: each one's
// address in yourname's space, its name and what it is for.
let EXAMPLES = [
  [
    'menu',
    'Wren’s Bakery',
    'A market stall’s menu with prices, marked sold out from a phone.',
  ],
  [
    'directory',
    'Church Directory',
    'A members-only directory with families, photos and birthdays.',
  ],
  ['trip', 'Travel Planner', "Plan the days, who's coming and what to pack."],
  ['recipes', 'Recipe Box', 'Save recipes and share them with family.'],
  ['chores', 'Chore Chart', 'Keep track of whose turn it is.'],
]

export let Build = () => (
  <Page
    name='yaks.app — describe the app you need, and it is built for you'
    title='yaks.app — describe the app you need, and it is built for you'
    description='Describe the app you need, like a sign-up sheet, a price list or a member directory, and yaks.app builds it and puts it online at its own address. Free to start.'
    path='/'
    kind='Home'
    head={
      <>
        <script src='carousel.js' defer />
        <script src='wander.js' defer />
        <script src='cta.js' defer />
      </>
    }
  >
    <section class='Hello' aria-labelledby='hello'>
      <div class='Hello_Copy'>
        <div class='Hello_Yak' data-wander=''>
          <Idle class='Wander_Image' base='.' />
        </div>
        <p class='Hello_Kicker'>Web apps, built for you</p>
        <h1 class='Title Title-hero' id='hello'>
          <label for='say'>
            Describe the app you need, and yaks.app builds it.
          </label>
        </h1>
        <p class='Note'>
          Like a sign-up sheet, a price list or a member directory. It works on
          any phone, and you share it with a link.
        </p>
        <form class='Hello_Ask' method='post' action={START}>
          <Field
            class='Hello_Field'
            lines
            id='say'
            name='say'
            required
            maxLength={4000}
            placeholder='What do you need, and who is it for?'
          />
          <Button mod='go' type='submit' data-cta='start'>
            Build it
          </Button>
        </form>
        <p class='Note Note-small'>
          Free for {FREE.apps} apps, with no sign-up to start.{' '}
          <a href='#examples' data-cta='examples'>
            See examples <span aria-hidden='true'>↓</span>
          </a>
        </p>
      </div>
      <Examples apps={EXAMPLES}>
        Each of these apps runs on yaks.app. Open one to try it, or get a copy
        of your own and ask for changes.{' '}
        <a href='/gallery'>See more in the gallery</a>.
      </Examples>
    </section>
    <section class='Yours' aria-labelledby='does'>
      <h2 class='Title' id='does'>What every app can do</h2>
      <dl class='Yours_List'>
        <div>
          <dt class='Yours_Term'>It saves what people enter</dt>
          <dd class='Yours_Detail'>
            Names, notes and photos are kept, and everyone sees the same thing
            on any phone or computer.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>You choose who can open it</dt>
          <dd class='Yours_Detail'>
            Share it with anyone who has the link, or make it private, so only
            the people you invite can sign in. Inviting people is free.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>What is in it stays yours</dt>
          <dd class='Yours_Detail'>
            Ask for everything in an app as a spreadsheet, or delete it,
            whenever you like.
          </dd>
        </div>
      </dl>
    </section>
    <section class='How' aria-labelledby='how'>
      <h2 class='Title' id='how'>How yaks.app works</h2>
      <ol class='Steps'>
        <li class='Steps_Item'>
          <h3 class='Step_Name'>Describe it</h3>
          <p class='Note'>
            Type what you need in the box above. There is nothing to install.
          </p>
        </li>
        <li class='Steps_Item'>
          <h3 class='Step_Name'>Your Operator builds it</h3>
          <p class='Note'>
            Your Operator is an AI helper that does the work. It builds the app
            and puts it online while you watch. Open it on your phone or
            computer, or send its link to the people it's for.
          </p>
        </li>
        <li class='Steps_Item'>
          <h3 class='Step_Name'>Sign up free to keep it</h3>
          <p class='Note'>
            Enter your email, and the app is yours, at your own address like
            {' '}
            <Yours />.
          </p>
        </li>
        <li class='Steps_Item'>
          <h3 class='Step_Name'>Change it by asking</h3>
          <p class='Note'>
            Want a new column, a new page or a fix? Tell your Operator in plain
            words, by chat on yaks.app or by email. Give it your mobile number,
            and you can text it or call it.
          </p>
        </li>
      </ol>
      <p class='Note Note-small'>
        Already use Claude or ChatGPT? Paste <a href='/agent'>yaks.app/agent</a>
        {' '}
        into it, and it can build your apps too.
      </p>
    </section>
    <Cost />
    <Card class='Join' aria-labelledby='join'>
      <h2 class='Title' id='join'>What app do you need?</h2>
      <p class='Join_Doors'>
        <Button mod='go' href='#say' data-cta='join'>Describe it</Button>
      </p>
      <p class='Note Note-small'>Free to start.</p>
    </Card>
  </Page>
)
