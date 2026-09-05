// What the connector answers before anyone has signed in (T-33030). Owner,
// 2026-09-03, setting up the ChatGPT connector: "i selected 'mixed auth',
// because i think we offer some tools if you haven't authed yet? or at least
// we should."
//
// So: an agent that has not signed in can learn what this platform is and how
// building here works — the same thing a person reads on the website — and
// nothing else. `about` says what yaks.app is in a paragraph, and the guide
// resources are the depth. Both are already world-readable over plain HTTP —
// https://yaks.app/guide.md and every guide/<slug>.md answer 200 to anybody —
// so this exposes nothing new; it puts the same words through the door the
// agent is already talking to, instead of making it open a browser.
//
// The seam is physical rather than a check. `answer` takes a METHOD and its
// params — never a person, never a Ctx (tools.ts) — and the only binding it
// holds is `Site`, the static assets. No store, no directory, no blob and no
// stream is in reach of this file, so nothing here can forget to check who is
// asking: it has nothing to check them against, and no way to look anything
// up about them. What it cannot answer it answers `null`, and mcp.ts meets
// that caller with the 401 and its `WWW-Authenticate` challenge — the line an
// MCP client follows to find our authorization server, so it must stay
// exactly what it was for every protected method.
//
// And everything public is served signed in too: tools.ts lifts each `Says`
// into an ordinary tool and mcp.ts's resources open with these `DOCS`, so the
// public surface is a SUBSET of the full one by construction, never a second
// surface that could drift from it.
//
// One thing this surface may never say: yaks.app is declared to the plugin
// directories as an app that does not link to subscriptions or purchases, and
// this text is the part of it a stranger reads. No pricing, no plan, no
// upgrade, no billing link — not even "free to start", which names a paid
// tier by implying one. When there is something to sell, a ceiling that says
// "upgrade" inside a tool reply (usage.ts) is what would quietly contradict
// that declaration; here, before anyone has even signed in, is the last place
// it would belong.
import type { Security } from '@yaks/mcp'
import { VERSION } from '../../src/version.ts'
import type { Env } from './env.ts'
import { PAGES, uriOf, WHOLE } from './guide.ts'

// The whole world a public answer can see: the static site, which serves the
// guide at the very addresses the listing names. Everything else in `Env` is
// a way to read somebody's data, and none of it is here.
export type Site = Pick<Env, 'ASSETS'>

// The versions this door speaks, newest first. A client asks for one in
// initialize; we answer with the same when we know it, else with ours, and
// the client decides whether it can live with that — echoing whatever was
// asked would claim a protocol we have never seen. It lives here because the
// public initialize answers before the door has a person, and the two
// negotiate identically.
let PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

export let spoken = (asked: unknown) =>
  typeof asked == 'string' && PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0]

// A tool with nothing to look up: its whole answer is a text written here,
// the same words for every caller. That is the only shape a tool can have
// before anyone has signed in, and it is what makes the public list safe to
// serve without knowing who is asking.
export type Says = {
  name: string
  title: string
  description: string
  text: string
}

export let NO_ARGS = { type: 'object' as const, properties: {} }

// What yaks.app is, for an agent that has just met it. It is the one thing to
// say to someone who cannot do anything else yet: what gets made here, where
// it lives, and where signing in happens — with the guide, which they can
// already read.
let ABOUT: Says = {
  name: 'about',
  title: 'What yaks.app is',
  description:
    'What yaks.app is and what gets made here. Call it when someone asks ' +
    'what this place is, or when you have not signed in and want to know ' +
    'what signing in would give you — it answers in a paragraph and says ' +
    'where to sign in. It reads nothing about anybody: the same words for ' +
    'everyone.',
  text: `yaks.app is a place to make small web apps by asking for one. An app
is an index.html and whatever files sit beside it — no build step, no
framework, no install — served live at its own address,
yourname.yaks.app/<app>/. It opens on a phone, it keeps its data in a store
of its own, and it is a link the person can send to somebody.

What people make here is what they would otherwise keep in a note or a
spreadsheet: a recipe box, a reading list, a signup sheet, a vote, a tracker,
a page for a trip. An app can be private, readable by anyone with the link,
or open for anyone to write to. It can carry tools of its own, which an agent
calls the way it calls these, and code of its own that runs on the server.

Every app also has an address of its own, <space>.<app>@yaks.app — letters to
it land in the app's store, and the app writes from it. That is the app's
mailbox and never a person's own; mail asked about with no app named is their
mail account, which is somewhere else entirely.

Everything else here needs signing in: making a space or an app, writing its
files, deploying it, reading or writing its data. Sign in at
https://yaks.app — an email address and a six-digit code, no password — and
this connector grows the tools to build with.

The guide needs no account and is worth reading first: https://yaks.app/guide.md
is the map, and a page per subject sits beside it.`,
}

export let PUBLIC: Says[] = [ABOUT]

// What these tools declare about signing in, per tool: nothing is needed for
// any of them. It is said out loud rather than left off, because a host reads
// a MIXED-auth server one tool at a time — `securitySchemes` is the only place
// this door says which of its tools a stranger may call, and a tool that says
// nothing is a tool ChatGPT will not offer a sign-in button for
// (developers.openai.com/plugins/reference). The tools that DO need signing in
// say `oauth2` the same way (mcp.ts `SIGNIN`).
export let NOAUTH: Security[] = [{ type: 'noauth' }]

// What a resource of this door's own is: a listing entry, plus the address
// its bytes come off the assets at (`page`), which for everything here is the
// address in `uri` — a client may read it through this door or simply follow
// the link.
export type Doc = {
  uri: string
  name: string
  title: string
  description: string
  mimeType: string
  page: string
}

// The guide is how an app is built here, and how its pages save and list
// through the client the kernel serves them (public/guide.md): the map,
// covering pretty much everything, briefly.
let GUIDE: Doc = {
  uri: WHOLE,
  name: 'building-an-app',
  title: 'Building an app on yaks.app',
  description:
    'The map: what an app is, how its pages read and write its store ' +
    'through ./api/client.js, and a passage on every feature there is. ' +
    'Read it first; read a page below for the depth on one of them.',
  mimeType: 'text/markdown',
  page: WHOLE,
}

// And the pages that go deep, one per subject (guide.ts, T-32982). They are
// ordinary files under public/, so the address in the listing is the one the
// assets answer, and a person can follow it out of a chat.
let DEEP: Doc[] = PAGES.map((p) => ({
  uri: uriOf(p.slug),
  name: `guide-${p.slug}`,
  title: p.title,
  description: p.description,
  mimeType: 'text/markdown',
  page: uriOf(p.slug),
}))

// The public resources: the guide and its pages, and nothing else. A `ui://`
// view is a page a host renders for a signed-in person's own answer, and an
// app's own view belongs to whoever can reach that app — neither is here, so
// neither can be read from here.
export let DOCS: Doc[] = [GUIDE, ...DEEP]

// One resource's bytes, from the assets the apex serves. A redirect is
// followed once: in production the assets binding drops a page's `.html` and
// answers 307, and a resource that came back as an empty redirect would be a
// view that renders nothing.
export let asset = async (site: Site, url: string) => {
  let page = await site.ASSETS.fetch(new Request(url))
  let to = page.status > 299 && page.status < 400 &&
    page.headers.get('location')
  return to ? site.ASSETS.fetch(new Request(new URL(to, url).href)) : page
}

let listed = ({ uri, name, title, description, mimeType }: Doc) => ({
  uri,
  name,
  title,
  description,
  mimeType,
})

// The whole pre-auth surface: a RESULT for a method this door answers to
// anybody, or null for one it does not — which is every other method, every
// other tool, and every other resource, each of which meets the challenge
// instead. Null is also the answer for a tool or a page that does not exist
// at all, so nothing here says whether an address, a space or an app is real.
export let answer = async (
  method: string,
  params: Record<string, unknown>,
  site: Site,
): Promise<unknown | null> => {
  if (method == 'initialize') {
    return {
      protocolVersion: spoken(params.protocolVersion),
      // Only what is public: tools and resources, both promising to say when
      // they move — which is exactly what signing in does to them, and the
      // stream already announces (stream.ts `told`, T-33004). No prompts,
      // which are actions for a person, and no logging, which is a break in
      // somebody's app. No `mcp-session-id` rides this answer either: the id
      // names a stream, and a stream belongs to a person.
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true },
      },
      serverInfo: { name: 'yaks.app', version: VERSION },
      // What a signed-in caller gets here is the whole recipe for building
      // (guide.ts INSTRUCTIONS). Before signing in, that would be instructions
      // for tools this caller has not got, so the orientation is the one
      // thing that is true either way.
      instructions: ABOUT.text,
    }
  }
  if (method == 'ping') return {}
  if (method == 'tools/list') {
    return {
      // The same title and hints the signed-in list carries (tools.ts lifts
      // these into TOOLS), because this is the list a directory reviewer sees
      // first: a door whose one tool arrives bare reads as a door with no
      // annotations at all.
      tools: PUBLIC.map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: NO_ARGS,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
        _meta: { securitySchemes: NOAUTH },
      })),
    }
  }
  if (method == 'tools/call') {
    let said = PUBLIC.find((t) => t.name == params.name)
    return said ? { content: [{ type: 'text', text: said.text }] } : null
  }
  if (method == 'resources/list') return { resources: DOCS.map(listed) }
  if (method == 'resources/read') {
    let want = DOCS.find((d) => d.uri == params.uri)
    if (!want) return null
    let page = await asset(site, want.page)
    return {
      contents: [{
        uri: want.uri,
        mimeType: want.mimeType,
        text: await page.text(),
      }],
    }
  }
  return null
}
