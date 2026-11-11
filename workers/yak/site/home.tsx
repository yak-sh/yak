/** @jsxImportSource preact */
// The home page: a working sign-up sheet a visitor can type in, the box that
// builds theirs, and under them what the product offers. The sheet is an app
// of the demo space (gallery-demo.ts `DEMO`), private and published, so each
// visitor reads its sample and writes in a store of their own (visit.ts):
// nothing one visitor types is shown to the next.
import type { ComponentChildren } from 'preact'
import { Button, Card, Field } from '@yaks/ui'
import { GET_PLAN } from '../route.ts'
import { KEEPING, START } from '../newcomer.ts'
import { FREE, PRICE, YEARLY } from '../meter.ts'
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
        'Type what you need, like a sign-up sheet, a schedule or a member list, and an AI assistant builds it as a web page.',
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
        'Type what you need, like a sign-up sheet, a schedule or a member list for your group, and an AI assistant called your Operator builds it as a web page at yourname.yaks.app that works on any phone and saves what people enter. Change it by asking, by chat, email or text.',
      'featureList': [
        'Sign-up sheets, schedules, member lists and websites, built from a description',
        'An Operator that changes them when you ask by chat, email or text',
        'Sign-in by a code sent to email, for the people you invite',
        'Forms, a members-only directory and a calendar feed',
        'The last 20 versions kept, and 30 days to bring back anything deleted',
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

// The apps a carousel turns through on a page that names none of its own:
// each one's address in yourname's space, its name and what it is for.
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

/** The examples, one card at a time (carousel.js), under what they are
 * (`title`): apps in yourname's space, each named by its address there
 * (`data-demo`), which the served page swaps for the gallery's cards
 * (gallery.ts `showcase`), and under them what a visitor can do with one. */
export let Examples = (
  { children, apps = EXAMPLES, title = 'Apps made with yaks.app' }: {
    children: ComponentChildren
    apps?: string[][]
    title?: string
  },
) => (
  <section
    class='Demo'
    aria-labelledby='examples'
    aria-roledescription='carousel'
    data-carousel=''
  >
    <h2 class='Demo_Title' id='examples'>{title}</h2>
    <ul class='Demo_Slides'>
      {apps.map(([slug, title, sub]) => (
        <Card as='li' class='Make_Card' data-demo={slug}>
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
        aria-label='Previous example'
      >
        ‹
      </Button>{' '}
      <div class='Demo_Dots' />{' '}
      <Button
        class='Demo_Step'
        type='button'
        data-step='1'
        aria-label='Next example'
      >
        ›
      </Button>{' '}
      <Button class='Demo_Pause' type='button'>Pause</Button>
    </div>
    <p class='Note Note-small'>{children}</p>
  </section>
)

/** What a space costs: what one is, and what the page until here called
 * "each one" is called on a plan's card, then a card for each plan, and where
 * the limits are. */
export let Cost = () => (
  <section class='Cost' aria-labelledby='cost'>
    <h2 class='Title' id='cost'>
      Free for your first {FREE.apps}, or ${PRICE.plus}{' '}
      a month for as many as you like
    </h2>
    <p class='Note'>
      The plans use two words. An app is one thing you make, like a sign-up
      sheet. A space is your web address, like{' '}
      <Yours />, with all your apps and the people you invite. Your first space
      is free, and a plan covers a whole space, with no charge for each person.
    </p>
    <div class='Plans'>
      <Card as='div' class='Plan'>
        <h3 class='Plan_Price'>Free</h3>
        <p class='Note Note-small'>
          Your first space, for as long as you like.
        </p>
        <ul class='Plan_List'>
          <li class='Plan_Item'>{FREE.apps} apps</li>
          <li class='Plan_Item'>Unlimited visitors</li>
          <li class='Plan_Item'>
            1 GB of app data, 1 GB of photos and files
          </li>
          <li class='Plan_Item'>100 emails a month</li>
          <li class='Plan_Item'>
            A web address like <Yours />
          </li>
        </ul>{' '}
        <Button mod='go' href='/login'>Start Free</Button>
      </Card>
      <Card as='div' class='Plan Plan-plus'>
        <h3 class='Plan_Price'>
          ${PRICE.plus}
          <span class='Plan_Per'>&#32;a month</span>
        </h3>
        <p class='Note Note-small'>
          The Plus plan, for each space. Take card payments, through Stripe.
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
          ${PRICE.pro}
          <span class='Plan_Per'>&#32;a month</span>
        </h3>
        <p class='Note Note-small'>
          The Pro plan, or ${YEARLY.pro}{' '}
          a year, for an organization. Your staff ask the Operator by email or
          chat, and it makes the change.
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
      Tax is included. Going over a limit never deletes your apps or data.{' '}
      <a href='/pricing'>Compare plans and limits</a>.
    </p>
  </section>
)

// The sheet at the top of the page: its address in yourname's space. It was
// built there from the four words the caption quotes.
let SHEET = 'https://yourname.yaks.app/potluck/'

// The other examples, things for a group first.
let MORE = [
  [
    'directory',
    'Church Directory',
    'A members-only directory with families, photos and birthdays.',
  ],
  ['bookclub', 'Book Club', 'Choose books and plan your next meeting.'],
  [
    'menu',
    'Wren’s Bakery',
    'A market stall’s menu with prices, marked sold out from a phone.',
  ],
  ['trip', 'Travel Planner', "Plan the days, who's coming and what to pack."],
  [
    'guestbook',
    'Birthday Guestbook',
    'Collect birthday messages from friends.',
  ],
  ['chores', 'Chore Chart', 'Keep track of whose turn it is.'],
  ['recipes', 'Recipe Box', 'Save recipes and share them with family.'],
]

// How long what a visitor built is kept before they give an email.
let DAYS = KEEPING / 86_400_000

export let Home = () => (
  <Page
    name='yaks.app — type what you need, and it is built for you'
    title='yaks.app — type what you need, and it is built for you'
    description='Type what you need, like a sign-up sheet, a schedule or a member list for your group, and an AI assistant makes it as a web page that works on any phone. Free to try, with no account and no card.'
    path='/'
    kind='Home'
    head={
      <>
        <script src='carousel.js' defer />
        <script src='wander.js' defer />
        <script src='cta.js' defer />
        <script src='stay.js' defer />
        <Data of={data} />
      </>
    }
  >
    <section class='Hello Hello-demo' aria-labelledby='hello'>
      <figure class='Sheet'>
        <figcaption class='Sheet_Said'>
          <div class='Hello_Yak' data-wander=''>
            <Idle class='Wander_Image' base='.' />
          </div>
          <p>
            Someone typed “a potluck sign-up sheet” and got this page. This one
            is an example for you to try.
          </p>
        </figcaption>
        <Card as='div' class='Sheet_Frame'>
          <iframe
            class='Sheet_Page'
            src={SHEET}
            title='A potluck sign-up sheet you can type in'
          />
        </Card>
      </figure>
      <div class='Hello_Copy'>
        <h1 class='Title Title-hero' id='hello'>
          <label for='say'>Type what you need</label>
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
        <p class='Note'>
          Free to try, with no account and no card. An AI assistant makes yours
          in a minute or two.
        </p>
        <p class='Note Note-small'>
          Your first {FREE.apps} are free ({FREE.apps} sign-up sheets, say), and
          {' '}
          <a href='#cost'>${PRICE.plus} a month</a> covers as many as you like.
        </p>
        <p class='Note Note-small'>
          <a href='#made'>Made by a small company in Michigan</a>.{' '}
          <a href='#examples' data-cta='examples'>
            See more examples <span aria-hidden='true'>↓</span>
          </a>
        </p>
      </div>
    </section>
    <section class='For' aria-labelledby='for'>
      <div class='For_Copy'>
        <h2 class='Title' id='for'>
          Make a sign-up sheet, a schedule or a member list for your group, and
          send them the link.
        </h2>
        <p class='Note'>
          It's a web page, so it opens on any phone, and nobody has to install
          anything to use it.
        </p>
      </div>
      <Examples apps={MORE} title='More examples, each one live'>
        Open one to try it, or get a copy of your own and ask for changes.{' '}
        <a href='/gallery'>See more in the gallery</a>.
      </Examples>
    </section>
    <section class='Yours' aria-labelledby='does'>
      <h2 class='Title' id='does'>What each one can do</h2>
      <dl class='Yours_List'>
        <div>
          <dt class='Yours_Term'>It saves what people enter</dt>
          <dd class='Yours_Detail'>
            Names, notes, photos and files are kept, and everyone sees the same
            thing on any phone or computer.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>You choose who can open it</dt>
          <dd class='Yours_Detail'>
            Anyone with the link, with no account needed, or only the people you
            invite, who sign in with a code sent to their email. You also choose
            whether they can change it or only look.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>Forms, member lists and calendars</dt>
          <dd class='Yours_Detail'>
            A form that takes sign-ups, a list only members can open, and a
            calendar people add to their phones.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>It can send and receive email</dt>
          <dd class='Yours_Detail'>
            Each one has an email address of its own, to send a confirmation or
            a weekly note and keep what people write back.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>A mistake can be undone</dt>
          <dd class='Yours_Detail'>
            The last 20 versions are kept, and anything deleted can be brought
            back for 30 days.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>What is in it stays yours</dt>
          <dd class='Yours_Detail'>
            Ask for everything in it as a spreadsheet, or delete it, whenever
            you like. We never sell it.
          </dd>
        </div>
      </dl>
    </section>
    <section class='How' aria-labelledby='how'>
      <h2 class='Title' id='how'>
        An AI assistant builds it, and changes it when you ask
      </h2>
      <ol class='Steps'>
        <li class='Steps_Item'>
          <h3 class='Step_Name'>Type what you need</h3>
          <p class='Note'>
            Use the box at the top of this page, in your own words. There is
            nothing to install.
          </p>
        </li>
        <li class='Steps_Item'>
          <h3 class='Step_Name'>Watch it get built</h3>
          <p class='Note'>
            Your AI assistant builds it and puts it online while you watch. We
            call it your Operator. Open what it built on your phone, or send its
            link to the people it's for.
          </p>
        </li>
        <li class='Steps_Item'>
          <h3 class='Step_Name'>Keep it, and change it by asking</h3>
          <p class='Note'>
            What it built is kept for {DAYS}{' '}
            days. Enter your email in that time and it's yours for good, at a
            web address like{' '}
            <Yours />. Want a new column, another page or a fix? Tell your
            Operator by chat or email, or by text once you give it your mobile
            number.
          </p>
        </li>
      </ol>
      <p class='Note Note-small'>
        Already have a website? Type its address in the box instead, and you get
        a new version of it made here, for only you to look at. Nothing happens
        to the site you have.
      </p>
      <p class='Note Note-small'>
        Already use Claude, Cursor or another AI assistant? Paste{' '}
        <a href='/agent'>yaks.app/agent</a> into it, and it can build here too.
      </p>
    </section>
    <Cost />
    <section class='Made' aria-labelledby='made'>
      <h2 class='Title' id='made'>Made by a small company in Michigan</h2>
      <p class='Note'>
        We're Yak Shaving LLC, a small software company in Sturgis, Michigan.
        Write to <a href='mailto:hello@yaks.app'>hello@yaks.app</a>{' '}
        and a person answers.
      </p>
    </section>
    <Card class='Join' aria-labelledby='join'>
      <h2 class='Title' id='join'>What do you need?</h2>
      <p class='Join_Doors'>
        <Button mod='go' href='#say' data-cta='join'>Build yours</Button>
      </p>
      <p class='Note Note-small'>
        Free to try, with no account and no card.
      </p>
    </Card>
    <p class='Stay' data-stay='.Hello_Ask, .Join, .Foot' hidden>
      <Button mod='go' href='#say' data-cta='stay'>Build yours</Button>
    </p>
  </Page>
)
