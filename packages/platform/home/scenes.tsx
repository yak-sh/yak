/** @jsxImportSource preact */
import { Card, Icon } from '@yaks/ui'
import type { ComponentChildren } from 'preact'
import { LOGOS } from '../routes.ts'
import type { Demo, Scene as Pictured } from './demos.ts'
import { BRANDS } from './parts.ts'
import { chat, ICONS, sms } from './icons.ts'
import type { Copy } from './words.ts'

let SERVICES = [
  ['stripe', 'Stripe'],
  ['zoom', 'Zoom'],
  ['google-sheet', 'Google Sheets'],
  ['google-calendar', 'Google Calendar'],
  ['slack', 'Slack'],
  ['quickbooks', 'QuickBooks'],
  ['mailchimp', 'Mailchimp'],
  ['notion', 'Notion'],
  ['google-drive', 'Google Drive'],
  ['airtable', 'Airtable'],
  ['calendly', 'Calendly'],
  ['hubspot', 'HubSpot'],
]

/** A part of a scene that comes in as its section is read, `i` steps after the first. */
let In = (i: number) => ({ style: `--i:${i}` })

export let ServiceLogo = (
  { slug, title }: { slug: string; title?: string },
) => (
  <img
    class='Home_Logo'
    src={BRANDS.some((name) => name == slug)
      ? `/home-brands/${slug}.svg`
      : LOGOS + slug}
    alt={title ?? ''}
    width='23'
    height='23'
    loading='lazy'
  />
)

export let Services = ({ short = false }: { short?: boolean }) => (
  <ul class={short ? 'Home_Services Home_Services-short' : 'Home_Services'}>
    {SERVICES.slice(0, short ? 7 : undefined).map(([slug, name], i) => (
      <li class={short ? 'Home_Service' : 'Home_Service Home_In'} {...In(i)}>
        <button
          type='button'
          class='Home_ServicePick'
          data-service-idea={name}
          aria-label={short ? name : undefined}
        >
          <ServiceLogo slug={slug} />
          {!short && <span>{name}</span>}
        </button>
      </li>
    ))}
  </ul>
)

// The ways to ask for a change: each by its name under
// `home.story.change`, and its icon or, for a chat platform, its logo's
// slug.
let CHANNELS = [
  ['chat', chat],
  ['discord', 'discord'],
  ['mail', ICONS.email],
  ['text', sms],
] as const

export let Change = ({ copy }: { copy: Copy }) => (
  <Card class='Home_Illustration'>
    <ul class='Home_IllustrationRows'>
      {CHANNELS.map(([channel, mark], i) => (
        <li class='Home_IllustrationRow Home_In' {...In(i)}>
          {typeof mark == 'string'
            ? <ServiceLogo slug={mark} />
            : <Icon of={mark} />}
          <div class='Home_IllustrationCopy'>
            <b {...copy.text(`home.story.change.${channel}.name`)} />
            <p
              class='Note Note-small'
              {...copy.text(`home.story.change.${channel}.note`)}
            />
          </div>
        </li>
      ))}
    </ul>
  </Card>
)

export let People = ({ copy }: { copy: Copy }) => (
  <Card class='Home_Illustration'>
    <b {...copy.text('home.story.people.roles')} />
    <ul class='Home_IllustrationRows'>
      {['owner', 'editor', 'viewer'].map((role, i) => (
        <li class='Home_IllustrationRow Home_In' {...In(i)}>
          <Icon of={ICONS.team} />
          <div class='Home_IllustrationCopy'>
            <b {...copy.text(`home.story.people.${role}.name`)} />
            <p
              class='Note Note-small'
              {...copy.text(`home.story.people.${role}.note`)}
            />
          </div>
        </li>
      ))}
    </ul>
  </Card>
)

let Envelope = ({ box, subject, at, children }: {
  box: string
  subject: string
  at: number
  children: ComponentChildren
}) => (
  <figure class='Home_Mail Home_In' {...In(at)}>
    <figcaption class='Home_WindowBar'>{box}</figcaption>
    <div class='Home_MailBody'>
      <b>{subject}</b>
      {children}
    </div>
  </figure>
)

let Scenes = {
  email: ({ letter, mail }: Pictured, slug: string) =>
    letter && mail && (
      <div class='Home_MailPair'>
        <Envelope box='Inbox' subject={letter[0]} at={0}>
          <p class='Home_MailFrom'>
            <b>From</b> yourname.{slug}@yaks.app
          </p>
          <p class='Home_MailFrom'>To me · 7:02 AM</p>
          <p>{letter[1]}</p>
          <span class='Home_MailFrom'>Unsubscribe</span>
        </Envelope>
        <Envelope box='Forward' subject={`Fwd: ${mail[0]}`} at={1}>
          <span class='Home_MailFrom'>To yourname.{slug}@yaks.app</span>
          <span class='Home_Attachment'>{mail[1]}</span>
          <span class='Home_MailSend' aria-hidden='true'>Send</span>
        </Envelope>
      </div>
    ),
  sell: ({ sale }: Pictured) =>
    sale && (
      <div class='Home_Checkout'>
        <figure class='Home_Payment Home_In' {...In(0)}>
          <figcaption class='Home_WindowBar'>
            <ServiceLogo slug='stripe' /> Checkout by Stripe
          </figcaption>
          <div class='Home_MailBody'>
            <p>{sale[0]}</p>
            <b>${sale[1]}.00</b>
            <span class='Home_PaymentAction'>Pay ${sale[1]}.00</span>
          </div>
        </figure>
        <div class='Home_Pipe' aria-hidden='true' />
        <figure class='Home_Payment'>
          <figcaption class='Home_WindowBar'>Orders</figcaption>
          <ul class='Home_MailBody'>
            {['Ana P.', 'Tom R.', 'Mae L.'].map((name, i) => (
              <li class='Home_Order Home_In' {...In(i + 3)}>
                <span>{name}</span> <b>${sale[1]}.00</b> <span>Paid</span>
              </li>
            ))}
          </ul>
        </figure>
      </div>
    ),
  helper: ({ ask }: Pictured) =>
    ask && (
      <Card class='Home_Helper'>
        <p class='Chat_Bubble Chat_Bubble-you Home_In' {...In(0)}>{ask[0]}</p>
        <p class='Chat_Bubble Chat_Bubble-them Home_In' {...In(1.5)}>
          {ask[1]}
        </p>
      </Card>
    ),
  domain: ({ domain }: Pictured, slug: string) =>
    domain && (
      <Card class='Home_Address'>
        <span>yourname.yaks.app/{slug}</span> <span aria-hidden='true'>→</span>
        {' '}
        <b>{domain}</b>
      </Card>
    ),
}

/** The features with a picture of each demo's. */
export type Pictures = keyof typeof Scenes

/** A feature's picture of each demo, the first shown. */
export let Scene = (
  { id, demos, scenes }: {
    id: Pictures
    demos: readonly Demo[]
    scenes: Record<string, Pictured>
  },
) => (
  <div class={`Home_Scene Home_Scene-${id}`}>
    {demos.map(({ slug }, i) => (
      <div data-demo-scene={slug} hidden={i != 0}>
        {Scenes[id](scenes[slug] ?? {}, slug)}
      </div>
    ))}
  </div>
)
