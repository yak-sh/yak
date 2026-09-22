// The site's own chrome for a page the worker draws rather than serves out of
// public/: the head an engine and a model read, the header, the footer, and
// the response they are wrapped in. It was the gallery's alone until the
// documentation pages needed the same thing (T-37752), and two copies of a
// header is how a visitor ends up on a page that is a little bit not the site.
//
// The nav is the same four places on every page of this site or it is not a
// nav (site_test.ts), and the footer the same seven. A drawn page says them
// exactly as the files say them.
import { esc } from './html.ts'
import { type Host, url } from './host.ts'

// What every drawn page wears in its head, in the shape the file pages wear it
// (public/*.html, site_test.ts): the title and the line, the canonical, the
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
<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap">
<link rel="stylesheet" href="/style.css">`

export let top = `<header class="Top">
<a class="Top_Name" href="/" aria-label="yaks.app, home"><img class="Yak Yak-small" src="/yak.png" alt="" /><span>yaks.app</span></a>
<nav class="Nav" aria-label="Site">
<a href="/#how">How it works</a>
<a href="/pricing">Pricing</a>
<a href="/docs">Documentation</a>
<a href="/login">Sign in</a>
</nav>
</header>`

export let foot = `<footer class="Foot">
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
