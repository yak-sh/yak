/** @jsxImportSource preact */
import type { ComponentChildren } from 'preact'
import { Button, Card, Copy as Copyable, Field, Icon } from '@yaks/ui'
import { TURNS } from './demos.ts'
import { ICONS } from './icons.ts'
import { Phone, Picks } from './phone.tsx'
import { Scene, Services } from './scenes.tsx'
import type { Copy } from './words.ts'

let IDS = [
  'hello',
  'how',
  'integrations',
  'work',
  'email-in',
  'payments',
  'helpers',
  'people',
  'domains',
]
let LISTS = new Set(['change', 'connect', 'send', 'sell', 'helper', 'team'])
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
    <ul class='Home_Jumps' data-feature-nav=''>
      {TURNS.map((turn, i) => (
        <li class='Home_Jump'>
          <a class='Home_JumpLink' href={`#${IDS[i]}`} data-feature-link={i}>
            <Icon of={ICONS[turn]} />
            <span {...copy.text(`home.story.turn.${turn}.short`)} />
          </a>
        </li>
      ))}
    </ul>
  </nav>
)

let Features = ({ copy, plans }: { copy: Copy; plans: ComponentChildren }) => (
  <div class='Home_Features'>
    {TURNS.slice(1).map((turn, j) => {
      let i = j + 1, key = `home.story.turn.${turn}`
      let scene = SCENES[turn as keyof typeof SCENES]
      return (
        <section
          class='Home_Feature'
          id={IDS[i]}
          aria-labelledby={`title-${turn}`}
          data-story-step={i}
        >
          <div class='Home_FeatureWords'>
            <h2 class='Title Home_FeatureTitle' id={`title-${turn}`}>
              <span class='Home_Icon'>
                <Icon of={ICONS[turn]} />
              </span>
              <span {...copy.text(`${key}.heading`)} />
            </h2>
            <p class='Note' {...copy.text(`${key}.body`)} />
            {LISTS.has(turn) && (
              <ul class='Home_FeatureList'>
                {[1, 2, 3].map((n) => (
                  <li {...copy.text(`${key}.point${n}`)} />
                ))}
              </ul>
            )}
          </div>
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
          {turn == 'domain' && plans}
        </section>
      )
    })}
  </div>
)

let Details = ({ copy, action }: { copy: Copy; action: string }) => (
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
      <h2 class='Title' id='made' {...copy.text('home.made.title')} />
      <p
        class='Note'
        {...copy.text('home.made.us.detail', {
          mail: <a href='mailto:hello@yaks.app'>hello@yaks.app</a>,
        })}
      />
    </section>
    <Card class='Join Home_Join' aria-labelledby='join'>
      <h2 class='Title' id='join' {...copy.text('home.join.title')} />
      <Ask copy={copy} action={action} id='join-say' cta='join' />
      <p class='Note Note-small' {...copy.text('home.join.note')} />
    </Card>
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
    <div class='Home_MoonSpace' data-moon-at='' aria-hidden='true' />
    <div class='Home_Desk' data-story-desk=''>
      <div class='Home_Reading'>
        <Hero copy={copy} action={action} yak={yak} />
        <FeatureNav copy={copy} />
        <Features copy={copy} plans={plans} />
        <Details copy={copy} action={action} />
      </div>
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

export let StoryFooter = (
  { copy, yak }: { copy: Copy; yak: ComponentChildren },
) => (
  <footer class='Foot Home_Foot'>
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
      {yak}
      <p {...copy.text('frame.foot.by')} />
      <a class='Foot_Link' href='mailto:hello@yaks.app'>hello@yaks.app</a>
    </div>
  </footer>
)
