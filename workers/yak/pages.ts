// The kernel's own pages, in the home page's voice (workers/yak/public): what
// a person sees when there is nothing at an address, when an app broke, and
// where they sign in. One shell, three sentences, and an optional card of
// markup under them; the palette is the home page's, inlined so a space's
// hostname needs no asset of the apex. Never a stack trace — the exception
// entity carries that to the person's agent (D-32318 §Errors).
//
// Everything interpolated here is escaped by `esc` at the call site: a page
// carries an email address a stranger typed, and web content never speaks
// HTML (the repo's md.ts rule, one floor down).

// The one escape: `&` first, so an escape is never escaped twice.
export let esc = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')

let home = '<a class="Away" href="https://yaks.app/">yaks.app</a>'

let shell = (title: string, lead: string, status: number, inner = home) =>
  new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${title} · yaks.app</title>
<style>
:root { color-scheme: light; --ground: #fdf5ee; --paper: #fffaf5; --ink: #4a3a30; --soft-ink: #6f5d50; --line: #efdfd2; --meadow: #5c8a4c }
@media (prefers-color-scheme: dark) { :root { color-scheme: dark; --ground: #2a2320; --paper: #352c28; --ink: #f1e6d8; --soft-ink: #c2b2a3; --line: #4a3d37; --meadow: #a7c080 } }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--ground); color: var(--ink); font: 400 1.05rem/1.6 'Nunito', system-ui, sans-serif }
main { max-width: 30rem; padding: 2rem; text-align: center }
h1 { font-size: 1.6rem; font-weight: 800; margin: 0 0 .5rem }
p { color: var(--soft-ink); margin: 0 0 1rem }
a { color: var(--meadow) }
form { display: grid; gap: .75rem; margin: 1.5rem 0 1rem }
input { font: inherit; text-align: center; padding: .7rem 1rem; border: 2px solid var(--line); border-radius: 1.25rem; background: var(--paper); color: var(--ink) }
input:focus-visible { outline: 3px solid var(--meadow); outline-offset: 2px }
button { font: inherit; font-weight: 700; padding: .7rem 1rem; border: 0; border-radius: 1.25rem; background: var(--meadow); color: var(--ground); cursor: pointer }
.Code { letter-spacing: .5em; font-size: 1.4rem; font-weight: 700 }
.Away { font-size: .95rem }
</style>
</head>
<body><main><h1>${title}</h1><p>${lead}</p>${inner}</main></body>
</html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )

export let lost = () =>
  shell(
    'That page wandered off.',
    "There's nothing at this address. Head back home?",
    404,
  )

export let nothingHere = () =>
  shell(
    'Nothing here yet.',
    "This address is waiting for its first app. If it's yours, ask your " +
      'assistant to make something.',
    404,
  )

export let oops = () =>
  shell(
    'Something went wrong.',
    'Your assistant has been told and will take a look. Try again in a ' +
      'little while.',
    500,
  )

// A door a later leaf fills (the connector): plain, not a mystery.
export let soon = (what: string) =>
  shell(`${what} is on its way.`, "We're still setting the table.", 404)

// A hidden field, only when there is something to carry: the authorize
// request's own query string, so the code form lands back where it started.
let carried = (q: string | null) =>
  q ? `<input type="hidden" name="q" value="${esc(q)}">` : ''

// Ask for an address. `who` names the app asking, when one is (the OAuth
// consent page IS this page — signing in is the consent).
export let askEmail = (q: string | null, who?: string, status = 200) =>
  shell(
    'Sign in to yaks.app',
    who
      ? `${esc(who)} would like to use your apps. Pop in your email and ` +
        "we'll send a code."
      : "Pop in your email and we'll send you a six-digit code.",
    status,
    `<form method="post" action="/login">${carried(q)}
<input name="email" type="email" required autofocus autocomplete="email" placeholder="you@example.com" aria-label="Your email">
<button type="submit">Send me a code</button>
</form>${home}`,
  )

// Ask for the code just mailed. `why` is the soft refusal, when there was one.
export let askCode = (
  email: string,
  q: string | null,
  why?: string,
  status = 200,
) =>
  shell(
    'Check your email',
    why ?? `We sent a six-digit code to ${esc(email)}. It lasts ten minutes.`,
    status,
    `<form method="post" action="/login/code">${carried(q)}
<input type="hidden" name="email" value="${esc(email)}">
<input class="Code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autofocus autocomplete="one-time-code" aria-label="Your six-digit code">
<button type="submit">Sign in</button>
</form>${home}`,
  )

// An app asking, for a browser that is already signed in: one click is the
// whole consent.
export let askAllow = (email: string, q: string, who: string) =>
  shell(
    'Connect your apps',
    `${esc(who)} would like to use your yaks.app apps as ${esc(email)}.`,
    200,
    `<form method="post" action="/oauth/allow">${carried(q)}
<button type="submit">Allow</button>
</form>${home}`,
  )
