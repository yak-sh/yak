import { Time } from '@yaks/ui/parts'
/** @jsxImportSource preact */
import { Page } from './frame.tsx'
import { type Slots, text } from './copy.ts'

export let AcceptableUse = () => (
  <Page
    copy='acceptable-use'
    path='/acceptable-use'
  >
    <div class='Prose_Head'>
      <h1 class='Title Title-page' {...text('acceptable-use.head.title')} />
      <p
        class='Prose_When Prose_Text'
        {...text('acceptable-use.head.updated', {
          date: <Time written timeZone='UTC' at='2026-11-01T00:00:00Z' />,
        })}
      />
      <p class='Prose_Text' {...text('acceptable-use.head.lead')} />
    </div>
    <section class='Prose_Section'>
      <h2
        class='Prose_Heading'
        {...text('acceptable-use.prohibited.title')}
      />
      <p class='Prose_Text' {...text('acceptable-use.prohibited.lead')} />
      <ul class='Prose_List'>
        {[
          'law',
          'children',
          'harassment',
          'work',
          'malware',
          'bulk',
          'probing',
          'abuse',
          'traffic',
        ].map((use) => (
          <li
            class='Prose_Item'
            {...text(`acceptable-use.prohibited.${use}`)}
          />
        ))}
      </ul>
    </section>
    {Object.entries<Slots>({
      enforcement: {},
      reporting: {
        email: (
          <a class='Prose_Link' href='mailto:hello@yaks.app'>hello@yaks.app</a>
        ),
      },
      terms: {
        terms: (
          <a
            class='Prose_Link'
            href='/terms'
            {...text('acceptable-use.terms.link')}
          />
        ),
      },
    }).map(([section, slots]) => (
      <section class='Prose_Section'>
        <h2
          class='Prose_Heading'
          {...text(`acceptable-use.${section}.title`)}
        />
        <p
          class='Prose_Text'
          {...text(`acceptable-use.${section}.text`, slots)}
        />
      </section>
    ))}
  </Page>
)
