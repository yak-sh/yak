/** @jsxImportSource react */
import { Page } from './frame.tsx'
import { list, text } from './copy.ts'
import { link, mail, Section, Top } from './prose.tsx'

export let AcceptableUse = () => (
  <Page copy='acceptable-use' path='/acceptable-use'>
    <Top at='acceptable-use.head' updated='2026-11-01T00:00:00Z' />
    <Section at='acceptable-use.prohibited'>
      <p className='Prose_Text' {...text('acceptable-use.prohibited.lead')} />
      <ul
        className='Prose_List'
        {...list(
          'acceptable-use.prohibited.items',
          (says) => <li className='Prose_Item'>{says}</li>,
        )}
      />
    </Section>
    <Section at='acceptable-use.enforcement' says={{ text: {} }} />
    <Section at='acceptable-use.reporting' says={{ text: { email: mail } }} />
    <Section
      at='acceptable-use.terms'
      says={{ text: { terms: link('/terms', 'acceptable-use.terms.link') } }}
    />
  </Page>
)
