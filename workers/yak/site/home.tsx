/** @jsxImportSource preact */
import { keys, read } from '@yaks/copy'
import { Button, Card, Field, Form } from '@yaks/ui'
import { Plan, Story, StoryFooter } from '@yaks/platform/home'
import { START } from '../newcomer.ts'
import { Data, Page, Yours } from './frame.tsx'
import { attr, COPY, said, type Slots, text, voiced } from './copy.ts'
import { Idle } from '../mascot.ts'
import { Sky, Walk } from '@yaks/platform/home/sky'
import { BUILD, DEMO_AT, type Example, HOME } from '../demos.ts'

// A plan's price in dollars, as its card says it: "Free" is none.
let dollars = (plan: string) =>
  /\$(\d+)/.exec(said(`home.cost.${plan}.price`))?.[1] ?? '0'

// A plan's offer: its name, its card's price, and what it is for.
let offer = (plan: string) => ({
  '@type': 'Offer',
  'name': said(`home.data.${plan}.name`),
  'price': dollars(plan),
  'priceCurrency': 'USD',
  'url': 'https://yaks.app/pricing',
  'availability': 'https://schema.org/InStock',
  'description': `${said(`home.data.${plan}.offer`)} ${
    said(`home.cost.${plan}.credit`)
  } ${said(`home.cost.${plan}.ai`)}.`,
  ...(plan == 'free' ? {} : {
    'priceSpecification': {
      '@type': 'UnitPriceSpecification',
      'price': dollars(plan),
      'priceCurrency': 'USD',
      'valueAddedTaxIncluded': true,
      'billingDuration': 1,
      'billingIncrement': 1,
      'unitCode': 'MON',
    },
  }),
})

/** What an engine reads of the page, in the page's own words. */
export let data = () => ({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': 'https://yaks.app/#website',
      'url': 'https://yaks.app/',
      'name': 'yaks.app',
      'alternateName': said('home.data.alternate'),
      'description': said('home.data.site'),
      'inLanguage': 'en-US',
      'publisher': {
        '@id': 'https://yaks.app/#organization',
      },
    },
    {
      '@type': 'Organization',
      '@id': 'https://yaks.app/#organization',
      'name': said('home.data.organization'),
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
      'description': said('home.data.app'),
      'featureList': keys(COPY)
        .filter((key) => key.startsWith('home.data.features.'))
        .map((key) => said(key)),
      'publisher': {
        '@id': 'https://yaks.app/#organization',
      },
      'offers': ['free', 'plus', 'pro'].map(offer),
    },
  ],
})

/** More examples, one card at a time (carousel.js): apps in yourname's space,
 * each named by its address there (`data-demo`), which the served page swaps
 * for the gallery's cards (gallery.ts `showcase`) after leaving out each app
 * it walks through (walkthrough.ts `walkedInto`), and under them what a
 * visitor can do with one, the snippet at `note` with its `slots`. */
export let Examples = (
  { note, slots, apps = HOME }: {
    note: string
    slots?: Slots
    apps?: Example[]
  },
) => (
  <section
    class='Demo'
    aria-labelledby='examples'
    aria-roledescription='carousel'
    data-carousel=''
  >
    <h2 class='Demo_Title' id='examples' {...text('home.examples.title')} />
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
        {...attr('aria-label', 'home.examples.previous')}
      >
        ‹
      </Button>{' '}
      <div class='Demo_Dots' />{' '}
      <Button
        class='Demo_Step'
        type='button'
        data-step='1'
        {...attr('aria-label', 'home.examples.next')}
      >
        ›
      </Button>{' '}
      <Button
        class='Demo_Pause'
        type='button'
        {...text('home.examples.pause')}
      />
    </div>
    <p class='Note Note-small' {...text(note, slots)} />
  </section>
)

// The names one level under `prefix` in the copy, in the file's order.
let under = (prefix: string) => [
  ...new Set(
    keys(COPY).filter((key) => key.startsWith(`${prefix}.`))
      .map((key) => key.slice(prefix.length + 1).split('.')[0]),
  ),
]

/** The apps the home page walks through (walkthrough.ts), each by its
 * address in yourname's space: every app with words under `home.walk.apps`,
 * so an app is added by its words and its recorded conversation alone. */
export let WALKS = under('home.walk.apps')

/** The steps of an app's walkthrough, by their names under its words. */
export let stepsOf = (app: string) => under(`home.walk.apps.${app}.steps`)

// One step of a walkthrough: what it shows in words, with the button, and
// beside them its exchange, the app as that step released it and a box to
// ask for a change of the visitor's own. The exchange and the picture are
// the served page's to fill (walkthrough.ts `walkedInto`), from the recorded
// conversation, by `data-walk-talk` and `data-walk-shot`.
let Step = ({ app, step }: { app: string; step: string }) => {
  let at = `home.walk.apps.${app}.steps.${step}`
  return (
    <li class='Walk_Step' data-walk-step={step}>
      <div class='Walk_Copy'>
        <h4 class='Walk_Title' {...text(`${at}.title`)} />
        <p class='Note' {...text(`${at}.body`)} />
        <Button mod='go' href='#say' data-cta='walk' {...text(`${at}.go`)} />
      </div>
      <div class='Walk_Shown'>
        <div class='Walk_Talk' data-walk-talk={`${app}/${step}`} />
        <a
          class='Walk_Shot'
          href={`${DEMO_AT}${app}/`}
          tabindex={-1}
          aria-hidden='true'
        >
          <span class='Walk_Picture' data-walk-shot={`${app}/${step}`} />
        </a>
        <form class='Walk_Ask' method='post' action={START}>
          <Form.Hidden name='demo' value={app} />
          <Form.Hidden name='step' value={step} />
          <label
            class='Walk_Label'
            for={`ask-${app}-${step}`}
            {...text('home.walk.ask.label')}
          />
          <Field
            class='Walk_Field'
            id={`ask-${app}-${step}`}
            name='say'
            required
            maxLength={4000}
            {...attr('placeholder', 'home.walk.ask.hint')}
          />
          <Button
            type='submit'
            data-cta='walk-ask'
            {...text('home.walk.ask.go')}
          />
        </form>
      </div>
    </li>
  )
}

// The link after an app's last step to the next app's first.
let Next = ({ app }: { app: string }) => (
  <p class='Walk_Next' data-walk-next={app}>
    <a
      href={`#walk-${app}`}
      {...text('home.walk.next', {
        app: <span {...text(`home.walk.apps.${app}.name`)} />,
        arrow: arrow('→'),
      })}
    />
  </p>
)

/** A demo app beside the conversation that built it, one step at a time
 * as the visitor scrolls (D-462), for each app of `WALKS`; above them a row
 * of their names, which walk.js shows when there are several. The served
 * page drops an app whose conversation is not recorded yet, and the whole
 * section while none is (walkthrough.ts `walkedInto`). */
export let Walkthrough = () => (
  <section class='Walk' aria-labelledby='walk' data-walks=''>
    <h2 class='Title' id='walk' {...text('home.walk.title')} />
    <p class='Note' {...text('home.walk.note')} />
    <nav class='Walk_Names' hidden {...attr('aria-label', 'home.walk.names')}>
      {WALKS.map((app) => (
        <Button
          mod='quiet'
          type='button'
          data-walk-name={app}
          {...text(`home.walk.apps.${app}.name`)}
        />
      ))}
    </nav>
    {WALKS.map((app, i) => (
      <article class='Walk_App' id={`walk-${app}`} data-walk={app}>
        <h3 class='Walk_Name' {...text(`home.walk.apps.${app}.name`)} />
        <ol class='Walk_Steps'>
          {stepsOf(app).map((step) => (
            <Step
              key={step}
              app={app}
              step={step}
            />
          ))}
        </ol>
        <p class='Note Note-small'>
          <a
            href={`${DEMO_AT}${app}/`}
            {...text('home.walk.open', {
              app: <span {...text(`home.walk.apps.${app}.name`)} />,
              arrow: arrow('↗'),
            })}
          />
        </p>
        {WALKS.length > 1 && <Next app={WALKS[(i + 1) % WALKS.length]} />}
      </article>
    ))}
  </section>
)

/** The space and what a subscription pays for, above the plan cards. */
export let CostNote = ({ class: classes = 'Note' }: { class?: string }) => (
  <p
    class={classes}
    {...text('home.cost.note', {
      yours: <Yours />,
      space: <strong {...text('home.cost.space')} />,
    })}
  />
)

/** What a space costs: what one is, a card for each plan, and where the
 * limits are. */
export let Cost = ({ story }: { story?: boolean } = {}) => (
  <section class='Cost' aria-labelledby='cost'>
    <h2
      class='Title'
      id='cost'
      {...text(story ? 'home.story.pricing.heading' : 'home.cost.title')}
    />
    <CostNote />
    <div class='Plans'>
      <Plan
        copy={{ attr, text }}
        plan='free'
        items={['address']}
        slots={{ yours: <Yours /> }}
      />
      <Plan
        copy={{ attr, text }}
        plan='plus'
        cta='plus'
        items={['domain', 'renewal', 'payments']}
        slots={{ domain: <b {...text('home.cost.plus.example')} /> }}
      />
      <Plan
        copy={{ attr, text }}
        plan='pro'
        cta='pro'
        items={['domain', 'renewal', 'change']}
        slots={{ domain: <b {...text('home.cost.pro.example')} /> }}
      />
    </div>
    <p class='Note Note-small' {...text('pricing.plans.renewal')} />
    <p class='Note Note-small' {...text('home.cost.ai')} />
    <p
      class='Note Note-small'
      {...text('home.cost.limits', {
        plans: <a href='/pricing' {...text('home.cost.plans')} />,
      })}
    />
  </section>
)

/** A link's arrow, which a screen reader skips: the slot `arrow` of a
 * snippet. */
export let arrow = (glyph: string) => <span aria-hidden='true'>{glyph}</span>

/**
 * What one of the home pages (variant.ts), `/` or /build, says of its
 * own: `copy`, the key its words are under, and the examples it shows, what
 * it says every app does and the steps it says it takes, each by its name
 * under `does` and `how`. A word its copy lacks is the home page's, so a
 * change to one reaches both.
 */
export type Pitch = {
  copy: string
  apps: Example[]
  does: string[]
  steps: string[]
}

/** The home page that leads with the app a visitor gets, and names the
 * Operator only once the app is in hand (variant.ts `describe`). */
export let DESCRIBE: Pitch = {
  copy: 'build',
  apps: BUILD,
  does: ['saves', 'opens', 'yours'],
  steps: ['describe', 'builds', 'keep', 'change'],
}

// What an app does after someone uses it, and who stands behind it: each a
// term and its detail under `home.work` and `home.made`, on every home page.
let WORK = ['signup', 'hold', 'friday', 'minutes']
let MADE = ['us', 'fixed', 'yours']

let yak = () => (
  <div class='Hello_Yak' data-wander=''>
    <Idle class='Wander_Image' base='.' />
  </div>
)

/** The homepage keeps the shared frame, copy and plan cards. */
export let StoryHome = () => (
  <Page
    copy='home'
    path='/'
    kind='Home Story_Page'
    sheet='_home.css'
    sections
    head={
      <>
        <script type='module' src='_home.js' />
        <Walk />
        <script src='cta.js' defer />
        <Data of={data()} />
      </>
    }
    before={<Sky landscape />}
    foot={
      <StoryFooter
        copy={{ attr, text }}
        action={START}
        yak={<Idle class='Yak Yak-small' base='.' />}
      />
    }
  >
    <Story
      copy={{ attr, text }}
      action={START}
      yak={yak()}
      plans={<Cost story />}
    />
  </Page>
)

export let Home = ({ pitch }: { pitch: Pitch }) => {
  let own = voiced(pitch.copy), yours = { yours: <Yours /> }
  return (
    <Page
      copy={pitch.copy}
      path='/'
      kind='Home'
      head={
        <>
          <script src='carousel.js' defer />
          <Walk />
          <script src='cta.js' defer />
          <Data of={data()} />
        </>
      }
      before={<Sky />}
    >
      <section class='Hello' aria-labelledby='hello'>
        <div class='Hello_Copy'>
          {yak()}
          <p class='Hello_Kicker' {...own.text('home.hello.kicker')} />
          <h1 class='Title Title-hero' id='hello'>
            <label for='say' {...own.text('home.hello.title')} />
          </h1>
          {read(COPY, own.key('home.hello.lead')) != null && (
            <p class='Note' {...own.text('home.hello.lead')} />
          )}
          <form class='Hello_Ask' method='post' action={START}>
            <Field
              class='Hello_Field'
              lines
              id='say'
              name='say'
              required
              maxLength={4000}
              {...own.attr('placeholder', 'home.hello.hint')}
            />
            <Button
              mod='go'
              type='submit'
              data-cta='start'
              {...own.text('home.hello.go')}
            />
          </form>
          <p
            class='Note Note-small'
            {...own.text('home.hello.note', {
              price: <a href='#cost' {...own.text('home.hello.price')} />,
              examples: (
                <a
                  href='#examples'
                  data-cta='examples'
                  {...own.text('home.hello.examples')}
                />
              ),
            })}
          />
        </div>
        <Examples
          apps={pitch.apps}
          note={own.key('home.examples.note')}
          slots={{
            gallery: (
              <a href='/gallery' {...own.text('home.examples.gallery')} />
            ),
          }}
        />
      </section>
      <section class='Yours' aria-labelledby='does'>
        <h2 class='Title' id='does' {...own.text('home.does.title')} />
        <dl class='Yours_List'>
          {pitch.does.map((item) => (
            <div>
              <dt class='Yours_Term' {...own.text(`home.does.${item}.term`)} />
              <dd
                class='Yours_Detail'
                {...own.text(`home.does.${item}.detail`, yours)}
              />
            </div>
          ))}
        </dl>
      </section>
      <section class='Work' aria-labelledby='work'>
        <h2 class='Title' id='work' {...text('home.work.title')} />
        <p class='Note' {...text('home.work.note')} />
        <dl class='Yours_List Yours_List-pairs'>
          {WORK.map((item) => (
            <div>
              <dt class='Yours_Term' {...text(`home.work.${item}.term`)} />
              <dd class='Yours_Detail' {...text(`home.work.${item}.detail`)} />
            </div>
          ))}
        </dl>
      </section>
      <section class='How' aria-labelledby='how'>
        <h2 class='Title' id='how' {...own.text('home.how.title')} />
        <ol class='Steps'>
          {pitch.steps.map((step) => (
            <li class='Steps_Item'>
              <h3 class='Step_Name' {...own.text(`home.how.${step}.name`)} />
              <p class='Note' {...own.text(`home.how.${step}.detail`, yours)} />
            </li>
          ))}
        </ol>
        <p
          class='Note Note-small'
          {...own.text('home.how.agent', {
            agent: <a href='/agent' {...own.text('home.how.address')} />,
          })}
        />
      </section>
      <Cost />
      <section class='Yours' aria-labelledby='made'>
        <h2 class='Title' id='made' {...text('home.made.title')} />
        <dl class='Yours_List'>
          {MADE.map((item) => (
            <div>
              <dt class='Yours_Term' {...text(`home.made.${item}.term`)} />
              <dd
                class='Yours_Detail'
                {...text(
                  `home.made.${item}.detail`,
                  item == 'us'
                    ? {
                      mail: <a href='mailto:hello@yaks.app'>hello@yaks.app</a>,
                    }
                    : {},
                )}
              />
            </div>
          ))}
        </dl>
      </section>
      <Card class='Join' aria-labelledby='join'>
        <h2 class='Title' id='join' {...own.text('home.join.title')} />
        <p class='Join_Doors'>
          <Button
            mod='go'
            href='#say'
            data-cta='join'
            {...own.text('home.join.go')}
          />
        </p>
        <p class='Note Note-small' {...own.text('home.join.note')} />
      </Card>
    </Page>
  )
}
