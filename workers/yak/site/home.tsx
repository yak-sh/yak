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
      'description': 'Build an app by asking Claude or ChatGPT.',
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
        'Ask Claude or ChatGPT for a web app — from a menu for your side business to a recipe box for your family — and yaks.app hosts it at yourname.yaks.app, with its own data store, file uploads, email address and optional custom domain. No install, no build step.',
      'featureList': [
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
          'name': 'Organization',
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
              <a href={`https://yourname.yaks.app/${slug}/`}>
                {title} <span aria-hidden='true'>↗</span>
              </a>
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
    name='yaks.app — build an app by asking Claude or ChatGPT'
    title='yaks.app — build an app by asking Claude or ChatGPT'
    description='Build an app by asking Claude or ChatGPT. The assistant you already use writes the app, and yaks.app puts it online at your own address.'
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
          <Idle base='.' />
        </div>
        <p class='Hello_Kicker'>Build, host and share web apps</p>
        <h1 class='Title Title-hero' id='hello'>
          Describe an app, and watch it being built.
        </h1>
        <p class='Note Note-lead'>
          yaks.app builds it while you watch and puts it online at your own
          address.
        </p>
        <form class='Hello_Ask' method='post' action={START}>
          <label class='Hello_Label' for='say'>
            Describe the app you want
          </label>
          <Field
            lines
            id='say'
            name='say'
            required
            maxLength={4000}
            placeholder='What should it do, and who is it for?'
          />
          <Button mod='go' type='submit' data-cta='start'>
            Build it
          </Button>
        </form>
        <p class='Note Note-small'>
          Free, with no sign-up to start. Or ask the assistant you already use,
          like Claude or ChatGPT. <a href='#cost'>$9 a month</a> for more.{' '}
          <a href='#examples' data-cta='examples'>
            See examples <span aria-hidden='true'>↓</span>
          </a>
        </p>
      </div>
      <Examples>
        Each of these apps runs on yaks.app. Open one to try it, or get a copy
        of your own and ask the assistant you use to change the copy.{' '}
        <a href='/gallery'>See more in the gallery</a>.
      </Examples>
    </section>
    <section class='For' aria-labelledby='for'>
      <h2 class='Title' id='for'>For your work, your ideas and your home</h2>
      <ul class='For_List'>
        <Card as='li'>
          <Card.Title as='h3'>For your work</Card.Title>
          <Card.Sub>
            The lists and records your team keeps, in a tool made for how you
            work.
          </Card.Sub>
          <p class='For_App'>
            <b>A church directory</b>: members, photos and birthdays, kept by
            the church office.
          </p>
          <p class='For_Doors'>
            <a href='https://yourname.yaks.app/directory/'>
              Open it <span aria-hidden='true'>↗</span>
            </a>{' '}
            <a href='/install?name=church-directory'>Get a copy</a>
          </p>
        </Card>
        <Card as='li'>
          <Card.Title as='h3'>For your ideas and side projects</Card.Title>
          <Card.Sub>
            An idea, or a small business on the side, running online without
            hiring anyone.
          </Card.Sub>
          <p class='For_App'>
            <b>A bakery's menu</b>: today's prices, marked sold out from a
            phone.
          </p>
          <p class='For_Doors'>
            <a href='https://yourname.yaks.app/menu/'>
              Open it <span aria-hidden='true'>↗</span>
            </a>{' '}
            <a href='/install?name=bakery-menu'>Get a copy</a>
          </p>
        </Card>
        <Card as='li'>
          <Card.Title as='h3'>For home</Card.Title>
          <Card.Sub>
            The recipes, chores and plans your family keeps in a dozen places.
          </Card.Sub>
          <p class='For_App'>
            <b>A recipe box</b>: save recipes and share them with family.
          </p>
          <p class='For_Doors'>
            <a href='https://yourname.yaks.app/recipes/'>
              Open it <span aria-hidden='true'>↗</span>
            </a>{' '}
            <a href='/install?name=recipe-box'>Get a copy</a>
          </p>
        </Card>
      </ul>
    </section>
    <section class='How' aria-labelledby='how'>
      <h2 class='Title' id='how'>How yaks.app works</h2>
      <ol class='Steps'>
        <li>
          <h3 class='Step_Name'>Connect the assistant you use</h3>
          <p class='Note'>
            Paste <a href='/agent'>yaks.app/agent</a>{' '}
            into Claude, ChatGPT or the AI assistant you already use.
          </p>
        </li>
        <li>
          <h3 class='Step_Name'>Ask for the app you want</h3>
          <p class='Note'>
            Tell your assistant what you need, like a chore chart for your
            household. Your assistant builds the app, and yaks.app puts it
            online.
          </p>
        </li>
        <li>
          <h3 class='Step_Name'>Open your app on any device</h3>
          <p class='Note'>
            Your apps live in your own space at{' '}
            <Yours />. Open one on your phone or computer, or send its link to
            the people it's for.
          </p>
        </li>
      </ol>
    </section>
    <section class='Yours' aria-labelledby='yours'>
      <h2 class='Title' id='yours'>Everything you make lives in a space</h2>
      <p class='Note Note-lead'>
        A space is an address like{' '}
        <Yours />, the apps there, their data and the people you invite. Each
        space is free or on a paid plan.
      </p>
      <dl class='Yours_List'>
        <div>
          <dt>It saves what people add</dt>
          <dd>
            Recipes, sign-ups, comments, photos and files are saved online, on
            every phone and computer, for everyone you share with.
          </dd>
        </div>
        <div>
          <dt>You choose who comes in</dt>
          <dd>
            Keep an app to yourself, share it with a link, or invite as many
            people as you like to view or edit it, free.
          </dd>
        </div>
        <div>
          <dt>Your assistant keeps working on it</dt>
          <dd>
            Ask for a new feature or a fix right from the chat. When an app
            breaks, your assistant is told about the error.
          </dd>
        </div>
      </dl>
    </section>
    <section class='Path' aria-labelledby='path'>
      <h2 class='Title' id='path'>From a tool for you to a business</h2>
      <dl class='Yours_List'>
        <div>
          <dt>Share it</dt>
          <dd>
            Invite your team, your family or your customers. The people you
            invite are free on every plan.
          </dd>
        </div>
        <div>
          <dt>Publish it</dt>
          <dd>
            Put your app in the{' '}
            <a href='/gallery'>gallery</a>, and anyone can get a copy of their
            own, with its own data.
          </dd>
        </div>
        <div>
          <dt>Sell it</dt>
          <dd>
            On the Plus plan, your apps take payments with Stripe and live at
            your own domain.
          </dd>
        </div>
      </dl>
    </section>
    <section class='Cost' aria-labelledby='cost'>
      <h2 class='Title' id='cost'>Free to start, a plan for more</h2>
      <div class='Plans'>
        <Card as='div' class='Plan'>
          <h3 class='Plan_Price'>Free</h3>
          <p class='Note Note-small'>Your first space.</p>
          <ul class='Plan_List'>
            <li>5 apps</li>
            <li>Unlimited visitors</li>
            <li>1 GB of app data, 1 GB of photos and files</li>
            <li>100 emails a month</li>
            <li>
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
            <li>Unlimited apps</li>
            <li>Unlimited visitors</li>
            <li>10 GB of app data, 50 GB of photos and files</li>
            <li>2,500 emails a month</li>
            <li>
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
        <Card as='div' class='Plan Plan-organization'>
          <h3 class='Plan_Price'>
            $49
            <span class='Plan_Per'>&#32;a month</span>
          </h3>
          <p class='Note Note-small'>
            The Organization plan, or $490 a year. Your staff ask by email or
            chat, and yaks.app makes the change.
          </p>
          <ul class='Plan_List'>
            <li>Unlimited apps</li>
            <li>Unlimited visitors</li>
            <li>10 GB of app data, 50 GB of photos and files</li>
            <li>2,500 emails a month</li>
            <li>
              Your own domain, like <b>ourtownship.org</b>
            </li>
          </ul>{' '}
          <Button
            mod='go'
            href={GET_PLAN}
            data-cta='organization'
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
      <h2 class='Title' id='join'>What would you like to make?</h2>
      <p class='Note'>
        Paste <a href='/agent'>yaks.app/agent</a>{' '}
        into the assistant you already use, and describe your first app.
      </p>
      <p class='Join_Doors'>
        <Button mod='go' href='/login' data-cta='join'>Start free</Button>
      </p>
      <p class='Note Note-small'>Free to start. Setup takes a few minutes.</p>
    </Card>
  </Page>
)
