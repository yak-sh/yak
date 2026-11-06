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

let SITE = 'https://yaks.app'
let ALT = 'yaks.app: build an app by asking Claude or ChatGPT'

/** A space's address, the name in it a person's own:
 * <Yours /> is yourname.yaks.app. */
export let Yours = ({ name = 'yourname', path = '' }) => (
  <Address>
    <Address.Name>{name}</Address.Name>.yaks.app{path}
  </Address>
)

let Head = (
  { title, name, description, path, robots, children }: {
    title: string
    name: string
    description: string
    path: string
    robots?: string
    children?: ComponentChildren
  },
) => (
  <head>
    <meta charset='utf-8' />
    <meta name='viewport' content='width=device-width, initial-scale=1' />
    <title>{title}</title>
    <meta name='description' content={description} />
    <meta name='color-scheme' content='light dark' />
    <link rel='canonical' href={SITE + path} />
    {robots && <meta name='robots' content={robots} />}
    <meta property='og:type' content='website' />
    <meta property='og:site_name' content='yaks.app' />
    <meta property='og:url' content={SITE + path} />
    <meta property='og:title' content={name} />
    <meta property='og:description' content={description} />
    <meta property='og:image' content={`${SITE}/og.png`} />
    <meta property='og:image:width' content='1200' />
    <meta property='og:image:height' content='630' />
    <meta property='og:image:alt' content={ALT} />
    <meta property='og:locale' content='en_US' />
    <meta name='twitter:card' content='summary_large_image' />
    <meta name='twitter:title' content={name} />
    <meta name='twitter:description' content={description} />
    <meta name='twitter:image' content={`${SITE}/og.png`} />
    <meta name='twitter:image:alt' content={ALT} />
    <link rel='apple-touch-icon' href='apple-touch-icon.png' />
    <link rel='stylesheet' href='style.css' />
    <script src='idle.js' defer />
    {children}
  </head>
)

let NAV = [
  ['/#how', 'How it works'],
  ['/gallery', 'Gallery'],
  ['/pricing', 'Pricing'],
  ['/docs', 'Documentation'],
]

let Top = ({ path }: { path: string }) => {
  let home = path == '/'
  return (
    <header class='Top'>
      <a
        class='Top_Name'
        href='/'
        aria-current={home ? 'page' : undefined}
        aria-label='yaks.app, home'
      >
        {!home && <Idle class='Yak Yak-small' base='.' />}
        <span>yaks.app</span>
      </a>
      <nav class='Nav' aria-label='Site'>
        {NAV.map(([href, said]) => (
          <a href={href} aria-current={href == path ? 'page' : undefined}>
            {home && href == '/#how' ? 'How yaks.app works' : said}
          </a>
        ))}
        <a class='Nav_SignIn' href='/login'>Sign in</a>
      </nav>
    </header>
  )
}

let FOOT = [
  ['/help', 'Help'],
  ['/docs', 'Documentation'],
  ['/pricing', 'Pricing'],
  ['/terms', 'Terms'],
  ['/privacy', 'Privacy'],
  ['/acceptable-use', 'Acceptable use'],
  ['/cookies', 'Cookies'],
]

let Foot = () => (
  <footer class='Foot'>
    <Idle class='Yak Yak-small' base='.' />
    <p>yaks.app · Yak Shaving LLC</p>
    <ul class='Foot_Links'>
      {FOOT.map(([href, said]) => (
        <li>
          <a href={href}>{said}</a>
        </li>
      ))}
    </ul>
  </footer>
)

/** A page of the site: `name` is what it is called where it is linked,
 * `title` its tab's (the name and the site's by default), `path` its address,
 * `kind` the body class its frame is asked for by (style.css), and `head`
 * what its head carries besides (its scripts, its structured data). A page
 * that names no kind is prose in the reading column. */
export let Page = (
  {
    name,
    title = `${name} · yaks.app`,
    description,
    path,
    kind,
    robots,
    head,
    after,
    children,
  }: {
    name: string
    title?: string
    description: string
    path: string
    kind?: string
    robots?: string
    head?: ComponentChildren
    after?: ComponentChildren
    children: ComponentChildren
  },
) => (
  <html lang='en'>
    <Head
      title={title}
      name={name}
      description={description}
      path={path}
      robots={robots}
    >
      {head}
    </Head>
    <body class={kind}>
      <Top path={path} />
      <main class={kind ? 'Page' : 'Page Prose'}>{children}</main>
      <Foot />
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
