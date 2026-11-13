/** @jsxImportSource preact */
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
import type { ComponentChildren } from 'preact'
import { Address } from '@yaks/ui'
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
  { page, path, robots, children }: {
    page: string
    path: string
    robots?: string
    children?: ComponentChildren
  },
) => (
  <head>
    <meta charset='utf-8' />
    <meta name='viewport' content='width=device-width, initial-scale=1' />
    <title {...text(`${page}.title`)} />
    <meta name='color-scheme' content='light dark' />
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
    <link rel='stylesheet' href='style.css' />
    <script src='idle.js' defer />
    {children}
  </head>
)

let NAV = [
  ['/#how', 'how'],
  ['/gallery', 'gallery'],
  ['/pricing', 'pricing'],
  ['/docs', 'docs'],
]

let Top = ({ path }: { path: string }) => {
  let home = path == '/'
  return (
    <header class='Top'>
      <a
        class='Top_Name'
        href='/'
        aria-current={home ? 'page' : undefined}
        {...attr('aria-label', 'frame.top.home')}
      >
        {!home && <Idle class='Yak Yak-small' base='.' />}
        <span {...text('frame.top.name')} />
      </a>
      <nav class='Nav' aria-label='Site'>
        {NAV.map(([href, key]) => (
          <a
            class='Nav_Link'
            href={href}
            aria-current={href == path ? 'page' : undefined}
            {...text(`frame.nav.${home && key == 'how' ? 'how-home' : key}`)}
          />
        ))}
        <a
          class='Nav_SignIn Nav_Link'
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
  <footer class='Foot'>
    <Idle class='Yak Yak-small' base='.' />
    <p {...text('frame.foot.by')} />
    <ul class='Foot_Links'>
      {FOOT.map((name) => (
        <li>
          <a
            class='Foot_Link'
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
 * `head` what its head carries besides (its scripts, its structured data). A
 * page that names no kind is prose in the reading column. */
export let Page = (
  {
    copy,
    path,
    kind,
    robots,
    head,
    after,
    children,
  }: {
    copy: string
    path: string
    kind?: string
    robots?: string
    head?: ComponentChildren
    after?: ComponentChildren
    children: ComponentChildren
  },
) => (
  <html lang='en'>
    <Head page={copy} path={path} robots={robots}>
      {head}
    </Head>
    <body class={kind}>
      <Top path={path} />
      <main class={kind ? 'Page' : 'Page Prose'}>{children}</main>
      <Foot />
      <script type='module' src='_dates.js' />
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
