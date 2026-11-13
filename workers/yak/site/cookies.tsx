import { Time } from '@yaks/ui/parts'
/** @jsxImportSource preact */
import { Page } from './frame.tsx'
import { type Slots, text } from './copy.ts'

// A cookie's name, as the browser keeps it.
let cookie = (name: string) => <code class='Prose_Code'>{name}</code>

let privacy = (
  <a class='Prose_Link' href='/privacy' {...text('cookies.privacy')} />
)

export let Cookies = () => (
  <Page
    copy='cookies'
    path='/cookies'
  >
    <div class='Prose_Head'>
      <h1 class='Title Title-page' {...text('cookies.head.title')} />
      <p
        class='Prose_When Prose_Text'
        {...text('cookies.head.updated', {
          date: <Time written timeZone='UTC' at='2026-11-10T00:00:00Z' />,
        })}
      />
      <p class='Prose_Text' {...text('cookies.head.lead')} />
    </div>
    {Object.entries<Record<string, Slots>>({
      session: {
        use: { cookie: cookie('yak_session') },
        clear: {},
      },
      campaign: {
        text: {
          cookie: cookie('yak_came'),
          tags: cookie('utm_source'),
          click: cookie('fbclid'),
          privacy,
        },
      },
      home: { text: { cookie: cookie('yak_home') } },
      other: { text: { privacy } },
      apps: { text: {} },
      contact: {
        text: {
          email: (
            <a class='Prose_Link' href='mailto:hello@yaks.app'>
              hello@yaks.app
            </a>
          ),
        },
      },
    }).map(([section, paragraphs]) => (
      <section class='Prose_Section'>
        <h2 class='Prose_Heading' {...text(`cookies.${section}.title`)} />
        {Object.entries(paragraphs).map(([paragraph, slots]) => (
          <p
            class='Prose_Text'
            {...text(`cookies.${section}.${paragraph}`, slots)}
          />
        ))}
      </section>
    ))}
  </Page>
)
