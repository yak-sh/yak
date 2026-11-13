/** @jsxImportSource preact */
// The help page: a section for each question a person asks, its heading the
// question and its first paragraph, its lead, the answer an engine reads of
// it (`data`), each snippet a key under `help` in the home app's copy.
import type { ComponentChildren } from 'preact'
import { Chip, Chips } from '@yaks/ui'
import { Data, Page, Yours } from './frame.tsx'
import { said, type Slots, text } from './copy.ts'

// Where support mail goes: an address, not words.
let MAIL = 'hello@yaks.app'
let mail = <a class='Prose_Link' href={`mailto:${MAIL}`}>{MAIL}</a>

let link = (href: string, key: string) => (
  <a class='Prose_Link' href={href} {...text(key)} />
)

// What a person might say to their assistant, quoted.
let says = (key: string) => <q class='Said' {...text(key)} />

// A space's address, written as code.
let at = (path?: string) => (
  <code class='Prose_Code'>
    <Yours path={path} />
  </code>
)

let para = (key: string, slots?: Slots) => (
  <p class='Prose_Text' {...text(`help.${key}`, slots)} />
)

let Section = (
  { id, children }: { id: string; children: ComponentChildren },
) => (
  <section class='Prose_Section' id={id}>
    <h2 class='Prose_Heading' {...text(`help.${id}.title`)} />
    {children}
  </section>
)

// Who can see an app: the access it can have.
let OPTIONS = ['read', 'write', 'invited']

let option = (name: string) => (
  <li
    class='Prose_Item'
    {...text(`help.who.${name}.detail`, {
      option: <b {...text(`help.who.${name}.option`)} />,
    })}
  />
)

// The answer to each section's question, as a browser reads the page: its
// lead, each slot the words shown in it, a quote in its marks, and the
// options the lead of `who` opens.
let lead = (id: string, slots: Record<string, string> = {}) =>
  said(`help.${id}.lead`, slots)
let quoted = (key: string) => `“${said(key)}”`

let ANSWERS: Record<string, string[]> = {
  make: [lead('make')],
  start: [lead('start', { 'sign-in': said('help.start.sign-in') })],
  ask: [lead('ask', { said: quoted('help.ask.says.app') })],
  where: [
    lead('where', {
      recipes: 'yourname.yaks.app/recipes',
      yours: 'yourname.yaks.app',
    }),
  ],
  who: [
    lead('who'),
    ...OPTIONS.map((name) =>
      said(`help.who.${name}.detail`, {
        option: said(`help.who.${name}.option`),
      })
    ),
  ],
  invite: [lead('invite', { said: quoted('help.invite.says.invite') })],
  broken: [lead('broken', { said: quoted('help.broken.says.photo') })],
  out: [lead('out', { said: quoted('help.out.says.export') })],
  people: [lead('people', { email: MAIL })],
  under: [
    lead('under', {
      docs: said('help.under.docs'),
      technical: said('help.under.technical'),
    }),
  ],
}

// What an engine reads of the page.
let data = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  'url': 'https://yaks.app/help',
  'mainEntity': Object.entries(ANSWERS).map(([id, answer]) => ({
    '@type': 'Question',
    'name': said(`help.${id}.title`),
    'acceptedAnswer': { '@type': 'Answer', 'text': answer.join(' ') },
  })),
}

// The sections the head jumps to.
let JUMPS = [
  'make',
  'start',
  'ask',
  'where',
  'who',
  'invite',
  'broken',
  'out',
  'people',
]

export let Help = () => (
  <Page
    copy='help'
    path='/help'
    head={<Data of={data} />}
  >
    <div class='Prose_Head'>
      <h1 class='Title Title-page' {...text('help.head.title')} />
      <p class='Prose_Text' {...text('help.head.intro', { email: mail })} />
      <Chips as='ul'>
        {JUMPS.map((id) => (
          <li class='Prose_Item'>
            <Chip
              class='Prose_Link'
              href={`#${id}`}
              {...text(`help.jump.${id}`)}
            />
          </li>
        ))}
      </Chips>
    </div>
    <Section id='make'>
      {para('make.lead')}
      {para('make.basic')}
      {para('make.installed', { said: says('help.make.says.made') })}
    </Section>
    <Section id='start'>
      {para('start.lead', {
        'sign-in': link('/login', 'help.start.sign-in'),
      })}
    </Section>
    <Section id='ask'>
      {para('ask.lead', { said: says('help.ask.says.app') })}
      {para('ask.changes', {
        newest: says('help.ask.says.newest'),
        note: says('help.ask.says.note'),
        photos: says('help.ask.says.photos'),
      })}
      {para('ask.undo')}
    </Section>
    <Section id='where'>
      {para('where.lead', { recipes: at('/recipes'), yours: at() })}
      {para('where.name')}
      {para('where.data', { said: says('help.where.says.apps') })}
    </Section>
    <Section id='who'>
      {para('who.lead')}
      <ul class='Prose_List'>{OPTIONS.map(option)}</ul>
      {para('who.tell', {
        signup: says('help.who.says.signup'),
        private: says('help.who.says.private'),
      })}
    </Section>
    <Section id='invite'>
      {para('invite.lead', { said: says('help.invite.says.invite') })}
      {para('invite.roles', { yours: at() })}
      {para('invite.remove', { said: says('help.invite.says.remove') })}
    </Section>
    <Section id='broken'>
      {para('broken.lead', { said: says('help.broken.says.photo') })}
      {para('broken.errors', { said: says('help.broken.says.errors') })}
      {para('broken.restore')}
    </Section>
    <Section id='out'>
      {para('out.lead', { said: says('help.out.says.export') })}
      {para('out.delete', { said: says('help.out.says.delete') })}
      {para('out.account', {
        email: mail,
        privacy: link('/privacy', 'help.out.privacy'),
      })}
    </Section>
    <Section id='people'>
      {para('people.lead', { email: mail })}
      {para('people.report')}
      {para('people.security', { email: mail })}
    </Section>
    <Section id='under'>
      {para('under.lead', {
        docs: link('/docs', 'help.under.docs'),
        technical: link('/docs/technical', 'help.under.technical'),
      })}
    </Section>
  </Page>
)
