/** @jsxImportSource preact */
import { keys, read } from '@yaks/copy'
import { Button, Card, Field } from '@yaks/ui'
import { GET_PLAN } from '@yaks/platform/routes'
import { START } from '../newcomer.ts'
import { Data, Page, Yours } from './frame.tsx'
import { attr, COPY, said, type Slots, text } from './copy.ts'
import { Idle } from '../mascot.ts'
import { Sky, Walk } from './sky.tsx'
import { BUILD, type Example, HOME } from '../demos.ts'

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
  'description': said(`home.data.${plan}.offer`),
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

/** The examples, one card at a time (carousel.js): apps in yourname's space,
 * each named by its address there (`data-demo`), which the served page swaps
 * for the gallery's cards (gallery.ts `showcase`), and under them what a
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

// A plan's card on the home page: its price, its note, its list and its
// button, each a snippet under `home.cost.<plan>`.
let Plan = (
  { plan, items, mod, href, cta }: {
    plan: string
    items: Record<string, Slots>
    mod?: string
    href: string
    cta?: string
  },
) => (
  <Card as='div' class={mod ? `Plan ${mod}` : 'Plan'}>
    <h3
      class='Plan_Price'
      {...text(`home.cost.${plan}.price`, {
        per: <span class='Plan_Per' {...text('home.cost.per')} />,
      })}
    />
    <p class='Note Note-small' {...text(`home.cost.${plan}.note`)} />
    <ul class='Plan_List'>
      {Object.entries(items).map(([item, slots]) => (
        <li class='Plan_Item' {...text(`home.cost.${plan}.${item}`, slots)} />
      ))}
    </ul>{' '}
    <Button
      mod='go'
      href={href}
      data-cta={cta}
      {...text(`home.cost.${plan}.go`)}
    />
  </Card>
)

/** What a space costs: what one is, a card for each plan, and where the
 * limits are. */
export let Cost = () => (
  <section class='Cost' aria-labelledby='cost'>
    <h2 class='Title' id='cost' {...text('home.cost.title')} />
    <p class='Note' {...text('home.cost.note', { yours: <Yours /> })} />
    <div class='Plans'>
      <Plan
        plan='free'
        href='/login'
        items={{
          apps: {},
          visitors: {},
          storage: {},
          emails: {},
          address: { yours: <Yours /> },
        }}
      />
      <Plan
        plan='plus'
        mod='Plan-plus'
        href={GET_PLAN}
        cta='plus'
        items={{
          apps: {},
          visitors: {},
          storage: {},
          emails: {},
          domain: { domain: <b {...text('home.cost.plus.example')} /> },
        }}
      />
      <Plan
        plan='pro'
        mod='Plan-pro'
        href={GET_PLAN}
        cta='pro'
        items={{
          apps: {},
          visitors: {},
          storage: {},
          emails: {},
          domain: { domain: <b {...text('home.cost.pro.example')} /> },
        }}
      />
    </div>
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
 * What one of the home pages `/` is split between (variant.ts) says of its
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

/** The home page that asks what a visitor needs (variant.ts `ask`). */
export let ASK: Pitch = {
  copy: 'home',
  apps: HOME,
  does: ['build', 'online', 'share'],
  steps: ['say', 'open', 'keep'],
}

/** The home page that leads with the app a visitor gets, and names the
 * Operator only once the app is in hand (variant.ts `describe`). */
export let DESCRIBE: Pitch = {
  copy: 'build',
  apps: BUILD,
  does: ['saves', 'opens', 'yours'],
  steps: ['describe', 'builds', 'keep', 'change'],
}

// The key of the snippet a pitch shows at `rest`: its own, else the home
// page's.
let worded = ({ copy }: Pitch) => (rest: string) =>
  read(COPY, `${copy}.${rest}`) == null ? `home.${rest}` : `${copy}.${rest}`

export let Home = ({ pitch }: { pitch: Pitch }) => {
  let key = worded(pitch), yours = { yours: <Yours /> }
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
          <div class='Hello_Yak' data-wander=''>
            <Idle class='Wander_Image' base='.' />
          </div>
          <p class='Hello_Kicker' {...text(key('hello.kicker'))} />
          <h1 class='Title Title-hero' id='hello'>
            <label for='say' {...text(key('hello.title'))} />
          </h1>
          {read(COPY, key('hello.lead')) != null && (
            <p class='Note' {...text(key('hello.lead'))} />
          )}
          <form class='Hello_Ask' method='post' action={START}>
            <Field
              class='Hello_Field'
              lines
              id='say'
              name='say'
              required
              maxLength={4000}
              {...attr('placeholder', key('hello.hint'))}
            />
            <Button
              mod='go'
              type='submit'
              data-cta='start'
              {...text(key('hello.go'))}
            />
          </form>
          <p
            class='Note Note-small'
            {...text(key('hello.note'), {
              price: <a href='#cost' {...text(key('hello.price'))} />,
              examples: (
                <a
                  href='#examples'
                  data-cta='examples'
                  {...text(key('hello.examples'), { arrow: arrow('↓') })}
                />
              ),
            })}
          />
        </div>
        <Examples
          apps={pitch.apps}
          note={key('examples.note')}
          slots={{
            gallery: <a href='/gallery' {...text(key('examples.gallery'))} />,
          }}
        />
      </section>
      <section class='Yours' aria-labelledby='does'>
        <h2 class='Title' id='does' {...text(key('does.title'))} />
        <dl class='Yours_List'>
          {pitch.does.map((item) => (
            <div>
              <dt class='Yours_Term' {...text(key(`does.${item}.term`))} />
              <dd
                class='Yours_Detail'
                {...text(key(`does.${item}.detail`), yours)}
              />
            </div>
          ))}
        </dl>
      </section>
      <section class='How' aria-labelledby='how'>
        <h2 class='Title' id='how' {...text(key('how.title'))} />
        <ol class='Steps'>
          {pitch.steps.map((step) => (
            <li class='Steps_Item'>
              <h3 class='Step_Name' {...text(key(`how.${step}.name`))} />
              <p class='Note' {...text(key(`how.${step}.detail`), yours)} />
            </li>
          ))}
        </ol>
        <p
          class='Note Note-small'
          {...text(key('how.agent'), {
            agent: <a href='/agent' {...text(key('how.address'))} />,
          })}
        />
      </section>
      <Cost />
      <Card class='Join' aria-labelledby='join'>
        <h2 class='Title' id='join' {...text(key('join.title'))} />
        <p class='Join_Doors'>
          <Button
            mod='go'
            href='#say'
            data-cta='join'
            {...text(key('join.go'))}
          />
        </p>
        <p class='Note Note-small' {...text(key('join.note'))} />
      </Card>
    </Page>
  )
}
