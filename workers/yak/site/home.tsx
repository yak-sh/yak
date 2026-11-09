/** @jsxImportSource preact */
import type { ComponentChildren } from 'preact'
import { Button, Card, Field } from '@yaks/ui'
import { GET_PLAN } from '../route.ts'
import { START } from '../newcomer.ts'
import { Data, Page, Yours } from './frame.tsx'
import { Idle } from '../mascot.ts'

// What an engine reads of the page.
let data = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': 'https://yaks.app/#website',
      'url': 'https://yaks.app/',
      'name': 'yaks.app',
      'alternateName': 'Yak Shaving',
      'description':
        'An Operator that does things for you, and builds the apps it needs.',
      'inLanguage': 'en-US',
      'publisher': {
        '@id': 'https://yaks.app/#organization',
      },
    },
    {
      '@type': 'Organization',
      '@id': 'https://yaks.app/#organization',
      'name': 'Yak Shaving LLC',
      'url': 'https://yaks.app/',
      'logo': 'https://yaks.app/icon-512.png',
      'email': 'hello@yaks.app',
    },
    {
      '@type': 'SoftwareApplication',
      '@id': 'https://yaks.app/#software',
      'name': 'yaks.app',
      'url': 'https://yaks.app/',
      'applicationCategory': 'DeveloperApplication',
      'operatingSystem': 'Web browser',
      'description':
        'Get an Operator that does things for you. Chat with it, email it, text it or call it, and it builds the apps it needs, from a menu for your side business to a recipe box for your family, and puts them online at yourname.yaks.app, with their own data, file uploads, email address and optional custom domain.',
      'featureList': [
        'An Operator you chat with, email, text or call',
        'Apps your Operator builds for you',
        'Apps built by your own AI assistant over MCP',
        'A graph data store per app, shared across devices',
        'File and photo uploads',
        'Live updates for everyone using an app, and voice calls',
        'AI models and server code for apps',
        'An email address per app',
        'Publish an app for other people to install',
        'A custom domain',
      ],
      'publisher': {
        '@id': 'https://yaks.app/#organization',
      },
      'offers': [
        {
          '@type': 'Offer',
          'name': 'Free',
          'price': '0',
          'priceCurrency': 'USD',
          'url': 'https://yaks.app/pricing',
          'availability': 'https://schema.org/InStock',
          'description':
            "For one space: 5 apps, unlimited visitors, 1 GB of app data, 1 GB of photos and files, and 100 emails a month. A person's first space is free.",
        },
        {
          '@type': 'Offer',
          'name': 'Plus',
          'price': '9',
          'priceCurrency': 'USD',
          'url': 'https://yaks.app/pricing',
          'availability': 'https://schema.org/InStock',
          'description':
            'For one space: unlimited apps, unlimited visitors, 10 GB of app data, 50 GB of photos and files, 2,500 emails a month, and a custom domain.',
          'priceSpecification': {
            '@type': 'UnitPriceSpecification',
            'price': '9',
            'priceCurrency': 'USD',
            'valueAddedTaxIncluded': true,
            'billingDuration': 1,
            'billingIncrement': 1,
            'unitCode': 'MON',
          },
        },
        {
          '@type': 'Offer',
          'name': 'Pro',
          'price': '49',
          'priceCurrency': 'USD',
          'url': 'https://yaks.app/pricing',
          'availability': 'https://schema.org/InStock',
          'description':
            'For one space: unlimited apps, where staff ask for a change by email or chat and yaks.app makes it, document search, notices by email, AI use included, email support, unlimited visitors, 10 GB of app data, 50 GB of photos and files, 2,500 emails a month, and a custom domain. Or $490 a year.',
          'priceSpecification': {
            '@type': 'UnitPriceSpecification',
            'price': '49',
            'priceCurrency': 'USD',
            'valueAddedTaxIncluded': true,
            'billingDuration': 1,
            'billingIncrement': 1,
            'unitCode': 'MON',
          },
        },
      ],
    },
  ],
}

// The apps the carousel turns through: each one's address in yourname's
// space, its name and what it is for.
export let EXAMPLES = [
  ['garden', 'Garden Diary', 'Note what you planted and how it grew.'],
  ['bookclub', 'Book Club', 'Choose books and plan your next meeting.'],
  ['trip', 'Travel Planner', "Plan the days, who's coming and what to pack."],
  ['recipes', 'Recipe Box', 'Save recipes and share them with family.'],
  [
    'guestbook',
    'Birthday Guestbook',
    'Collect birthday messages from friends.',
  ],
  ['chores', 'Chore Chart', 'Keep track of whose turn it is.'],
  [
    'housebook',
    'Housebook',
    'Your home’s manual: appliances, upkeep, paint colors and papers.',
  ],
  [
    'sound-lab',
    'Sound Lab',
    'Build beats, shape sounds and export your music.',
  ],
  [
    'vale',
    'Mossvale',
    'A fantasy world to play in the browser, with quests and crafting.',
  ],
]

/** The examples, one card at a time (carousel.js): the apps in yourname's
 * space, which the served page swaps for the gallery's cards (gallery.ts
 * `showcase`), and under them what a visitor can do with one. */
export let Examples = ({ children }: { children: ComponentChildren }) => (
  <section
    class='Demo'
    aria-labelledby='examples'
    aria-roledescription='carousel'
    data-carousel=''
  >
    <h2 class='Demo_Title' id='examples'>Apps made with yaks.app</h2>
    <ul class='Demo_Slides'>
      {EXAMPLES.map(([slug, title, sub]) => (
        <Card as='li' class='Make_Card'>
          <Card.Head>
            <Card.Title as='h3'>
              <Card.Link href={`https://yourname.yaks.app/${slug}/`}>
                {title} <span aria-hidden='true'>↗</span>
              </Card.Link>
            </Card.Title>
          </Card.Head>
          <Card.Sub>{sub}</Card.Sub>
        </Card>
      ))}
    </ul>
    <div class='Demo_Controls' hidden>
      <Button
        class='Demo_Step'
        type='button'
        data-step='-1'
        aria-label='Previous app'
      >
        ‹
      </Button>{' '}
      <div class='Demo_Dots' />{' '}
      <Button
        class='Demo_Step'
        type='button'
        data-step='1'
        aria-label='Next app'
      >
        ›
      </Button>{' '}
      <Button class='Demo_Pause' type='button'>Pause</Button>
    </div>
    <p class='Note Note-small'>{children}</p>
  </section>
)

export let Home = () => (
  <Page
    name='yaks.app — an Operator that does things for you'
    title='yaks.app — an Operator that does things for you'
    description='Get an Operator that does things for you. Chat with it, email it, text it or call it, and it builds the apps it needs and puts them online at your own address.'
    path='/'
    kind='Home'
    head={
      <>
        <script src='carousel.js' defer />
        <script src='wander.js' defer />
        <script src='cta.js' defer />
        <Data of={data} />
      </>
    }
  >
    <section class='Hello' aria-labelledby='hello'>
      <div class='Hello_Copy'>
        <div class='Hello_Yak' data-wander=''>
          <Idle class='Wander_Image' base='.' />
        </div>
        <p class='Hello_Kicker'>An Operator that does things for you</p>
        <h1 class='Title Title-hero' id='hello'>
          <label for='say'>
            Tell your Operator what you need done.
          </label>
        </h1>
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
          Free, with no sign-up to start. <a href='#cost'>$9 a month</a>{' '}
          for more.{' '}
          <a href='#examples' data-cta='examples'>
            See examples <span aria-hidden='true'>↓</span>
          </a>
        </p>
      </div>
      <Examples>
        Each of these apps runs on yaks.app. Open one to try it, or get a copy
        of your own and ask your Operator to change it.{' '}
        <a href='/gallery'>See more in the gallery</a>.
      </Examples>
    </section>
    <section class='Yours' aria-labelledby='does'>
      <h2 class='Title' id='does'>What your Operator does for you</h2>
      <dl class='Yours_List'>
        <div>
          <dt class='Yours_Term'>It builds apps</dt>
          <dd class='Yours_Detail'>
            Ask for an app, a new feature or a fix, and your Operator does the
            work. Your apps save what people add, on every phone and computer.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>Chat, email, text or call</dt>
          <dd class='Yours_Detail'>
            Chat with it on yaks.app or email it. Give it your mobile number,
            and you can text it or call it.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>Share anything it does or builds</dt>
          <dd class='Yours_Detail'>
            Keep an app to yourself, share it with a link, or invite as many
            people as you like to view or edit it, free.
          </dd>
        </div>
      </dl>
    </section>
    <section class='How' aria-labelledby='how'>
      <h2 class='Title' id='how'>How yaks.app works</h2>
      <ol class='Steps'>
        <li class='Steps_Item'>
          <h3 class='Step_Name'>Tell your Operator what you need</h3>
          <p class='Note'>
            Type it in the box above, like a chore chart for your household.
            There is nothing to install.
          </p>
        </li>
        <li class='Steps_Item'>
          <h3 class='Step_Name'>Open it anywhere</h3>
          <p class='Note'>
            Your Operator builds it and puts it online. Open it on your phone or
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
      </ol>
      <p class='Note Note-small'>
        Already use Claude or ChatGPT? Paste <a href='/agent'>yaks.app/agent</a>
        {' '}
        into it, and it can build your apps too.
      </p>
    </section>
    <section class='Cost' aria-labelledby='cost'>
      <h2 class='Title' id='cost'>Free to start, a plan for more</h2>
      <p class='Note'>
        A space is your address, like{' '}
        <Yours />, with its apps, their data and the people you invite. Your
        first space is free.
      </p>
      <div class='Plans'>
        <Card as='div' class='Plan'>
          <h3 class='Plan_Price'>Free</h3>
          <p class='Note Note-small'>Your first space.</p>
          <ul class='Plan_List'>
            <li class='Plan_Item'>5 apps</li>
            <li class='Plan_Item'>Unlimited visitors</li>
            <li class='Plan_Item'>
              1 GB of app data, 1 GB of photos and files
            </li>
            <li class='Plan_Item'>100 emails a month</li>
            <li class='Plan_Item'>
              An address like <Yours />
            </li>
          </ul>{' '}
          <Button mod='go' href='/login'>Start Free</Button>
        </Card>
        <Card as='div' class='Plan Plan-plus'>
          <h3 class='Plan_Price'>
            $9
            <span class='Plan_Per'>&#32;a month</span>
          </h3>
          <p class='Note Note-small'>
            The Plus plan, for each space. Take payments with Stripe.
          </p>
          <ul class='Plan_List'>
            <li class='Plan_Item'>Unlimited apps</li>
            <li class='Plan_Item'>Unlimited visitors</li>
            <li class='Plan_Item'>
              10 GB of app data, 50 GB of photos and files
            </li>
            <li class='Plan_Item'>2,500 emails a month</li>
            <li class='Plan_Item'>
              Your own domain, like <b>ourbookclub.com</b>
            </li>
          </ul>{' '}
          <Button
            mod='go'
            href={GET_PLAN}
            data-cta='plus'
          >
            Get Started
          </Button>
        </Card>
        <Card as='div' class='Plan Plan-pro'>
          <h3 class='Plan_Price'>
            $49
            <span class='Plan_Per'>&#32;a month</span>
          </h3>
          <p class='Note Note-small'>
            The Pro plan, or $490 a year. Your staff ask the Operator by email
            or chat, and it makes the change.
          </p>
          <ul class='Plan_List'>
            <li class='Plan_Item'>Unlimited apps</li>
            <li class='Plan_Item'>Unlimited visitors</li>
            <li class='Plan_Item'>
              10 GB of app data, 50 GB of photos and files
            </li>
            <li class='Plan_Item'>2,500 emails a month</li>
            <li class='Plan_Item'>
              Your own domain, like <b>ourtownship.org</b>
            </li>
          </ul>{' '}
          <Button
            mod='go'
            href={GET_PLAN}
            data-cta='pro'
          >
            Get Started
          </Button>
        </Card>
      </div>
      <p class='Note Note-small'>
        Tax is included. Going over a limit never deletes your apps or data.
        {' '}
        <a href='/pricing'>Compare plans and limits</a>.
      </p>
    </section>
    <Card class='Join' aria-labelledby='join'>
      <h2 class='Title' id='join'>What would you like your Operator to do?</h2>
      <p class='Join_Doors'>
        <Button mod='go' href='#say' data-cta='join'>Tell it</Button>
      </p>
      <p class='Note Note-small'>Free to start.</p>
    </Card>
  </Page>
)
