/** @jsxImportSource react */
import type { ReactElement, ReactNode } from 'react'
import { Button, Card, Copy as Copyable, Field, Icon } from '@yaks/ui'
import type { Tier } from '../plans.ts'
import { GET_PLAN } from '../routes.ts'
import { DEMOS, SCENES, TURNS } from './demos.ts'
import { GAME_DEMOS, GAME_FEATURES, GAME_SCENES } from './games.ts'
import { gift, ICONS, priceTag } from './icons.ts'
import { Phone, Picks, type Told } from './phone.tsx'
import { FEATURES, RUN } from './parts.ts'
import { Change, People, type Pictures, Scene, Services } from './scenes.tsx'
import type { Copy } from './words.ts'

export { FEATURES } from './parts.ts'

/**
 * What a landing page's story tells: its features in order, `build` first
 * as the hero (parts.ts `FEATURES`), the demos its phone plays, a turn of
 * each for each feature, each demo's pictures by its slug, and the
 * questions it answers, each by its name under `home.story.faq`. A page
 * with an `offer` says it under the hero's box, at `home.hello.offer`. The
 * words are the copy's the page is drawn with, so a page with words of its
 * own says them in the home page's parts.
 */
export type Landing = Told & {
  questions: readonly string[]
  offer?: boolean
}

/** The home page's story. */
export const HOMEPAGE: Landing = {
  features: TURNS,
  demos: DEMOS,
  scenes: SCENES,
  questions: ['code', 'access', 'limits', 'leave', 'data'],
}

/** The games landing page's story. */
export const GAMES: Landing = {
  features: GAME_FEATURES,
  demos: GAME_DEMOS,
  scenes: GAME_SCENES,
  questions: ['code', 'friends', 'devices', 'limits', 'leave'],
}

// The features with a picture of each demo's.
let PICTURED: Pictures[] = ['email', 'sell', 'helper', 'domain']
let pictured = (feature: string): feature is Pictures =>
  PICTURED.some((id) => id == feature)

let Ask = (
  { copy, action, id, cta }: {
    copy: Copy
    action: string
    id: string
    cta: string
  },
) => {
  let main = id == 'say'
  return (
    <form
      className={main ? 'Home_Ask Home_Ask-hero' : 'Home_Ask'}
      method='post'
      action={action}
    >
      <Field
        className='Home_Field'
        lines={main}
        id={id}
        name='say'
        required
        maxLength={4000}
        {...copy.attr(
          'placeholder',
          main ? 'home.hello.hint' : 'home.story.prompt',
        )}
        {...!main && copy.attr('aria-label', 'home.story.ask')}
      />
      <Button
        className='Home_Build'
        mod='go'
        type='submit'
        data-cta={cta}
        {...copy.text('home.hello.go')}
      />
    </form>
  )
}

/** The hero yak's run, as yak.js plays it: a step a click, each with its
 * line, and the start step with the words it types and what it says when
 * the box already holds the person's own. */
let YakRun = ({ copy }: { copy: Copy }) => (
  <ol className='Home_YakRun' data-yak-run='' hidden>
    {RUN.map((step) => (
      <li
        data-pose={step.pose}
        data-ms={step.ms}
        data-act={'act' in step ? step.act : undefined}
      >
        <span data-say='' {...copy.text(`home.yak.${step.pose}`)} />
        {'act' in step && step.act == 'start' && (
          <>
            <span data-had='' {...copy.text(`home.yak.${step.pose}-had`)} />
            <span data-type='' {...copy.text(`home.yak.${step.pose}-type`)} />
          </>
        )}
      </li>
    ))}
  </ol>
)

let Hero = (
  { copy, action, yak, works, offer }: {
    copy: Copy
    action: string
    yak: ReactNode
    works: boolean
    offer?: boolean
  },
) => (
  <section
    className='Hello Story_Hero'
    aria-labelledby='hello'
    data-story-step='0'
  >
    <div className='Hello_Copy Home_Words'>
      <p className='Hello_Kicker' {...copy.text('home.hello.kicker')} />
      <h1 className='Title Title-hero' id='hello'>
        <label htmlFor='say' {...copy.text('home.hello.title')} />
      </h1>
      <p
        className='Note Note-lead Home_Lead'
        {...copy.text('home.story.lead')}
      />
      <Ask copy={copy} action={action} id='say' cta='start' />
      {offer && (
        <p className='Note Home_Lead'>
          <b {...copy.text('home.hello.offer')} />
        </p>
      )}
      <p
        className='Note Note-small Home_Lead'
        {...copy.text('home.hello.note', {
          price: <a href='#cost' {...copy.text('home.hello.price')} />,
        })}
      />
      {works && (
        <div className='Home_Works'>
          <span {...copy.text('home.story.works')} />
          <Services short />
          <a href='#integrations' {...copy.text('home.story.more')} />
        </div>
      )}
      {yak}
      <YakRun copy={copy} />
      <div className='Sky_End' aria-hidden='true' />
    </div>
  </section>
)

let FeatureNav = (
  { copy, landing }: { copy: Copy; landing: Landing },
) => (
  <nav
    className='Home_Contents'
    {...copy.attr('aria-label', 'home.story.features')}
  >
    <ul className='Home_Jumps' data-feature-nav=''>
      {[...landing.features, 'pricing' as const].map((turn, i) => (
        <li className='Home_Jump'>
          <a
            className='Home_JumpLink'
            href={`#${turn == 'pricing' ? 'cost' : FEATURES[turn].section}`}
            data-feature-link={i}
            aria-current={i == 0 ? 'location' : undefined}
          >
            <Icon of={turn == 'pricing' ? priceTag : ICONS[turn]} />
            <span {...copy.text(`home.story.turn.${turn}.short`)} />
          </a>
        </li>
      ))}
    </ul>
  </nav>
)

let Features = (
  { copy, landing }: { copy: Copy; landing: Landing },
) => (
  <div className='Home_Features' id='examples'>
    {landing.features.slice(1).map((turn, j) => {
      let i = j + 1, key = `home.story.turn.${turn}`
      let { section, poses, points } = FEATURES[turn]
      let title = turn == 'email' ? 'email-in' : `title-${turn}`
      return (
        <section
          className='Home_Feature'
          id={section}
          aria-labelledby={title}
          data-story-step={i}
          data-story-pose={poses.join(' ')}
        >
          <h2 className='Title Home_FeatureTitle' id={title}>
            <span className='Home_Icon'>
              <Icon of={ICONS[turn]} />
            </span>
            <span {...copy.text(`${key}.heading`)} />
            <img
              className='Home_SectionYak'
              data-section-yak=''
              src='/mascot/idle-rest-128-1x.webp'
              alt=''
              width='80'
              height='80'
              loading='lazy'
            />
          </h2>
          <div className='Home_FeatureWords'>
            <p className='Note' {...copy.text(`${key}.body`)} />
            {points.length > 0 && (
              <ul className='Home_FeatureList'>
                {points.map((n) => (
                  <li key={n} {...copy.text(`${key}.point${n}`)} />
                ))}
              </ul>
            )}
          </div>
          {turn == 'change' && <Change copy={copy} />}
          {turn == 'team' && <People copy={copy} />}
          {turn == 'connect' && (
            <div className='Home_Connection'>
              <Services />
              <a
                href='/integrations'
                {...copy.text('home.story.connections')}
              />
            </div>
          )}
          {pictured(turn) && (
            <Scene id={turn} demos={landing.demos} scenes={landing.scenes} />
          )}
        </section>
      )
    })}
  </div>
)

let Details = (
  { copy, questions }: { copy: Copy; questions: readonly string[] },
) => (
  <div className='Home_Details'>
    <section className='Home_Detail' aria-labelledby='assistant'>
      <h2
        className='Title'
        id='assistant'
        {...copy.text('home.story.assistant.title')}
      />
      <p
        className='Note'
        {...copy.text('home.story.assistant.body', {
          agent: (
            <Copyable
              what='the connector address'
              go={{ 'data-copy-link': '' }}
            >
              yaks.app/agent
            </Copyable>
          ),
        })}
      />
      <a href='/agent' {...copy.text('home.story.assistant.more')} />
    </section>
    <section className='Home_Detail' aria-labelledby='questions'>
      <h2
        className='Title'
        id='questions'
        {...copy.text('home.story.faq.title')}
      />
      {questions.map((topic) => (
        <Card as='details' className='Home_Question'>
          <summary
            className='Home_Summary'
            {...copy.text(`home.story.faq.${topic}.question`)}
          />
          <p
            className='Note'
            {...copy.text(`home.story.faq.${topic}.answer`)}
          />
        </Card>
      ))}
    </section>
    <section className='Home_Detail' aria-labelledby='made'>
      <h2 className='Title' id='made' {...copy.text('home.story.company')} />
      <p
        className='Note'
        {...copy.text('home.made.us.detail', {
          mail: <a href='mailto:hello@yaks.app'>hello@yaks.app</a>,
        })}
      />
    </section>
  </div>
)

/** A landing page's conversation and the feature sections it illustrates,
 * the home page's unless the page tells its own. */
export let Story = (
  { copy, action, yak, plans, landing = HOMEPAGE }: {
    copy: Copy
    action: string
    yak: ReactNode
    plans: ReactNode
    landing?: Landing
  },
) => (
  <div className='Home_Story' data-story=''>
    <div className='Home_SkySpace' aria-hidden='true'>
      <span className='Home_MoonSlot' data-moon-at='' />
    </div>
    <div className='Home_Desk'>
      <Hero
        copy={copy}
        action={action}
        yak={yak}
        works={landing.features.includes('connect')}
        offer={landing.offer}
      />
      <FeatureNav copy={copy} landing={landing} />
      <aside className='Home_Demo' aria-label='Example' data-story-demo=''>
        <Phone told={landing} />
        <Picks demos={landing.demos} />
        <Ask copy={copy} action={action} id='example-say' cta='walk' />
      </aside>
      <Features copy={copy} landing={landing} />
    </div>
    <div className='Home_After'>
      <div className='Home_Pricing' data-story-step=''>
        {plans}
        <Card className='Home_Reward'>
          <Icon of={gift} />
          <div className='Home_RewardWords'>
            <b {...copy.text('home.story.pricing.reward.title')} />
            <p
              className='Note'
              {...copy.text('home.story.pricing.reward.body')}
            />
          </div>
        </Card>
      </div>
      <Details copy={copy} questions={landing.questions} />
    </div>
  </div>
)

let COLUMNS = [
  ['product', [
    ['features', '/#how'],
    ['integrations', '/integrations'],
    ['gallery', '/gallery'],
    ['pricing', '/pricing'],
    ['sign-in', '/login'],
  ]],
  ['audience', [
    ['churches', '/churches'],
    ['organizations', '/organizations'],
    ['townships', '/townships'],
  ]],
  ['help', [['help', '/help'], ['docs', '/docs'], ['agent', '/agent'], [
    'operator',
    '/operator',
  ]]],
  ['company', [['terms', '/terms'], ['privacy', '/privacy'], [
    'acceptable-use',
    '/acceptable-use',
  ], ['cookies', '/cookies']]],
] as const

let PLAN_FEATURES = [
  'ai',
  'apps',
  'connections',
  'visitors',
  'data',
  'files',
  'emails',
]

/** The same plan card on the home and pricing pages, with room for a page's
 * selection of features. */
export let Plan = (
  { copy, plan, items, slots, cta }: {
    copy: Copy
    plan: Tier
    items: readonly string[]
    slots?: Record<string, ReactElement>
    cta?: string
  },
) => {
  let at = `home.cost.${plan}`
  let free = plan == 'free'
  return (
    <Card as='div' className={free ? 'Plan' : `Plan Plan-${plan}`}>
      <h3
        className='Plan_Price'
        {...copy.text(`${at}.price`, {
          per: <span className='Plan_Per' {...copy.text('home.cost.per')} />,
        })}
      />
      <p className='Note Note-small' {...copy.text(`${at}.note`)} />
      <ul className='Plan_List'>
        <li className='Plan_Credit'>
          <Icon className='Plan_CreditIcon' of={gift} />
          <span {...copy.text(`${at}.credit`)} />
        </li>
        {[...PLAN_FEATURES, ...items].map((item) => (
          <li className='Plan_Item' {...copy.text(`${at}.${item}`, slots)} />
        ))}
      </ul>{' '}
      <Button
        mod='go'
        href={free ? '/login' : GET_PLAN}
        data-cta={cta}
        {...copy.text(`${at}.go`)}
      />
    </Card>
  )
}

export let StoryFooter = (
  { copy, action, yak }: { copy: Copy; action: string; yak: ReactNode },
) => (
  <footer className='Foot Home_Foot'>
    <div className='Home_FootLead' id='join'>
      {yak}
      <div className='Home_Join'>
        <h2 className='Title' {...copy.text('home.join.title')} />
        <Ask copy={copy} action={action} id='join-say' cta='join' />
        <p className='Note Note-small' {...copy.text('home.join.note')} />
      </div>
    </div>
    <nav
      className='Home_FootLinks'
      {...copy.attr('aria-label', 'home.story.footer.label')}
    >
      {COLUMNS.map(([column, links]) => (
        <div className='Home_FootColumn'>
          <h2
            className='Home_FootTitle'
            {...copy.text(`home.story.footer.${column}`)}
          />
          <ul className='Home_FootList'>
            {links.map(([name, href]) => (
              <li>
                <a
                  className='Foot_Link'
                  href={href}
                  {...copy.text(`home.story.footer.links.${name}`)}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
    <div className='Home_FootBy'>
      <p {...copy.text('frame.foot.by')} />
      <a className='Foot_Link' href='mailto:hello@yaks.app'>hello@yaks.app</a>
    </div>
  </footer>
)
