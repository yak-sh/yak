/** @jsxImportSource react */
import { Page } from './frame.tsx'
import { text } from './copy.ts'
import { mail, Section, Top } from './prose.tsx'

// A cookie's name, as the browser keeps it.
let cookie = (name: string) => <code className='Prose_Code'>{name}</code>

let privacy = (
  <a className='Prose_Link' href='/privacy' {...text('cookies.privacy')} />
)

export let Cookies = () => (
  <Page copy='cookies' path='/cookies'>
    <Top at='cookies.head' updated='2026-11-15T00:00:00Z' />
    <Section
      at='cookies.session'
      says={{ use: { cookie: cookie('yak_session') }, clear: {} }}
    />
    <Section
      at='cookies.campaign'
      says={{
        text: {
          cookie: cookie('yak_came'),
          tags: cookie('utm_source'),
          click: cookie('fbclid'),
          privacy,
        },
      }}
    />
    <Section at='cookies.other' says={{ text: { privacy } }} />
    <Section at='cookies.apps' says={{ text: {} }} />
    <Section at='cookies.contact' says={{ text: { email: mail } }} />
  </Page>
)
