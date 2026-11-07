// The site's own chrome for a page the worker draws rather than serves out of
// public/: the head an engine and a model read, the header, the footer, and
// the response they are wrapped in. It was the gallery's alone until the
// documentation pages needed the same thing (T-37752), and two copies of a
// header is how a visitor ends up on a page that is a little bit not the site.
//
// The nav is the same places on every page of this site or it is not a
// nav (site_test.ts), and the footer the same seven. A drawn page says them
// exactly as the files say them.
import type { VNode } from 'preact'
import { esc, markup } from './html.ts'
import { type Host, url } from './host.ts'
import { asset, links } from './sheets.ts'
import { island, signedIn } from './signed.ts'
import { idle } from './mascot.ts'

// What every drawn page wears in its head, in the shape the file pages wear it
// (site/frame.tsx, site_test.ts): the title and the line, the canonical, the
// Open Graph pair a link unfurls with, and the site's own stylesheet.
export let head = (
  env: Host,
  title: string,
  description: string,
  at: string,
  index = true,
) =>
  `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
${
    index
      ? ''
      : '<meta name="robots" content="noindex">\n'
  }<link rel="canonical" href="${esc(at)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="yaks.app">
<meta property="og:url" content="${esc(at)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${url(env, '/og.png')}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${url(env, '/og.png')}">
<link rel="apple-touch-icon" href="${asset(env, 'apple-touch-icon.png')}">
${links(env, 'style.css')}
<script src="${asset(env, 'idle.js')}" defer></script>
${island}`

export let top = `<header class="Top">
<a class="Top_Name" href="/" aria-label="yaks.app, home">${
  idle('Yak Yak-small')
}<span>yaks.app</span></a>
<nav class="Nav" aria-label="Site">
<a href="/#how">How it works</a>
<a href="/gallery">Gallery</a>
<a href="/pricing">Pricing</a>
<a href="/docs">Documentation</a>
<a class="Nav_SignIn" href="/login">Sign in</a>
${signedIn}
</nav>
</header>`

export let foot = `<footer class="Foot">
${idle('Yak Yak-small')}
<p>yaks.app · Yak Shaving LLC</p>
<ul class="Foot_Links">
<li><a href="/help">Help</a></li>
<li><a href="/docs">Documentation</a></li>
<li><a href="/pricing">Pricing</a></li>
<li><a href="/terms">Terms</a></li>
<li><a href="/privacy">Privacy</a></li>
<li><a href="/acceptable-use">Acceptable use</a></li>
<li><a href="/cookies">Cookies</a></li>
</ul>
</footer>`

export let html = (body: string, status = 200) =>
  new Response(`<!doctype html>\n<html lang="en">\n<head>\n${body}\n`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })

/** A drawn page: its `head` and what the page adds to it, then the site's
 * header, the page's `main` (a tree, rendered here) and the footer. `body`
 * is the body's own class, where the page has one. */
export let drawn = <P>(
  heads: string,
  main: VNode<P>,
  { status = 200, body = '' } = {},
) =>
  html(
    `${heads}\n</head>\n<body${body ? ` class="${body}"` : ''}>\n${top}\n${
      markup(main)
    }\n${foot}\n</body>\n</html>`,
    status,
  )
