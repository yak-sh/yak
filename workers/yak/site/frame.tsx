/** @jsxImportSource react */
// What every page of the site wears around what it says: the head an engine
// and a model read, the header with its nav, and the footer. A page is drawn
// from these and the kit's parts (@yaks/ui) as the deploy writes it into
// public/ (mod.ts), so the eight pages say the nav and the footer once.
//
// The nav is the same places on every page (site_test.ts); the page a link
// names marks it with aria-current, and the home page marks the name instead.
// Signed in, a person reads "Open yaks.app" where "Sign in" is: the page
// leaves with it (sheets.ts `sheeted`). The mark in both is the seated yak,
// idling (mascot.ts `Idle`, idle.js); the home page's hero is its own.
import type { ReactNode } from 'react'
import { Address } from '@yaks/ui'
import {
  PLATFORM_BACKGROUND,
  PLATFORM_DARK_BACKGROUND,
} from '@yaks/platform/woven'
import { Idle } from '../mascot.ts'
import { fields } from '../link-preview.ts'
import { attr, said, text } from './copy.ts'

let SITE = 'https://yaks.app'

/** A space's address, the name in it a person's own:
 * <Yours /> is yourname.yaks.app. */
export let Yours = (
  { name = 'yourname', path = '', ...rest }: {
    name?: string
    path?: string
    [x: string]: unknown
  },
) => (
  <Address {...rest}>
    <Address.Name>{name}</Address.Name>.yaks.app{path}
  </Address>
)

// A meta tag by its name: Open Graph's are properties.
let Meta = ({ name, ...rest }: { name: string; [x: string]: unknown }) => (
  <meta
    {...{ [name.startsWith('og:') ? 'property' : 'name']: name }}
    {...rest}
  />
)

// A preview field's content: a title says the page's name and a description
// its description, each by its key; the rest are as given.
let words = (field: string, page: string, value: string) =>
  /title$/.test(field)
    ? attr('content', `${page}.name`)
    : /description$/.test(field)
    ? attr('content', `${page}.description`)
    : { content: value }

let Head = (
  { page, path, robots, sheet = 'style.css', children }: {
    page: string
    path: string
    robots?: string
    sheet?: string
    children?: ReactNode
  },
) => (
  <head>
    <meta charSet='utf-8' />
    <meta name='viewport' content='width=device-width, initial-scale=1' />
    <title {...text(`${page}.title`)} />
    <meta name='color-scheme' content='light dark' />
    {path == '/' && (
      <>
        <link rel='manifest' href='/manifest.webmanifest' />
        <meta name='mobile-web-app-capable' content='yes' />
        <meta name='apple-mobile-web-app-capable' content='yes' />
        <meta
          name='apple-mobile-web-app-status-bar-style'
          content='black-translucent'
        />
        <meta
          name='theme-color'
          media='(prefers-color-scheme: light)'
          content={PLATFORM_BACKGROUND}
        />
        <meta
          name='theme-color'
          media='(prefers-color-scheme: dark)'
          content={PLATFORM_DARK_BACKGROUND}
        />
      </>
    )}
    <link rel='canonical' href={SITE + path} />
    {robots && <meta name='robots' content={robots} />}
    {Object.entries(fields({}, {
      title: said(`${page}.name`),
      description: said(`${page}.description`),
      at: SITE + path,
    })).map(([k, v]) => <Meta key={k} name={k} {...words(k, page, v)} />)}
    <meta property='og:image:width' content='1200' />
    <meta property='og:image:height' content='630' />
    <meta property='og:image:alt' {...attr('content', 'frame.alt')} />
    <meta property='og:locale' content='en_US' />
    <meta name='twitter:image:alt' {...attr('content', 'frame.alt')} />
    <link rel='apple-touch-icon' href='apple-touch-icon.png' />
    <link rel='stylesheet' href={sheet} />
    <script src='idle.js' defer />
    <script type='module' src='away.js' />
    {children}
  </head>
)

let NAV = [
  ['/#how', 'how'],
  ['/gallery', 'gallery'],
  ['/pricing', 'pricing'],
  ['/docs', 'docs'],
]

let HOME_NAV = [
  ['/gallery', 'gallery'],
  ['#cost', 'pricing'],
  ['/docs', 'docs'],
]

// The nav of a page of sections: each of HOME_NAV's jumps to a section the
// page has, and its other links.
let jumps = (sections: string[]) =>
  HOME_NAV.filter(([href]) =>
    !href.startsWith('#') || sections.includes(href.slice(1))
  )

let Top = ({ path, sections }: { path: string; sections?: string[] }) => {
  let home = path == '/'
  return (
    <header className='Top'>
      <a
        className='Top_Name'
        href='/'
        aria-current={home ? 'page' : undefined}
        {...attr('aria-label', 'frame.top.home')}
      >
        {!home && <Idle className='Yak Yak-small' base='.' />}
        <span {...text('frame.top.name')} />
      </a>
      <nav className='Nav' {...attr('aria-label', 'frame.nav.label')}>
        {(sections ? jumps(sections) : NAV).map(([href, key]) => (
          <a
            className='Nav_Link'
            href={href}
            aria-current={href == path ? 'page' : undefined}
            {...text(`frame.nav.${home && key == 'how' ? 'how-home' : key}`)}
          />
        ))}
        <a
          className='Nav_SignIn Nav_Link'
          href='/login'
          {...text('frame.nav.sign-in')}
        />
      </nav>
    </header>
  )
}

let FOOT = [
  'help',
  'docs',
  'pricing',
  'terms',
  'privacy',
  'acceptable-use',
  'cookies',
]

let Foot = () => (
  <footer className='Foot'>
    <Idle className='Yak Yak-small' base='.' />
    <p {...text('frame.foot.by')} />
    <ul className='Foot_Links'>
      {FOOT.map((name) => (
        <li>
          <a
            className='Foot_Link'
            href={`/${name}`}
            {...text(`frame.foot.${name}`)}
          />
        </li>
      ))}
    </ul>
  </footer>
)

/** A page of the site: `copy` is the key its snippets are under in the copy
 * (copy.ts), where `name` is what it is called where it is linked, `title`
 * its tab's and `description` what a preview says of it. `path` is its
 * address, `kind` the body class its frame is asked for by (style.css), and
 * `head` what its head carries besides (its scripts, its structured data).
 * `before` is laid first in its body, under its header (the home page's
 * sky), and `after` last. A page that names no kind is prose in the reading
 * column. */
export let Page = (
  {
    copy,
    path,
    kind,
    robots,
    head,
    before,
    after,
    foot,
    sheet,
    sections,
    dates = true,
    children,
  }: {
    copy: string
    path: string
    kind?: string
    robots?: string
    sheet?: string
    sections?: string[]
    head?: ReactNode
    before?: ReactNode
    after?: ReactNode
    foot?: ReactNode
    dates?: boolean
    children: ReactNode
  },
) => (
  <html lang='en'>
    <Head page={copy} path={path} robots={robots} sheet={sheet}>
      {head}
    </Head>
    <body className={kind}>
      {before}
      <Top path={path} sections={sections} />
      <main className={kind ? 'Page' : 'Page Prose'}>{children}</main>
      {foot ?? <Foot />}
      {dates && <script type='module' src='_dates.js' />}
      {after}
    </body>
  </html>
)

/** Structured data, as a script an engine reads. */
export let Data = ({ of }: { of: unknown }) => (
  <script
    type='application/ld+json'
    dangerouslySetInnerHTML={{
      __html: JSON.stringify(of, null, 2).replaceAll('</', '<\\/'),
    }}
  />
)
