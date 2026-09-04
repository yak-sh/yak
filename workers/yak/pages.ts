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

let shell = (
  title: string,
  lead: string,
  status: number,
  inner = home,
  // Extra response headers, beside content-type — `Retry-After` on the
  // provisioning page below, nothing else needs one today.
  headers: Record<string, string> = {},
) =>
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
.Card pre { margin: 0; white-space: pre-wrap; font: inherit; color: var(--soft-ink); text-align: left }
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
.Bill_Doors { display: flex; flex-wrap: wrap; gap: .625rem; margin: 1rem 0 .5rem }
.Bill_Go-quiet { background: transparent; color: var(--meadow); border: 1px solid var(--line) }
</style>
</head>
<body><main><h1>${title}</h1><p>${lead}</p>${inner}</main></body>
</html>`,
    {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
    },
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

// A custom domain that reached the Worker before there was anything to
// answer with (index.ts `settling`, T-33036): mid-provisioning, or one
// Cloudflare has stopped serving. `said` is Cloudflare's own three-line
// reading (domains.ts `reading`) — DNS, validation, certificate — handed on
// whole rather than summarized, because it already says which step is
// pending more specifically than a page here could invent. 503, not 404 or
// 500: the address is right and nothing is broken, it is just not done —
// and a short Retry-After is the whole point of choosing that code, for the
// rare visitor whose client honors it.
export let provisioning = (
  host: string,
  said: string,
  stage: 'pending' | 'error',
) =>
  shell(
    stage == 'error' ? 'This domain needs a fix' : 'Setting up this domain',
    stage == 'error'
      ? `${esc(host)} needs attention before it can serve — here is what ` +
        'Cloudflare says.'
      : `${esc(host)} is being connected to yaks.app. This is usually a ` +
        'matter of minutes, not hours.',
    503,
    `<section class="Card"><h2>${esc(host)}</h2><pre>${
      esc(said)
    }</pre></section>${home}`,
    { 'retry-after': '30' },
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

// Closing a space (T-33166, erase.ts): the page that stands in front of the
// one act on this platform that cannot be undone. It NAMES what dies —
// every app, every domain, everyone who loses their way in, and the address
// going back into circulation — because a person about to lose all of it
// should read the list rather than remember it.
//
// Two ways to say yes, and the page shows whichever the visitor arrived with.
// Off the letter, with its ticket in hand, one button: opening the letter and
// following the link is the deliberate act, and the ticket is what carries it
// (it expires, and the act it opens can only happen once). Straight off the
// web, with no ticket, they type the name back — the guard that makes this
// hard to do by accident when nothing was mailed at all.
//
// The form POSTs to its own address and needs no script, like every other
// card here. Whoever may not delete this space never sees this page: the door
// answers them exactly what it answers for a space that does not exist.
export let askDelete = (at: {
  slug: string
  lines: string[]
  token?: string | null
  // Why this cannot happen at all — a space that is still paying (erase.ts
  // `refused`). The page then names the reason and offers no form.
  stop?: string
  why?: string
  status?: number
}) =>
  shell(
    `Delete ${esc(at.slug)}.yaks.app?`,
    esc(
      at.stop ?? at.why ?? 'This cannot be undone, and nothing is kept.',
    ),
    at.status ?? 200,
    `${
      at.lines.length
        ? `<section class="Card"><h2>What goes, for good</h2>
<ol>${at.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>
</section>`
        : ''
    }
${
      at.stop
        ? ''
        : `<form method="post" action="/space/${esc(at.slug)}/delete">
${held('t', at.token)}
${
          at.token ? '' : `<p>Type <b>${esc(at.slug)}</b> to confirm.</p>
<input name="confirm" autocomplete="off" spellcheck="false" autofocus aria-label="The name of the space">`
        }
<button type="submit">Delete ${esc(at.slug)}.yaks.app forever</button>
</form>
<p class="Note">Changed your mind? Close this page — nothing has happened.</p>`
    }
${home}`,
  )

// And after: what went, and the one thing worth knowing next — the address
// belongs to nobody now, theirs to take again or somebody else's to take
// later.
export let deleted = (said: string) =>
  shell(
    "That's done.",
    esc(said),
    200,
    `<p class="Note">The address is free again. Ask your assistant for a new
space whenever you want one.</p>${home}`,
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
  // What this space pays (billing.ts, T-33125): whether it is on Plus, the
  // day it lapses if it is leaving, and whether Stripe has ever known this
  // space — which is what makes the manage door worth offering. THIS is the
  // surface that starts a purchase, and it is signed-in web only: the agent
  // surface may name the pricing page and nothing else (C-33033).
  plan: { plus: boolean; ends: string; known: boolean }
  // `?paid=1` on the way back from Stripe. The webhook is what actually moves
  // the tier and it may not have landed yet, so the line says "in a moment"
  // rather than claiming something this request cannot see.
  paid?: boolean
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

// The plan card, for a person who is signed in (T-33125). One card with one
// button: Plus when they are free, manage-billing when they are paying. The
// button POSTs to billing.ts and follows the URL Stripe answers, so no Stripe
// address is written into this page and nothing here knows a key.
//
// A day, not a timestamp: "runs until 14 October 2026" is what somebody wants
// to know, and the hour is noise on a monthly bill.
let day = (iso: string) => {
  let at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

let plan = (y: Yours) => {
  let ends = y.plan.ends ? day(y.plan.ends) : ''
  let head = y.plan.plus
    ? `<p>${y.slug}.yaks.app is on <b>Plus</b>.${
      ends ? ` It runs until ${esc(ends)} and then stops renewing.` : ''
    }</p>`
    : `<p>${y.slug}.yaks.app is on the <b>free</b> plan — five apps, 50,000
visits a month, 1 GB. <a href="https://yaks.app/pricing">What Plus holds</a>.</p>`
  // Someone Stripe has met can always reach their own billing, whatever plan
  // they are on today: an invoice from a month they paid for is theirs to
  // read after they cancel.
  let doors = [
    y.plan.plus
      ? ''
      : '<button class="Bill_Go" data-door="checkout">Get Plus — $4 a month</button>',
    y.plan.known
      ? '<button class="Bill_Go Bill_Go-quiet" data-door="portal">Manage billing</button>'
      : '',
  ].filter(Boolean).join('')
  return `<section class="Card Bill"><h2>Your plan</h2>
${head}
${
    y.paid
      ? '<p class="Note">Thanks — that went through. Your space moves to Plus ' +
        'in a moment.</p>'
      : ''
  }
<p class="Bill_Doors">${doors}</p>
<p class="Say Bill_Say" role="status"></p>
</section>`
}

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

// The billing buttons: ask our own door for a Stripe URL and follow it. The
// URL is minted per person and expires, so it is never written into the page.
for (let b of document.querySelectorAll('.Bill_Go')) {
  b.addEventListener('click', async () => {
    let say = document.querySelector('.Bill_Say')
    b.disabled = true
    say.className = 'Say Bill_Say'
    say.textContent = 'One moment…'
    try {
      let r = await fetch('/api/billing/' + b.dataset.door, { method: 'POST' })
      let out = await r.json()
      if (out.url) { location = out.url; return }
      say.className = 'Say Bill_Say Say-no'
      say.textContent = out.error ? out.error.message : 'That did not go through.'
    } catch (_) {
      say.className = 'Say Bill_Say Say-no'
      say.textContent = "That didn't go through. Try again?"
    }
    b.disabled = false
  })
}
</script>`

export let connect = (yours: Yours | null, status = 200) =>
  shell(
    'Connect your assistant',
    'Give Claude or ChatGPT this link, once. Then ask it for what you want.',
    status,
    `<p class="Url"><code>${MCP}</code></p>
${yours ? mine(yours) + plan(yours) : ''}${doors}
<p class="Note">Menus move. If yours doesn't look like this, search its
settings for "connector" or "MCP" — the link is the same wherever it
goes.</p>
<p class="Note">New here? <a href="https://yaks.app/help">Help</a> answers the
questions people ask most: what you can make, where your apps live, and who
can see them.</p>
${home}${yours ? inline : ''}`,
  )
