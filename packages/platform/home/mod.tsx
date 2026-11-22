/** @jsxImportSource preact */
import type { ComponentChildren, VNode } from 'preact'
import { Button, Card, Copy as Copyable, Field, Icon } from '@yaks/ui'
import type { Tier } from '../plans.ts'
import { GET_PLAN } from '../routes.ts'
import { TURNS } from './demos.ts'
import { gift, ICONS } from './icons.ts'
import { Phone, Picks } from './phone.tsx'
import { POSES, SECTIONS } from './parts.ts'
import { Change, People, Scene, Services } from './scenes.tsx'
import type { Copy } from './words.ts'

let [, ...FEATURE_TURNS] = TURNS

let POINTS = {
  change: [2, 3],
  connect: [1, 2, 3],
  send: [1, 2, 3],
  sell: [1, 2, 3],
  helper: [1, 2, 3],
  team: [1, 3],
} as const
let SCENES = {
  send: 'send',
  receive: 'receive',
  sell: 'sell',
  helper: 'helper',
  domain: 'domain',
} as const

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
      class={main ? 'Home_Ask Home_Ask-hero' : 'Home_Ask'}
      method='post'
      action={action}
    >
      <Field
        class='Home_Field'
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
        class='Home_Build'
        mod='go'
        type='submit'
        data-cta={cta}
        {...copy.text('home.hello.go')}
      />
    </form>
  )
}

let Hero = (
  { copy, action, yak }: { copy: Copy; action: string; yak: ComponentChildren },
) => (
  <section class='Hello Story_Hero' aria-labelledby='hello' data-story-step='0'>
    <div class='Hello_Copy Home_Words'>
      <p class='Hello_Kicker' {...copy.text('home.hello.kicker')} />
      <h1 class='Title Title-hero' id='hello'>
        <label for='say' {...copy.text('home.hello.title')} />
      </h1>
      <p class='Note Note-lead Home_Lead' {...copy.text('home.story.lead')} />
      <Ask copy={copy} action={action} id='say' cta='start' />
      <p
        class='Note Note-small Home_Lead'
        {...copy.text('home.hello.note', {
          price: <a href='#cost' {...copy.text('home.hello.price')} />,
          examples: (
            <a
              href='#examples'
              data-cta='examples'
              {...copy.text('home.hello.examples')}
            />
          ),
        })}
      />
      <div class='Home_Works'>
        <span {...copy.text('home.story.works')} />
        <Services short />
        <a href='#integrations' {...copy.text('home.story.more')} />
      </div>
      {yak}
      <div class='Sky_End' aria-hidden='true' />
    </div>
  </section>
)

let FeatureNav = ({ copy }: { copy: Copy }) => (
  <nav
    class='Home_Contents'
    {...copy.attr('aria-label', 'home.story.features')}
  >
    <ul class='Home_Jumps' id='feature-nav' data-feature-nav=''>
      {TURNS.map((turn, i) => (
        <li class='Home_Jump'>
          <a
            class='Home_JumpLink'
            href={`#${SECTIONS[i]}`}
            data-feature-link={i}
          >
            <Icon of={ICONS[turn]} />
            <span {...copy.text(`home.story.turn.${turn}.short`)} />
          </a>
        </li>
      ))}
    </ul>
    <div class='Home_NavControls' data-feature-controls='' hidden>
      <Button
        class='Home_NavButton'
        mod='quiet'
        type='button'
        data-feature-scroll='-1'
        {...copy.attr('aria-label', 'home.story.earlier')}
        aria-controls='feature-nav'
      >
        ‹
      </Button>
      <Button
        class='Home_NavButton'
        mod='quiet'
        type='button'
        data-feature-scroll='1'
        {...copy.attr('aria-label', 'home.story.later')}
        aria-controls='feature-nav'
      >
        ›
      </Button>
    </div>
  </nav>
)

let Features = ({ copy }: { copy: Copy }) => (
  <div class='Home_Features'>
    {FEATURE_TURNS.map((turn, j) => {
      let i = j + 1, key = `home.story.turn.${turn}`
      let scene = SCENES[turn as keyof typeof SCENES]
      let points = POINTS[turn as keyof typeof POINTS]
      return (
        <section
          class='Home_Feature'
          id={SECTIONS[i]}
          aria-labelledby={`title-${turn}`}
          data-story-step={i}
          data-story-pose={POSES[turn]}
        >
          <h2 class='Title Home_FeatureTitle' id={`title-${turn}`}>
            <span class='Home_Icon'>
              <Icon of={ICONS[turn]} />
            </span>
            <span {...copy.text(`${key}.heading`)} />
            <img
              class='Home_SectionYak'
              data-section-yak=''
              src='/mascot/idle-rest-128-1x.webp'
              alt=''
              width='80'
              height='80'
              loading='lazy'
            />
          </h2>
          <div class='Home_FeatureWords'>
            <p class='Note' {...copy.text(`${key}.body`)} />
            {points && (
              <ul class='Home_FeatureList'>
                {points.map((n) => (
                  <li key={n} {...copy.text(`${key}.point${n}`)} />
                ))}
              </ul>
            )}
          </div>
          {turn == 'change' && <Change copy={copy} />}
          {turn == 'team' && <People copy={copy} />}
          {turn == 'connect' && (
            <div class='Home_Connection'>
              <Services />
              <a
                href='/integrations'
                {...copy.text('home.story.connections')}
              />
            </div>
          )}
          {scene && <Scene id={scene} />}
        </section>
      )
    })}
  </div>
)

let Details = ({ copy }: { copy: Copy }) => (
  <div class='Home_Details'>
    <section class='Home_Detail' aria-labelledby='assistant'>
      <h2
        class='Title'
        id='assistant'
        {...copy.text('home.story.assistant.title')}
      />
      <p
        class='Note'
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
    <section class='Home_Detail' aria-labelledby='questions'>
      <h2 class='Title' id='questions' {...copy.text('home.story.faq.title')} />
      {['code', 'access', 'limits', 'leave', 'data'].map((topic) => (
        <Card as='details' class='Home_Question'>
          <summary
            class='Home_Summary'
            {...copy.text(`home.story.faq.${topic}.question`)}
          />
          <p class='Note' {...copy.text(`home.story.faq.${topic}.answer`)} />
        </Card>
      ))}
    </section>
    <section class='Home_Detail' aria-labelledby='made'>
      <h2 class='Title' id='made' {...copy.text('home.story.company')} />
      <p
        class='Note'
        {...copy.text('home.made.us.detail', {
          mail: <a href='mailto:hello@yaks.app'>hello@yaks.app</a>,
        })}
      />
    </section>
  </div>
)

/** The public homepage's conversation and the feature sections it illustrates. */
export let Story = (
  { copy, action, yak, plans }: {
    copy: Copy
    action: string
    yak: ComponentChildren
    plans: ComponentChildren
  },
) => (
  <div class='Home_Story' data-story=''>
    <div class='Home_SkySpace' aria-hidden='true'>
      <span class='Home_SunSlot' data-sun-at='' />
      <span class='Home_MoonSlot' data-moon-at='' />
    </div>
    <div class='Home_Desk' data-story-desk=''>
      <Hero copy={copy} action={action} yak={yak} />
      <aside
        class='Home_Demo'
        id='examples'
        aria-labelledby='example-title'
        data-story-demo=''
      >
        <p
          class='Home_DemoTitle'
          id='example-title'
          {...copy.text('home.story.example')}
        />
        <Phone />
        <Picks />
        <Ask copy={copy} action={action} id='example-say' cta='walk' />
      </aside>
      <FeatureNav copy={copy} />
      <Features copy={copy} />
    </div>
    <div class='Home_After'>
      <div class='Home_Pricing'>
        {plans}
        <Card class='Home_Reward'>
          <Icon of={gift} />
          <div class='Home_RewardWords'>
            <b {...copy.text('home.story.pricing.reward.title')} />
            <p class='Note' {...copy.text('home.story.pricing.reward.body')} />
          </div>
        </Card>
      </div>
      <Details copy={copy} />
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

let PLAN_FEATURES = ['apps', 'visitors', 'data', 'files', 'emails']

/** The same plan card on the home and pricing pages, with room for a page's
 * selection of features. */
export let Plan = (
  { copy, plan, items, slots, cta, illustrated }: {
    copy: Copy
    plan: Tier
    items: readonly string[]
    slots?: Record<string, VNode>
    cta?: string
    illustrated?: boolean
  },
) => {
  let at = `home.cost.${plan}`
  let free = plan == 'free'
  return (
    <Card as='div' class={free ? 'Plan' : `Plan Plan-${plan}`}>
      <h3
        class='Plan_Price'
        {...copy.text(`${at}.price`, {
          per: <span class='Plan_Per' {...copy.text('home.cost.per')} />,
        })}
      />
      <p class='Note Note-small' {...copy.text(`${at}.note`)} />
      <ul class='Plan_List'>
        <li class={illustrated ? 'Home_PlanCredit' : 'Plan_Item'}>
          {illustrated && <Icon of={gift} />}
          <span {...copy.text(`${at}.credit`)} />
        </li>
        {[...PLAN_FEATURES, ...items].map((item) => (
          <li class='Plan_Item' {...copy.text(`${at}.${item}`, slots)} />
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
  { copy, action, yak }: { copy: Copy; action: string; yak: ComponentChildren },
) => (
  <footer class='Foot Home_Foot'>
    <div class='Home_FootLead' id='join'>
      {yak}
      <div class='Home_Join'>
        <h2 class='Title' {...copy.text('home.join.title')} />
        <Ask copy={copy} action={action} id='join-say' cta='join' />
        <p class='Note Note-small' {...copy.text('home.join.note')} />
      </div>
    </div>
    <nav
      class='Home_FootLinks'
      {...copy.attr('aria-label', 'home.story.footer.label')}
    >
      {COLUMNS.map(([column, links]) => (
        <div class='Home_FootColumn'>
          <h2
            class='Home_FootTitle'
            {...copy.text(`home.story.footer.${column}`)}
          />
          <ul class='Home_FootList'>
            {links.map(([name, href]) => (
              <li>
                <a
                  class='Foot_Link'
                  href={href}
                  {...copy.text(`home.story.footer.links.${name}`)}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
    <div class='Home_FootBy'>
      <p {...copy.text('frame.foot.by')} />
      <a class='Foot_Link' href='mailto:hello@yaks.app'>hello@yaks.app</a>
    </div>
  </footer>
)
