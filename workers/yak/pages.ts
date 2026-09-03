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
:root { color-scheme: light; --ground: #fdf5ee; --paper: #fffaf5; --ink: #4a3a30; --soft-ink: #6f5d50; --line: #efdfd2; --meadow: #5c8a4c; --warn: #a8503f }
@media (prefers-color-scheme: dark) { :root { color-scheme: dark; --ground: #2a2320; --paper: #352c28; --ink: #f1e6d8; --soft-ink: #c2b2a3; --line: #4a3d37; --meadow: #a7c080; --warn: #e67e80 } }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--ground); color: var(--ink); font: 400 1.05rem/1.6 'Nunito', system-ui, sans-serif }
main { max-width: 30rem; padding: 2rem; text-align: center }
h1 { font-size: 1.6rem; font-weight: 800; margin: 0 0 .5rem }
p { color: var(--soft-ink); margin: 0 0 1rem }
a { color: var(--meadow) }
form { display: grid; gap: .75rem; margin: 1.5rem 0 1rem }
form p { margin: 0; font-size: .95rem }
input { font: inherit; text-align: center; padding: .7rem 1rem; border: 2px solid var(--line); border-radius: 1.25rem; background: var(--paper); color: var(--ink) }
input:focus-visible { outline: 3px solid var(--meadow); outline-offset: 2px }
button { font: inherit; font-weight: 700; padding: .7rem 1rem; border: 0; border-radius: 1.25rem; background: var(--meadow); color: var(--ground); cursor: pointer }
.Code { letter-spacing: .5em; font-size: 1.4rem; font-weight: 700 }
.Away { font-size: .95rem }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9rem; background: var(--ground); border-radius: .4rem; padding: .1rem .35rem; overflow-wrap: anywhere }
.Url code { display: inline-block; padding: .5rem 1rem; border-radius: 999px; background: var(--paper); font-size: .95rem }
.Card { margin: 0 0 1rem; padding: 1.1rem 1.25rem; border-radius: 1.25rem; background: var(--paper); text-align: left }
.Card h2 { font-size: 1.05rem; font-weight: 800; margin: 0 0 .6rem }
.Card ol { display: grid; gap: .4rem; margin: 0; padding-left: 1.2rem; color: var(--soft-ink); font-size: .95rem }
.Card li::marker { color: var(--meadow); font-weight: 700 }
.Card form { margin: 1rem 0 0 }
.Note { font-size: .9rem; margin: .75rem 0 0 }
.Pills { display: flex; flex-wrap: wrap; justify-content: center; gap: .625rem; margin: 0 0 1.25rem }
.Pill { display: inline-block; padding: .5rem 1rem; border: 1px solid var(--line); border-radius: 999px; background: var(--paper); color: var(--ink); font-weight: 700; text-decoration: none }
.Pill:hover { border-color: var(--meadow) }
.Button { display: inline-block; padding: .7rem 1.2rem; border-radius: 1.25rem; background: var(--meadow); color: var(--ground); font-weight: 700; text-decoration: none }
.Pick { display: block; margin: .4rem 0; padding: .5rem .6rem; user-select: all }
.At { display: flex; align-items: center; justify-content: center; gap: .3rem }
.At input { flex: 0 1 13rem; text-align: right }
.At span { color: var(--soft-ink) }
.Say { min-height: 1.3rem; margin: 0; font-size: .95rem }
.Say-no { color: var(--warn) }
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

// The space's own address when no app is its front page (T-33040). A space
// that EXISTS is not a 404: this is a door, not a failure. One page, of
// blocks that appear when they are true of whoever is looking —
//
//   the apps this person may open   whenever there are any
//   asking for the rest             only when something is actually held back
//   signing in                      signed out
//   what this place is              signed out; a stranger, not a neighbour
//   this page is a choice           the space's owner, and nobody else
//
// The filtering is the part to get right: an app someone may not read is not
// NAMED here (apps.ts asks `reads` per app), and the line about asking for
// access appears only when something is being held back — so the page never
// implies a private app that is not there.
//
// `pitch` is one block on purpose: white-labelling (T-33069) turns our own
// voice off on a paid space, and that has to be a condition around a block
// rather than an edit to a page.
export let spaceIndex = (at: {
  space: string
  title: string
  apps: { slug: string; title: string }[]
  hidden: number
  role: string | null
  person: boolean
  signIn: string
}) => {
  let owner = at.role == 'owner'
  let mine = at.apps.length
    ? `<nav class="Pills" aria-label="Apps here">${
      at.apps.map((a) =>
        `<a class="Pill" href="/${esc(a.slug)}/">${esc(a.title || a.slug)}</a>`
      ).join('')
    }</nav>`
    : ''
  let ask = at.hidden && !owner
    ? `<p class="Note">${
      at.hidden == 1 ? 'One app here is' : `${at.hidden} apps here are`
    } private. Ask whoever runs this space to let you in.</p>`
    : ''
  let inn = at.person
    ? ''
    : `<p><a class="Button" href="${esc(at.signIn)}">Sign in</a></p>`
  let pitch = at.person ? '' : `<div class="Card">
<h2>What is yaks.app?</h2>
<p class="Note">Ask an assistant like Claude or ChatGPT for an app, and it
builds one here — a page of your own you can send to anyone.</p>
<p><a class="Away" href="https://yaks.app/">Make one of your own</a></p>
</div>`
  let yours = owner
    ? `<div class="Card">
<h2>This page is yours to set</h2>
<p class="Note">${
      at.apps.length
        ? 'Ask your assistant to make one of these apps the front page, and ' +
          'it opens here instead of this list.'
        : 'Ask your assistant to build something here — a list, a site, a ' +
          'game — and it lives at this address.'
    }</p>
</div>`
    : ''
  let lead = at.apps.length
    ? 'Here is what you can open.'
    : owner
    ? 'Nothing has been built here yet.'
    : 'Nothing here is open to visitors yet.'
  return shell(
    esc(at.title || at.space),
    lead,
    200,
    `${mine}${ask}${yours}${inn}${pitch}${at.person ? home : ''}`,
  )
}

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

// A hidden field, only when there is something to carry.
let held = (name: string, value?: string | null) =>
  value ? `<input type="hidden" name="${name}" value="${esc(value)}">` : ''

// What each card carries forward: the authorize request's own query string,
// so the code form lands back where it started, and the page the person was
// on before they were asked to sign in, so the code hands them back to it
// (T-32593). Whether that address is one to follow is the login door's to
// decide, never this page's.
let carried = (q: string | null, back?: string | null) =>
  held('q', q) + held('return', back)

// Ask for an address. `who` names the app asking, when one is (the OAuth
// consent page IS this page — signing in is the consent).
export let askEmail = (
  q: string | null,
  back: string | null,
  who?: string,
  status = 200,
) =>
  shell(
    'Sign in to yaks.app',
    who
      ? `${esc(who)} would like to use your apps. Pop in your email and ` +
        "we'll send a code."
      : "Pop in your email and we'll send you a six-digit code.",
    status,
    `<form method="post" action="/login">${carried(q, back)}
<input name="email" type="email" required autofocus autocomplete="email" placeholder="you@example.com" aria-label="Your email">
<button type="submit">Send me a code</button>
</form>${home}`,
  )

// The one question the platform ever asks a person about themselves, and only
// while nobody has answered it: what their apps should call them beside what
// they write (T-32654). Optional — skipped, the front of their address does.
let naming = `<p>And what should we call you? Skip it and we'll use the front
of your address.</p>
<input name="name" maxlength="60" autocomplete="name" placeholder="Dana" aria-label="What should we call you?">`

// Ask for the code just mailed. `ask` adds the name question, for someone
// nobody has named yet. `why` is the soft refusal, when there was one.
export let askCode = (
  email: string,
  q: string | null,
  back: string | null,
  ask = false,
  why?: string,
  status = 200,
) =>
  shell(
    'Check your email',
    why ?? `We sent a six-digit code to ${esc(email)}. It lasts ten minutes.`,
    status,
    `<form method="post" action="/login/code">${carried(q, back)}
<input type="hidden" name="email" value="${esc(email)}">
<input class="Code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autofocus autocomplete="one-time-code" aria-label="Your six-digit code">
${ask ? naming : ''}
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

// Where a fresh sign-in lands (T-32972): the one page that gets a person from
// an account to a working assistant. Two things live on it and neither waits
// for the other — the address their apps will live at, theirs to change while
// nothing is built there (T-32967), and how to hand this platform to the
// assistant they already talk to. Connecting is never gated on choosing.
//
// The provider steps were read off each provider's own documentation on
// 2026-09-03 (claude.com/docs/connectors/custom/remote-mcp,
// code.claude.com/docs/en/mcp-quickstart,
// developers.openai.com/api/docs/guides/developer-mode). Menus move: the last
// line says so, and says what to search for instead, because a stale
// instruction with no way past it is worse than none.
export type Yours = {
  slug: string
  // A space with apps in it keeps its address: an app's URL is this slug,
  // and moving one wants the redirect a rename already wants (T-32576).
  fixed: boolean
  said?: string
  say?: string
  no?: boolean
}

let MCP = 'https://yaks.app/mcp'

// The address card, for a person who is signed in. The form posts, so it
// works with no script at all; the script below turns that into an inline
// answer, which is what a person choosing a name expects.
let mine = (y: Yours) =>
  y.fixed
    ? `<section class="Card"><h2>Where your apps live</h2>
<p>Your apps live at <b>${esc(y.slug)}.yaks.app</b>.</p>
<p class="Note">You've built something here, so this one stays put for now.</p>
</section>`
    : `<section class="Card"><h2>Where your apps live</h2>
<p class="Now">Your apps live at <b>${esc(y.slug)}.yaks.app</b>. It's yours to
change while nothing is built there.</p>
<form class="Addr" method="post" action="/connect">
<span class="At"><input name="space" maxlength="63" autocomplete="off" spellcheck="false" aria-label="The name your apps live at" value="${
      esc(y.said ?? y.slug)
    }"><span>.yaks.app</span></span>
<button type="submit">Save</button>
<p class="Say${y.no ? ' Say-no' : ''}" role="status">${esc(y.say ?? '')}</p>
</form>
</section>`

let steps = (name: string, items: string[], note?: string) =>
  `<section class="Card"><h2>${name}</h2>
<ol>${items.map((s) => `<li>${s}</li>`).join('')}</ol>
${note ? `<p class="Note">${note}</p>` : ''}
</section>`

// Nothing interpolated below is anybody's input, so it is written as the
// markup it is; everything that IS a person's is escaped where it enters.
let doors = [
  steps(
    'Claude — web, desktop and mobile',
    [
      'Open <a href="https://claude.ai/customize/connectors">Connectors</a> ' +
      'in your settings.',
      'Click <b>Add custom connector</b>.',
      `Paste <code>${MCP}</code> as the URL and click <b>Add</b>.`,
      'Click <b>Connect</b>, and sign in with your email.',
    ],
    'A remote connector follows you to every Claude — the phone too. On a ' +
      'Team or Enterprise plan an owner adds it once under Organization ' +
      'settings, and everyone else clicks Connect.',
  ),
  steps(
    'Claude Code',
    [
      `In your terminal: <code class="Pick">claude mcp add --transport http yaks ${MCP}</code>`,
      'Start Claude Code, run <code>/mcp</code>, pick <b>yaks</b> and choose ' +
      '<b>Authenticate</b>. It opens your browser to sign in.',
    ],
    'Add <code>--scope user</code> to that first line to have it in every ' +
      'project, not just this one.',
  ),
  steps(
    'ChatGPT — on the web',
    [
      'In <b>Settings</b> → <b>Security and login</b>, turn on ' +
      '<b>Developer mode</b>.',
      'Open <a href="https://chatgpt.com/plugins">chatgpt.com/plugins</a> and ' +
      'press the <b>+</b> button.',
      'Give it a name, then enter <code>' + MCP + '</code> as the MCP server ' +
      'URL — keep the <code>/mcp</code> on the end.',
      'Create it and sign in when it asks. It appears under <b>Developer ' +
      'mode</b> below the message box.',
    ],
    'The web app, not the phone one. On a Business or Enterprise workspace ' +
      'an admin may have to allow developer mode first.',
  ),
  steps('Anything else that speaks MCP', [
    `Give it <code>${MCP}</code>, over streamable HTTP. It will walk you ` +
    'through signing in.',
  ]),
].join('')

// One listener, no framework: the form answers in place. Constant text, no
// interpolation, and every write to the page is textContent — the page never
// speaks HTML on a person's behalf.
let inline = `<script>
let f = document.querySelector('.Addr')
if (f) f.addEventListener('submit', async (e) => {
  e.preventDefault()
  let say = f.querySelector('.Say')
  let go = f.querySelector('button')
  let now = document.querySelector('.Now b')
  go.disabled = true
  say.className = 'Say'
  say.textContent = 'Saving…'
  try {
    let r = await fetch('/connect', {
      method: 'POST',
      headers: { accept: 'application/json' },
      body: new FormData(f),
    })
    let out = await r.json()
    if (out.address) {
      now.textContent = out.address
      f.querySelector('input').value = out.slug
      say.textContent = 'Saved. Your apps live at ' + out.address + '.'
    } else {
      say.className = 'Say Say-no'
      say.textContent = out.error
    }
  } catch (_) {
    say.className = 'Say Say-no'
    say.textContent = "That didn't go through. Try again?"
  }
  go.disabled = false
})
</script>`

export let connect = (yours: Yours | null, status = 200) =>
  shell(
    'Connect your assistant',
    'Give Claude or ChatGPT this link, once. Then ask it for what you want.',
    status,
    `<p class="Url"><code>${MCP}</code></p>
${yours ? mine(yours) : ''}${doors}
<p class="Note">Menus move. If yours doesn't look like this, search its
settings for "connector" or "MCP" — the link is the same wherever it
goes.</p>
<p class="Note">New here? <a href="https://yaks.app/help">Help</a> answers the
questions people ask most: what you can make, where your apps live, and who
can see them.</p>
${home}${yours ? inline : ''}`,
  )
