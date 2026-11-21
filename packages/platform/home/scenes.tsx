/** @jsxImportSource preact */
import { Card } from '@yaks/ui'
import type { ComponentChildren } from 'preact'
import { LOGOS } from '../routes.ts'
import { DEMOS, SCENES } from './demos.ts'

let SERVICES = [
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

export let Services = ({ short = false }: { short?: boolean }) => (
  <ul class={short ? 'Home_Services Home_Services-short' : 'Home_Services'}>
    {SERVICES.slice(0, short ? 7 : undefined).map(([slug, name]) => (
      <li class='Home_Service'>
        <img
          class='Home_Logo'
          src={LOGOS + slug}
          alt={short ? name : ''}
          width='23'
          height='23'
          loading='lazy'
        />
        {!short && <span>{name}</span>}
      </li>
    ))}
  </ul>
)

let Envelope = ({ box, subject, children }: {
  box: string
  subject: string
  children: ComponentChildren
}) => (
  <figure class='Home_Mail'>
    <figcaption class='Home_WindowBar'>{box}</figcaption>
    <div class='Home_MailBody'>
      <b>{subject}</b>
      {children}
    </div>
  </figure>
)

let Scenes = {
  send: ({ letter }: typeof SCENES[string]) => (
    <Envelope box='Inbox' subject={letter[0]}>
      <span class='Home_MailFrom'>From the app</span>
      <p>{letter[1]}</p>
      <span class='Home_MailFrom'>Unsubscribe</span>
    </Envelope>
  ),
  receive: ({ mail }: typeof SCENES[string], slug: string) => (
    <Envelope box='Forward' subject={`Fwd: ${mail[0]}`}>
      <span class='Home_MailFrom'>To yourname.{slug}@yaks.app</span>
      <span class='Home_Attachment'>{mail[1]}</span>
    </Envelope>
  ),
  sell: ({ sale }: typeof SCENES[string]) => (
    <div class='Home_Checkout'>
      <figure class='Home_Payment'>
        <figcaption class='Home_WindowBar'>Checkout by Stripe</figcaption>
        <div class='Home_MailBody'>
          <p>{sale[0]}</p>
          <b>${sale[1]}.00</b>
          <span class='Home_PaymentAction'>Pay ${sale[1]}.00</span>
        </div>
      </figure>
      <figure class='Home_Payment'>
        <figcaption class='Home_WindowBar'>Orders</figcaption>
        <ul class='Home_MailBody'>
          {['Ana P.', 'Tom R.', 'Mae L.'].map((name) => (
            <li class='Home_Order'>
              <span>{name}</span> <b>${sale[1]}.00</b> <span>Paid</span>
            </li>
          ))}
        </ul>
      </figure>
    </div>
  ),
  helper: ({ ask }: typeof SCENES[string]) => (
    <Card class='Home_Helper'>
      <p class='Chat_Bubble Chat_Bubble-you'>{ask[0]}</p>
      <p class='Chat_Bubble Chat_Bubble-them'>{ask[1]}</p>
    </Card>
  ),
  domain: ({ domain }: typeof SCENES[string], slug: string) => (
    <Card class='Home_Address'>
      <s>yourname.yaks.app/{slug}</s> <span aria-hidden='true'>→</span>{' '}
      <b>{domain}</b>
    </Card>
  ),
}

export let Scene = ({ id }: { id: keyof typeof Scenes }) => (
  <div class='Home_Scene'>
    {DEMOS.map(({ slug }, i) => (
      <div data-demo-scene={slug} hidden={i != 0}>
        {Scenes[id](SCENES[slug], slug)}
      </div>
    ))}
  </div>
)
