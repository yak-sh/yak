/** @jsxImportSource preact */
import { Page } from './frame.tsx'
import { text } from './copy.ts'
import { link, mail, Section, Top } from './prose.tsx'

let PROHIBITED = [
  'law',
  'children',
  'harassment',
  'work',
  'malware',
  'bulk',
  'probing',
  'abuse',
  'traffic',
]

export let AcceptableUse = () => (
  <Page copy='acceptable-use' path='/acceptable-use'>
    <Top at='acceptable-use.head' updated='2026-11-01T00:00:00Z' />
    <Section at='acceptable-use.prohibited'>
      <p class='Prose_Text' {...text('acceptable-use.prohibited.lead')} />
      <ul class='Prose_List'>
        {PROHIBITED.map((use) => (
          <li
            class='Prose_Item'
            {...text(`acceptable-use.prohibited.${use}`)}
          />
        ))}
      </ul>
    </Section>
    <Section at='acceptable-use.enforcement' says={{ text: {} }} />
    <Section at='acceptable-use.reporting' says={{ text: { email: mail } }} />
    <Section
      at='acceptable-use.terms'
      says={{ text: { terms: link('/terms', 'acceptable-use.terms.link') } }}
    />
  </Page>
)
