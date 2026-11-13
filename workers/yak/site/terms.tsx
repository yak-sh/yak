/** @jsxImportSource preact */
import { Page } from './frame.tsx'
import { text } from './copy.ts'
import { link, mail, Postal, Section, Top } from './prose.tsx'

export let Terms = () => (
  <Page
    copy='terms'
    path='/terms'
  >
    <Top at='terms.top' updated='2026-11-05T00:00:00Z' />
    <Section at='terms.about' says={{ reach: { mail } }}>
      <p class='Prose_Text' {...text('terms.about.operator')} />
      <Postal at='terms.about.address' />
    </Section>
    <Section at='terms.service' says={{ hosts: {}, new: {} }} />
    <Section at='terms.accounts' says={{ codes: { mail }, age: {} }} />
    <Section at='terms.content' says={{ yours: {}, responsible: {} }} />
    <Section
      at='terms.use'
      says={{
        lists: { policy: link('/acceptable-use', 'terms.use.policy') },
      }}
    />
    <Section at='terms.visibility' says={{ setting: {} }} />
    <Section
      at='terms.fees'
      says={{
        plans: { pricing: link('/pricing', 'terms.fees.pricing') },
        cancel: {},
      }}
    />
    <Section at='terms.invites' says={{ code: {}, others: {} }} />
    <Section
      at='terms.selling'
      says={{
        merchant: {
          merchant: <b {...text('terms.selling.you-are')} />,
          pricing: link('/pricing', 'terms.selling.pricing'),
        },
        stripe: {
          connected: link(
            'https://stripe.com/connect-account/legal/full',
            'terms.selling.connected',
          ),
          ssa: link('https://stripe.com/legal/ssa', 'terms.selling.ssa'),
        },
        duties: {},
        forbidden: {
          lead: <b {...text('terms.selling.may-not')} />,
          policy: link('/acceptable-use', 'terms.selling.policy'),
          restricted: link(
            'https://stripe.com/legal/restricted-businesses',
            'terms.selling.restricted',
          ),
        },
        why: {},
      }}
    />
    <Section at='terms.buying' says={{ seller: { mail } }} />
    <Section
      at='terms.texts'
      says={{
        what: {},
        stop: { mail, privacy: link('/privacy', 'terms.texts.privacy') },
      }}
    />
    <Section
      at='terms.ending'
      says={{
        yours: { mail, privacy: link('/privacy', 'terms.ending.privacy') },
        ours: {},
      }}
    />
    <Section at='terms.liability' says={{ 'as-is': {}, limit: {} }} />
    <Section at='terms.changes' says={{ update: {} }} />
    <Section at='terms.law' says={{ michigan: {} }} />
    <Section at='terms.contact' says={{ reach: { mail } }} />
  </Page>
)
