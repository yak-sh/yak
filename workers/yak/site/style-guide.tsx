/** @jsxImportSource react */
import {
  Button,
  Card,
  Chip,
  Chips,
  type Composition,
  Field,
  kits,
  linen,
  pencil,
  Worn,
} from '@yaks/ui'
import type { ReactNode } from 'react'
import { WORN } from '../sheet-assets.ts'
import { UI_GUIDE } from '../kept-page.ts'
import { attr, said, type Slots, text } from './copy.ts'
import { Page, Yours } from './frame.tsx'

// What a person copies or types, in the line.
let Code = (
  { children, ...rest }: { children: ReactNode; [x: string]: unknown },
) => <Chip as='code' mod='code' {...rest}>{children}</Chip>

// The kit as these pages wear it, and its parts but the document's defaults,
// which are this page's own type.
let drawn: Composition = { kits, theme: linen, skin: pencil }
let PARTS = WORN.filter((part) => part != 'base')

// The props of an element showing this page's snippet at `key`.
let say = (key: string, slots?: Slots) => text(`style-guide.${key}`, slots)

// What an app's preview shows, inside its window.
let PREVIEW =
  `<!doctype html><html lang='en'><meta name='color-scheme' content='dark'><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#33493c;color:#f1e6d8;font:600 1rem/1.5 system-ui,sans-serif}p{padding:2rem;text-align:center}</style><body><p>${
    said('style-guide.components.window.preview')
  }</p></body></html>`

// The theme picker, and each token's value as the page is painted.
let PICK = `
    let root = document.documentElement
    let theme = document.querySelector('#theme')
    let system = matchMedia('(prefers-color-scheme: dark)')

    for (let button of document.querySelectorAll('.Guide button[aria-pressed]')) {
      button.addEventListener('click', () => {
        button.setAttribute(
          'aria-pressed',
          String(button.getAttribute('aria-pressed') != 'true'),
        )
      })
    }

    let values = () => {
      for (let el of document.querySelectorAll('[data-token]')) {
        let slot = el.querySelector('.Guide_Value')
        let bar = el.querySelector('.Guide_Bar')
        let chip = el.querySelector('.Guide_Chip:not([style*="border"])')
        if (!slot) continue
        // A role is a light and a dark paint; the chip shows the one the
        // page is in.
        slot.textContent = bar
          ? Math.round(bar.getBoundingClientRect().width) + 'px'
          : chip
          ? getComputedStyle(chip).backgroundColor
          : getComputedStyle(el).getPropertyValue(el.dataset.token).trim()
      }
    }

    let choose = () => {
      root.style.colorScheme = theme.value == 'system' ? '' : theme.value
      values()
    }

    theme.addEventListener('change', choose)
    system.addEventListener('change', () => {
      if (theme.value == 'system') values()
    })
    choose()
    `

// The page's parts, by the id each one's heading has; its snippets are under
// that id, and the chip linking to it under `nav`.
let SECTIONS = [
  'how-to',
  'voice',
  'language',
  'theme-roles',
  'page-paints',
  'type',
  'space',
  'components',
  'kit',
  'sections',
]

// The theme's colour roles, and what only these pages paint.
let ROLES = [
  '--bg',
  '--surface',
  '--card',
  '--border',
  '--border2',
  '--text',
  '--muted',
  '--dim',
  '--accent',
  '--link',
  '--heading',
  '--info',
  '--active',
  '--positive',
  '--negative',
  '--caution',
  '--special',
]
let PAINTS = ['--mine', '--theirs', '--preview', '--well']
let GAPS = ['--quarter-gap', '--half-gap', '--gap', '--wide-gap']

// One part of the page under its heading, the snippet at `<id>.title`.
let Part = ({ id, children }: { id: string; children: ReactNode }) => (
  <section className='Guide_Part' aria-labelledby={id}>
    <h2 className='Title' id={id} {...say(`${id}.title`)} />
    {children}
  </section>
)

// Rules, each the snippet at `<at>.<rule>.rule` led by its name in bold, at
// `<at>.<rule>.name`, with the slots it has besides.
let Rules = ({ at, rules }: { at: string; rules: Record<string, Slots> }) => (
  <ul className='Guide_Rules'>
    {Object.entries(rules).map(([rule, slots]) => (
      <li
        key={rule}
        {...say(`${at}.${rule}.rule`, {
          name: <b {...say(`${at}.${rule}.name`)} />,
          ...slots,
        })}
      />
    ))}
  </ul>
)

// A colour token: its paint, its name and its value as painted.
let Swatch = ({ token }: { token: string }) => (
  <li className='Guide_Swatch' data-token={token}>
    <span className='Guide_Chip' style={`--swatch: var(${token})`} />{' '}
    <code className='Guide_Name'>{token}</code> <span className='Guide_Value' />
  </li>
)

// A spacing token: its name, its value and a bar as long.
let Size = ({ token }: { token: string }) => (
  <li className='Guide_Size' data-token={token}>
    <span>
      <code className='Guide_Name'>{token}</code>{' '}
      <span className='Guide_Value' />
    </span>{' '}
    <span className='Guide_Bar' style={`--bar: var(${token})`} />
  </li>
)

// A token's name and its value, as slots of the sentence about it.
let token = (name: string, Name: 'span' | 'code' = 'span') => ({
  name: <Name className='Guide_Name'>{name}</Name>,
  value: <span className='Guide_Value' />,
})

// What a person copies or types, each its own slot.
let code = (words: Record<string, string>): Slots =>
  Object.fromEntries(
    Object.entries(words).map((
      [slot, typed],
    ) => [slot, <Code key={slot}>{typed}</Code>]),
  )

// Class names in bold, each the slot of its own name.
let classes = (...names: string[]): Slots =>
  Object.fromEntries(names.map((name) => [name, <b key={name}>.{name}</b>]))

export let StyleGuide = () => (
  <Page
    copy='style-guide'
    path='/style-guide'
    kind='Guide'
    robots='noindex, follow'
    after={
      <>
        <script dangerouslySetInnerHTML={{ __html: PICK }} />
        <script type='module' src='chart.js' />
        <script src='drop.js' defer />
      </>
    }
  >
    <div className='Prose_Head'>
      <h1 className='Title Title-page' {...say('head.title')} />
      <p className='Note Note-lead' {...say('head.lead')} />
      <p>
        <label className='Note Note-small' for='theme' {...say('head.theme')} />
        {' '}
        <Field choose id='theme' name='theme'>
          {['system', 'light', 'dark'].map((theme) => (
            <option
              key={theme}
              value={theme}
              {...say(`head.themes.${theme}`)}
            />
          ))}
        </Field>
      </p>
      <nav {...attr('aria-label', 'style-guide.head.nav')}>
        <Chips as='ul'>
          {SECTIONS.map((id) => (
            <li key={id}>
              <Chip href={`#${id}`} {...say(`nav.${id}`)} />
            </li>
          ))}
        </Chips>
      </nav>
    </div>
    <Part id='how-to'>
      <p
        className='Note'
        {...say(
          'how-to.note',
          code({
            linen: 'linen',
            pencil: 'pencil',
            ui: '_ui.css',
            site: 'site.css',
            pages: 'pages.css',
            style: 'style.css',
          }),
        )}
      />
      <Rules
        at='how-to'
        rules={{
          existing: {},
          roles: code({ role: 'var(--text)', colour: '#523828' }),
          variants: code({ variant: '.Chip-quiet', fill: '--chip-fill' }),
          layers: {},
        }}
      />
      <p className='Note Note-small' {...say('how-to.complete')} />
    </Part>
    <Part id='voice'>
      <Rules
        at='voice'
        rules={{
          pencil: {},
          selection: {},
          narrow: code({ measure: '--measure', wide: '--wide-measure' }),
          subject: {},
          nouns: {},
          filler: {},
          actions: {},
          claims: {},
        }}
      />
    </Part>
    <Part id='language'>
      <p className='Note' {...say('language.note')} />
      <Rules
        at='language'
        rules={{
          card: code({ card: '.Card', group: '.Group' }),
          head: {},
          hierarchy: code({
            small: '--small',
            fine: '--fine',
            muted: '--muted',
          }),
          rows: code({ rows: '.Rows' }),
          field: {
            ...code({
              field: '.Form_Field',
              line: '.Form_Line',
              more: '.More',
            }),
            advanced: <b {...say('language.field.advanced')} />,
          },
          space: {},
          overlap: {},
        }}
      />
    </Part>
    <Part id='theme-roles'>
      <p
        className='Note'
        {...say('theme-roles.note', code({ linen: 'linen' }))}
      />
      <ul className='Guide_Swatches'>
        {ROLES.map((role) => <Swatch key={role} token={role} />)}
      </ul>
    </Part>
    <Part id='page-paints'>
      <p
        className='Note'
        {...say('page-paints.note', code({ site: 'site.css' }))}
      />
      <ul className='Guide_Swatches'>
        {PAINTS.map((paint) => <Swatch key={paint} token={paint} />)}
      </ul>
    </Part>
    <Part id='type'>
      <Card as='div' className='Guide_Demo'>
        <p data-token='--font'>
          <span className='Guide_Name'>--font</span>{' '}
          <span className='Guide_Value' />
        </p>
        <p data-token='--mono' style='font-family: var(--mono)'>
          <span className='Guide_Name'>--mono</span>{' '}
          <span className='Guide_Value' />
        </p>
        {['size', 'lead', 'small', 'fine'].map((size) => (
          <p
            key={size}
            data-token={`--${size}`}
            style={`font-size: var(--${size})`}
            {...say(`type.${size}`, token(`--${size}`))}
          />
        ))}
      </Card>
    </Part>
    <Part id='space'>
      <p className='Note' {...say('space.note', code({ gap: '--gap' }))} />
      <ul className='Guide_Sizes'>
        {GAPS.map((gap) => <Size key={gap} token={gap} />)}
      </ul>
      {['measure', 'wide-measure'].map((measure) => (
        <p
          key={measure}
          className='Note Note-small'
          data-token={`--${measure}`}
          {...say(`space.${measure}`, token(`--${measure}`, 'code'))}
        />
      ))}
      <p
        className='Note Note-small'
        {...say('space.frame', {
          side: <code className='Guide_Name'>--side</code>,
          aside: <code className='Guide_Name'>--aside</code>,
          rhythm: <code className='Guide_Name'>--rhythm</code>,
          ...code({ body: 'body' }),
        })}
      />
      <p className='Note Note-small' {...say('space.shape')} />
      <ul className='Guide_Swatches'>
        <Swatch token='--graphite' />
        <li className='Guide_Swatch' data-token='--stroke'>
          <span
            className='Guide_Chip'
            style='--swatch: var(--card); border: var(--stroke) solid var(--graphite)'
          />{' '}
          <code className='Guide_Name'>--stroke</code>{' '}
          <span className='Guide_Value' />
        </li>
        <li className='Guide_Swatch' data-token='--radius'>
          <Card
            as='span'
            className='Guide_Chip'
            style='--swatch: var(--card); border-color: transparent'
          />{' '}
          <code className='Guide_Name'>--radius</code>{' '}
          <span className='Guide_Value' />
        </li>
        <li className='Guide_Swatch' data-token='--lift'>
          <Button
            as='span'
            mod='go'
            className='Guide_Chip'
            style='--swatch: var(--accent); border-color: transparent'
          />{' '}
          <code className='Guide_Name'>--lift</code>{' '}
          <span className='Guide_Value' />
        </li>
      </ul>
    </Part>
    <Part id='components'>
      <p className='Note' {...say('components.about')} />
      <Card as='div' className='Guide_Demo'>
        <p className='Guide_Name'>.Title · .Title-hero · .Title-page</p>
        <p className='Title Title-hero' {...say('components.titles.hero')} />
        <p className='Title Title-page' {...say('components.titles.page')} />
        <p className='Title' {...say('components.titles.section')} />
      </Card>
      <Card as='div' className='Guide_Demo'>
        <p className='Guide_Name'>.Note · .Note-lead · .Note-small</p>
        <p className='Note Note-lead' {...say('components.notes.lead')} />
        <p className='Note' {...say('components.notes.body')} />
        <p className='Note Note-small' {...say('components.notes.small')} />
      </Card>
      <Card as='div' className='Guide_Demo'>
        <p className='Guide_Name'>
          .Chat · .Chat_Who · .Chat_Who-you · .Chat_Bubble · .Chat_Bubble-you ·
          .Chat_Bubble-them
        </p>
        <Card as='div' className='Chat'>
          <h3
            className='Chat_Who Chat_Who-you'
            {...say('components.chat.you')}
          />
          <p
            className='Chat_Bubble Chat_Bubble-you'
            {...say('components.chat.ask')}
          />
          <h3 className='Chat_Who' {...say('components.chat.them')} />
          <p
            className='Chat_Bubble Chat_Bubble-them'
            {...say('components.chat.answer')}
          />
          <p className='Note Note-small' {...say('components.chat.caption')} />
        </Card>
      </Card>
      <Card as='div' className='Guide_Demo'>
        <p className='Guide_Name'>.Said</p>
        <p
          className='Note'
          {...say('components.said.long', {
            ...code({ q: '<q>' }),
            said: <q className='Said' {...say('components.said.invite')} />,
          })}
        />
        <p
          className='Note'
          {...say('components.said.short', {
            said: <q className='Said' {...say('components.said.out')} />,
          })}
        />
      </Card>
      <Card as='div' className='Guide_Demo'>
        <p className='Guide_Name'>
          .Window · .Window_Bar · .Window_Body · .Window_Heading · .Window_List
          · .Window_On · .Window_Body-frame · .Window_Frame
        </p>
        <div className='Window'>
          <div className='Window_Bar'>
            <Chip mod='quiet'>
              <Yours path='/recipes' />
            </Chip>
          </div>
          <div className='Window_Body'>
            <p
              className='Window_Heading'
              {...say('components.window.heading')}
            />
            <ul className='Window_List'>
              {['cake', 'soup'].map((recipe) => (
                <li
                  key={recipe}
                  className='Window_Item'
                  {...say(`components.window.${recipe}`)}
                />
              ))}
            </ul>
            <p
              className='Note Note-small'
              {...say('components.window.note', {
                on: (
                  <span
                    className='Window_On'
                    {...say('components.window.soup')}
                  />
                ),
              })}
            />
          </div>
        </div>
        <div className='Window'>
          <div className='Window_Bar'>
            <Chip mod='quiet'>
              <Yours path='/preview' />
            </Chip>
          </div>
          <div className='Window_Body Window_Body-frame'>
            <iframe
              className='Window_Frame'
              {...attr('title', 'style-guide.components.window.title')}
              srcdoc={PREVIEW}
            />
          </div>
        </div>
      </Card>
      <Card as='div' className='Guide_Demo'>
        <p className='Guide_Name'>.Yak · .Yak-small · .Yak-big</p>
        <p>
          <img className='Yak Yak-small' src='yak.webp' alt='' />
        </p>{' '}
        <img
          className='Yak Yak-big'
          src='yak.webp'
          {...attr('alt', 'style-guide.components.yak.alt')}
        />{' '}
        <p
          className='Note Note-small'
          {...say('components.yak.note', code({ file: 'yak.webp' }))}
        />
      </Card>
      <Card as='div' className='Guide_Demo'>
        <p className='Guide_Name'>.Prose · .Prose_Head · .Prose_When</p>
        <div className='Prose'>
          <div className='Prose_Head'>
            <h3
              className='Title Title-page'
              {...say('components.prose.title')}
            />
            <p
              className='Prose_When Prose_Text'
              {...say('components.prose.when')}
            />
          </div>
          <section className='Prose_Section'>
            <h2
              className='Prose_Heading'
              {...say('components.prose.heading')}
            />
            <p
              className='Prose_Text'
              {...say('components.prose.text', {
                code: (
                  <code
                    className='Prose_Code'
                    {...say('components.prose.code')}
                  />
                ),
              })}
            />
            <ul className='Prose_List'>
              <li className='Prose_Item' {...say('components.prose.quiet')} />
              <li
                className='Prose_Item'
                {...say('components.prose.accent', {
                  link: (
                    <a
                      className='Prose_Link'
                      href='#components'
                      {...say('components.prose.link')}
                    />
                  ),
                })}
              />
            </ul>
            <address
              className='Prose_Address'
              {...say('components.prose.address')}
            />
          </section>
        </div>
      </Card>
    </Part>
    <Part id='kit'>
      <p
        className='Note'
        {...say('kit.note', {
          all: <a href={UI_GUIDE} {...say('kit.all')} />,
        })}
      />
      <Worn parts={PARTS} composition={drawn} />
    </Part>
    <Part id='sections'>
      <p className='Note' {...say('sections.note')} />
      <ul className='Guide_Rules'>
        {Object.entries<Slots>({
          top: classes('Top', 'Top_Name', 'Page', 'Foot'),
          page: {
            ...classes('Page'),
            ...code({
              body: 'body',
              measure: '--measure',
              side: '--side',
              aside: '--aside',
              rhythm: '--rhythm',
              wide: '--wide-measure',
            }),
          },
          home: { ...classes('Home'), ...code({ body: 'body' }) },
          hello: {
            ...classes(
              'Hello',
              'Hello_Copy',
              'Hello_Yak',
              'Hello_Ask',
              'Demo',
              'Demo_Title',
              'Demo_Slides',
              'Demo_Controls',
              'Demo_Dots',
              'Demo_Dot',
              'Demo_Step',
              'Demo_Pause',
              'Yours',
              'Yours_List',
              'Make',
              'Make_Intro',
              'Make_List',
              'Make_Card',
              'Card',
              'Make_Shot',
              'How',
              'Steps',
              'Step_Name',
              'Join',
              'Join_Doors',
            ),
            ...code({ home: '.Home' }),
          },
          foot: classes('Foot', 'Foot_Links'),
          guide: classes('Guide'),
        }).map(([part, slots]) => (
          <li key={part} {...say(`sections.${part}`, slots)} />
        ))}
      </ul>
    </Part>
  </Page>
)
