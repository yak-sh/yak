/** @jsxImportSource react */
import { Card, Icon } from '@yaks/ui'
import type { ReactNode } from 'react'
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
let In = (i: number) => ({ style: { '--i': i } })

export let ServiceLogo = (
  { slug, title }: { slug: string; title?: string },
) => (
  <img
    className='Home_Logo'
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
  <ul className={short ? 'Home_Services Home_Services-short' : 'Home_Services'}>
    {SERVICES.slice(0, short ? 7 : undefined).map(([slug, name], i) => (
      <li
        className={short ? 'Home_Service' : 'Home_Service Home_In'}
        {...In(i)}
      >
        <button
          type='button'
          className='Home_ServicePick'
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
  ['slack', 'slack'],
  ['mail', ICONS.email],
  ['text', sms],
] as const

export let Change = ({ copy }: { copy: Copy }) => (
  <Card className='Home_Illustration'>
    <ul className='Home_IllustrationRows'>
      {CHANNELS.map(([channel, mark], i) => (
        <li className='Home_IllustrationRow Home_In' {...In(i)}>
          {typeof mark == 'string'
            ? <ServiceLogo slug={mark} />
            : <Icon of={mark} />}
          <div className='Home_IllustrationCopy'>
            <b {...copy.text(`home.story.change.${channel}.name`)} />
            <p
              className='Note Note-small'
              {...copy.text(`home.story.change.${channel}.note`)}
            />
          </div>
        </li>
      ))}
    </ul>
  </Card>
)

export let People = ({ copy }: { copy: Copy }) => (
  <Card className='Home_Illustration'>
    <b {...copy.text('home.story.people.roles')} />
    <ul className='Home_IllustrationRows'>
      {['owner', 'editor', 'viewer'].map((role, i) => (
        <li className='Home_IllustrationRow Home_In' {...In(i)}>
          <Icon of={ICONS.team} />
          <div className='Home_IllustrationCopy'>
            <b {...copy.text(`home.story.people.${role}.name`)} />
            <p
              className='Note Note-small'
              {...copy.text(`home.story.people.${role}.note`)}
            />
          </div>
        </li>
      ))}
    </ul>
  </Card>
)

/** One message of a thread: who it is to or from, on one line, then the rest. */
let Message = ({ head, address, at, children }: {
  head: 'From' | 'To'
  address: string
  at: number
  children: ReactNode
}) => (
  <div className='Home_MailBody Home_In' {...In(at)}>
    <p className='Home_MailFrom'>
      <b>{head}</b> <span className='Home_MailAddress'>{address}</span>
    </p>
    {children}
  </div>
)

let Scenes = {
  email: ({ letter, mail }: Pictured, slug: string) =>
    letter && mail && (
      <figure className='Home_Mail'>
        <figcaption className='Home_WindowBar'>Mail</figcaption>
        <Message head='To' address={`yourname.${slug}@yaks.app`} at={0}>
          <b>Fwd: {mail[0]}</b>
          <span className='Home_Attachment'>{mail[1]}</span>
        </Message>
        <Message head='From' address={`yourname.${slug}@yaks.app`} at={1}>
          <b>{letter[0]}</b>
          <p>{letter[1]}</p>
          <span className='Home_MailFrom'>Unsubscribe</span>
        </Message>
      </figure>
    ),
  sell: ({ sale }: Pictured) =>
    sale && (
      <div className='Home_Checkout'>
        <figure className='Home_Payment Home_In' {...In(0)}>
          <figcaption className='Home_WindowBar'>
            <ServiceLogo slug='stripe' /> Checkout by Stripe
          </figcaption>
          <div className='Home_MailBody'>
            <p>{sale[0]}</p>
            <b>${sale[1]}.00</b>
            <span className='Home_PaymentAction'>Pay ${sale[1]}.00</span>
          </div>
        </figure>
        <div className='Home_Pipe' aria-hidden='true' />
        <figure className='Home_Payment'>
          <figcaption className='Home_WindowBar'>Orders</figcaption>
          <ul className='Home_MailBody'>
            {['Ana P.', 'Tom R.', 'Mae L.'].map((name, i) => (
              <li className='Home_Order Home_In' {...In(i + 3)}>
                <span>{name}</span> <b>${sale[1]}.00</b> <span>Paid</span>
              </li>
            ))}
          </ul>
        </figure>
      </div>
    ),
  helper: ({ ask }: Pictured) =>
    ask && (
      <Card className='Home_Helper'>
        <p className='Chat_Bubble Chat_Bubble-you Home_In' {...In(0)}>
          {ask[0]}
        </p>
        <p className='Chat_Bubble Chat_Bubble-them Home_In' {...In(1.5)}>
          {ask[1]}
        </p>
      </Card>
    ),
  domain: ({ domain }: Pictured, slug: string) =>
    domain && (
      <Card className='Home_Address'>
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
  <div className={`Home_Scene Home_Scene-${id}`}>
    {demos.map(({ slug }, i) => (
      <div data-demo-scene={slug} hidden={i != 0}>
        {Scenes[id](scenes[slug] ?? {}, slug)}
      </div>
    ))}
  </div>
)
