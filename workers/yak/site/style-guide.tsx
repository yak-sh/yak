/** @jsxImportSource preact */
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
import type { ComponentChildren } from 'preact'
import { WORN } from '../sheet-assets.ts'
import { attr, said, type Slots, text } from './copy.ts'
import { Page, Yours } from './frame.tsx'

// What a person copies or types, in the line.
let Code = (
  { children, ...rest }: { children: ComponentChildren; [x: string]: unknown },
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
let Part = ({ id, children }: { id: string; children: ComponentChildren }) => (
  <section class='Guide_Part' aria-labelledby={id}>
    <h2 class='Title' id={id} {...say(`${id}.title`)} />
    {children}
  </section>
)

// Rules, each the snippet at `<at>.<rule>.rule` led by its name in bold, at
// `<at>.<rule>.name`, with the slots it has besides.
let Rules = ({ at, rules }: { at: string; rules: Record<string, Slots> }) => (
  <ul class='Guide_Rules'>
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
  <li class='Guide_Swatch' data-token={token}>
    <span class='Guide_Chip' style={`--swatch: var(${token})`} />{' '}
    <code class='Guide_Name'>{token}</code> <span class='Guide_Value' />
  </li>
)

// A spacing token: its name, its value and a bar as long.
let Size = ({ token }: { token: string }) => (
  <li class='Guide_Size' data-token={token}>
    <span>
      <code class='Guide_Name'>{token}</code> <span class='Guide_Value' />
    </span>{' '}
    <span class='Guide_Bar' style={`--bar: var(${token})`} />
  </li>
)

// A token's name and its value, as slots of the sentence about it.
let token = (name: string, Name: 'span' | 'code' = 'span') => ({
  name: <Name class='Guide_Name'>{name}</Name>,
  value: <span class='Guide_Value' />,
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
    <div class='Prose_Head'>
      <h1 class='Title Title-page' {...say('head.title')} />
      <p class='Note Note-lead' {...say('head.lead')} />
      <p>
        <label class='Note Note-small' for='theme' {...say('head.theme')} />
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
        class='Note'
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
      <p class='Note Note-small' {...say('how-to.complete')} />
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
      <p class='Note' {...say('language.note')} />
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
      <p class='Note' {...say('theme-roles.note', code({ linen: 'linen' }))} />
      <ul class='Guide_Swatches'>
        {ROLES.map((role) => <Swatch key={role} token={role} />)}
      </ul>
    </Part>
    <Part id='page-paints'>
      <p
        class='Note'
        {...say('page-paints.note', code({ site: 'site.css' }))}
      />
      <ul class='Guide_Swatches'>
        {PAINTS.map((paint) => <Swatch key={paint} token={paint} />)}
      </ul>
    </Part>
    <Part id='type'>
      <Card as='div' class='Guide_Demo'>
        <p data-token='--font'>
          <span class='Guide_Name'>--font</span> <span class='Guide_Value' />
        </p>
        <p data-token='--mono' style='font-family: var(--mono)'>
          <span class='Guide_Name'>--mono</span> <span class='Guide_Value' />
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
      <p class='Note' {...say('space.note', code({ gap: '--gap' }))} />
      <ul class='Guide_Sizes'>
        {GAPS.map((gap) => <Size key={gap} token={gap} />)}
      </ul>
      {['measure', 'wide-measure'].map((measure) => (
        <p
          key={measure}
          class='Note Note-small'
          data-token={`--${measure}`}
          {...say(`space.${measure}`, token(`--${measure}`, 'code'))}
        />
      ))}
      <p
        class='Note Note-small'
        {...say('space.frame', {
          side: <code class='Guide_Name'>--side</code>,
          aside: <code class='Guide_Name'>--aside</code>,
          rhythm: <code class='Guide_Name'>--rhythm</code>,
          ...code({ body: 'body' }),
        })}
      />
      <p class='Note Note-small' {...say('space.shape')} />
      <ul class='Guide_Swatches'>
        <Swatch token='--graphite' />
        <li class='Guide_Swatch' data-token='--stroke'>
          <span
            class='Guide_Chip'
            style='--swatch: var(--card); border: var(--stroke) solid var(--graphite)'
          />{' '}
          <code class='Guide_Name'>--stroke</code> <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--radius'>
          <Card
            as='span'
            class='Guide_Chip'
            style='--swatch: var(--card); border-color: transparent'
          />{' '}
          <code class='Guide_Name'>--radius</code> <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--lift'>
          <Button
            as='span'
            mod='go'
            class='Guide_Chip'
            style='--swatch: var(--accent); border-color: transparent'
          />{' '}
          <code class='Guide_Name'>--lift</code> <span class='Guide_Value' />
        </li>
      </ul>
    </Part>
    <Part id='components'>
      <p class='Note' {...say('components.about')} />
      <Card as='div' class='Guide_Demo'>
        <p class='Guide_Name'>.Title · .Title-hero · .Title-page</p>
        <p class='Title Title-hero' {...say('components.titles.hero')} />
        <p class='Title Title-page' {...say('components.titles.page')} />
        <p class='Title' {...say('components.titles.section')} />
      </Card>
      <Card as='div' class='Guide_Demo'>
        <p class='Guide_Name'>.Note · .Note-lead · .Note-small</p>
        <p class='Note Note-lead' {...say('components.notes.lead')} />
        <p class='Note' {...say('components.notes.body')} />
        <p class='Note Note-small' {...say('components.notes.small')} />
      </Card>
      <Card as='div' class='Guide_Demo'>
        <p class='Guide_Name'>
          .Chat · .Chat_Who · .Chat_Who-you · .Chat_Bubble · .Chat_Bubble-you ·
          .Chat_Bubble-them
        </p>
        <Card as='div' class='Chat'>
          <h3 class='Chat_Who Chat_Who-you' {...say('components.chat.you')} />
          <p
            class='Chat_Bubble Chat_Bubble-you'
            {...say('components.chat.ask')}
          />
          <h3 class='Chat_Who' {...say('components.chat.them')} />
          <p
            class='Chat_Bubble Chat_Bubble-them'
            {...say('components.chat.answer')}
          />
          <p class='Note Note-small' {...say('components.chat.caption')} />
        </Card>
      </Card>
      <Card as='div' class='Guide_Demo'>
        <p class='Guide_Name'>.Said</p>
        <p
          class='Note'
          {...say('components.said.long', {
            ...code({ q: '<q>' }),
            said: <q class='Said' {...say('components.said.invite')} />,
          })}
        />
        <p
          class='Note'
          {...say('components.said.short', {
            said: <q class='Said' {...say('components.said.out')} />,
          })}
        />
      </Card>
      <Card as='div' class='Guide_Demo'>
        <p class='Guide_Name'>
          .Window · .Window_Bar · .Window_Body · .Window_Heading · .Window_List
          · .Window_On · .Window_Body-frame · .Window_Frame
        </p>
        <div class='Window'>
          <div class='Window_Bar'>
            <Chip mod='quiet'>
              <Yours path='/recipes' />
            </Chip>
          </div>
          <div class='Window_Body'>
            <p class='Window_Heading' {...say('components.window.heading')} />
            <ul class='Window_List'>
              {['cake', 'soup'].map((recipe) => (
                <li
                  key={recipe}
                  class='Window_Item'
                  {...say(`components.window.${recipe}`)}
                />
              ))}
            </ul>
            <p
              class='Note Note-small'
              {...say('components.window.note', {
                on: (
                  <span class='Window_On' {...say('components.window.soup')} />
                ),
              })}
            />
          </div>
        </div>
        <div class='Window'>
          <div class='Window_Bar'>
            <Chip mod='quiet'>
              <Yours path='/preview' />
            </Chip>
          </div>
          <div class='Window_Body Window_Body-frame'>
            <iframe
              class='Window_Frame'
              {...attr('title', 'style-guide.components.window.title')}
              srcdoc={PREVIEW}
            />
          </div>
        </div>
      </Card>
      <Card as='div' class='Guide_Demo'>
        <p class='Guide_Name'>.Yak · .Yak-small · .Yak-big</p>
        <p>
          <img class='Yak Yak-small' src='yak.webp' alt='' />
        </p>{' '}
        <img
          class='Yak Yak-big'
          src='yak.webp'
          {...attr('alt', 'style-guide.components.yak.alt')}
        />{' '}
        <p
          class='Note Note-small'
          {...say('components.yak.note', code({ file: 'yak.webp' }))}
        />
      </Card>
      <Card as='div' class='Guide_Demo'>
        <p class='Guide_Name'>.Prose · .Prose_Head · .Prose_When</p>
        <div class='Prose'>
          <div class='Prose_Head'>
            <h3 class='Title Title-page' {...say('components.prose.title')} />
            <p
              class='Prose_When Prose_Text'
              {...say('components.prose.when')}
            />
          </div>
          <section class='Prose_Section'>
            <h2 class='Prose_Heading' {...say('components.prose.heading')} />
            <p
              class='Prose_Text'
              {...say('components.prose.text', {
                code: (
                  <code class='Prose_Code' {...say('components.prose.code')} />
                ),
              })}
            />
            <ul class='Prose_List'>
              <li class='Prose_Item' {...say('components.prose.quiet')} />
              <li
                class='Prose_Item'
                {...say('components.prose.accent', {
                  link: (
                    <a
                      class='Prose_Link'
                      href='#components'
                      {...say('components.prose.link')}
                    />
                  ),
                })}
              />
            </ul>
            <address
              class='Prose_Address'
              {...say('components.prose.address')}
            />
          </section>
        </div>
      </Card>
    </Part>
    <Part id='kit'>
      <p class='Note' {...say('kit.note')} />
      <Worn parts={PARTS} composition={drawn} />
    </Part>
    <Part id='sections'>
      <p class='Note' {...say('sections.note')} />
      <ul class='Guide_Rules'>
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
