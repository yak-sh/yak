/** @jsxImportSource preact */
import { Page } from './frame.tsx'
import { type Slots, text } from './copy.ts'
import { link, mail, Postal, Section, Top } from './prose.tsx'

// An item of what we collect opens on its lead, the snippet at
// `privacy.collect.<item>.lead`, and may link to the cookies page.
let lead = (item: string) => (
  <strong {...text(`privacy.collect.${item}.lead`)} />
)
let cookies = (item: string) =>
  link('/cookies', `privacy.collect.${item}.cookies`)

let strong = (key: string) => <strong {...text(key)} />
let b = (key: string) => <b {...text(key)} />

export let Privacy = () => (
  <Page
    copy='privacy'
    path='/privacy'
  >
    <Top at='privacy.top' updated='2026-11-10T00:00:00Z' />
    <Section at='privacy.about' says={{ questions: { mail } }}>
      <Postal at='privacy.about.address' />
    </Section>
    <Section at='privacy.collect'>
      <ul class='Prose_List'>
        {Object.entries<Slots>({
          email: {},
          called: {},
          session: { cookies: cookies('session') },
          campaign: { cookies: cookies('campaign') },
          variant: { cookies: cookies('variant') },
          codes: {},
          content: {},
          apps: {},
          mail: { address: b('privacy.collect.mail.address') },
          mobile: {},
          errors: {},
          counts: {},
          builder: {},
          feedback: { mail },
        }).map(([item, slots]) => (
          <li
            class='Prose_Item'
            {...text(`privacy.collect.${item}.item`, {
              lead: lead(item),
              ...slots,
            })}
          />
        ))}
      </ul>
    </Section>
    <Section at='privacy.uncollected' says={{ none: {} }} />
    <Section at='privacy.stored' says={{ cloudflare: {} }} />
    <Section
      at='privacy.shared'
      says={{
        companies: {
          stripe: strong('privacy.shared.stripe'),
          telnyx: strong('privacy.shared.telnyx'),
          meta: strong('privacy.shared.meta'),
        },
        texts: {},
        others: {},
      }}
    />
    <Section
      at='privacy.buyers'
      says={{
        card: {
          terms: link('/terms', 'privacy.buyers.terms'),
          stripe: strong('privacy.buyers.card-stripe'),
        },
        order: {
          seller: b('privacy.buyers.seller'),
          stripe: b('privacy.buyers.order-stripe'),
        },
        receipt: {},
      }}
    />
    <Section
      at='privacy.sellers'
      says={{
        connect: {
          stripe: strong('privacy.sellers.stripe'),
          never: b('privacy.sellers.never'),
        },
      }}
    />
    <Section at='privacy.email' says={{ sending: {}, apps: {} }} />
    <Section at='privacy.analytics' says={{ none: {} }} />
    <Section at='privacy.seen' says={{ setting: {}, assistant: {} }} />
    <Section
      at='privacy.retention'
      says={{ account: {}, apps: {}, spaces: {}, closing: {} }}
    />
    <Section at='privacy.rights' says={{ ask: { mail } }} />
    <Section at='privacy.children' says={{ under: {} }} />
    <Section at='privacy.changes' says={{ update: {} }} />
  </Page>
)
