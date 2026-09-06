// The anonymous surface (T-34467): which tools a stranger may call, and the
// one app a signed-out read answers for.
//
// Owner, 2026-09-06: "we should expose as much as possible to the anon users,
// but obviously, most things will require auth."
//
// So the rule is the web's own. Anything a browser at an address would show
// somebody who never signed in, this door shows too: the guide, the gallery of
// published apps, and the DATA of one app whose pages anyone with the link can
// read. Nothing else — no app of anybody's listed, no space named, no write.
//
// Two halves, and they are declared in different places on purpose:
//
//   the platform's own    a tool of the table (tools.ts) that says
//                         `security: EITHER` — it works with a token and
//                         without one, and `openly` below is that claim read
//                         back. About, the guide, the gallery, feedback.
//   the generic tier      @yaks/mcp's reads, which take no such field because
//                         the package builds them: {@link READS} names them,
//                         and {@link opened} is the app they answer for.
//
// The scoping is the whole of the difference between the two doors. Signed in,
// a read fans out over every app the person can reach (tools.ts `inReach`);
// signed out there is nobody to have a reach, so the call names its app and
// this resolves it — the app's `access` deciding, exactly as it decides for
// the page (apps.ts, door.ts). The store is asked with no vouch on the
// request at all (reach.ts `doorOf` over `nobody`), so the same answer is
// checked twice: here, and by @yaks/member inside the store.
import { z } from 'zod'
import type { Security } from '@yaks/mcp'
import { mode, reads } from '@yaks/member'
import type { Reach } from './reach.ts'
import { SIGN_IN } from './route.ts'
import { nobody } from './session.ts'
import { type Ctx, TOOLS } from './tools.ts'

type Args = Record<string, unknown>

/** Does this tool work with nobody signed in? A tool says so by declaring
 * `noauth` among its schemes (preauth.ts `EITHER`), which is the same field a
 * host reads to tell a mixed-auth server's open tools from its closed ones —
 * so the claim and the declaration cannot drift apart. */
export let openly = (t: { security?: Security[] }) =>
  !!t.security?.some((s) => s.type == 'noauth')

// The generic tier's READS, which signed out answer for one named app. They
// are pinned rather than read off a built door because the door checks a call
// against this list BEFORE it builds anything — a tool nobody may call
// anonymously must meet the challenge, not a graph. @yaks/mcp `core` owns the
// names; one it grows lands here in a diff rather than silently.
export let READS = ['graph_query', 'graph_show', 'graph_schema', 'search']

/** Is this tool on the anonymous door at all? Everything else meets the 401
 * and its challenge, whether it exists or not — so nothing here says which
 * tools a signed-in person would have. */
export let anonymous = (name: string) =>
  READS.includes(name) || TOOLS.some((t) => t.name == name && openly(t))

// What a signed-out read is scoped by, said on every read (@yaks/mcp
// `Options.scope`). The tools never look at these: the door reads them off the
// call and builds the graph they name, and they are declared so a client knows
// to say them.
export let SCOPE = {
  space: z.string().describe(
    'the space the app is in — the <space> of <space>.yaks.app. Required ' +
      'while nobody is signed in: there is no space of yours to mean',
  ),
  app: z.string().describe(
    "the app's slug in that space — the <app> of <space>.yaks.app/<app>/. " +
      'Required while nobody is signed in, and the app must be one anyone ' +
      'with the link can read; app_published lists apps people have offered',
  ),
}

let NAME_IT = 'signed out, a read answers for ONE app: name space and app — ' +
  'the two halves of <space>.yaks.app/<app>/ — and the app must be one ' +
  'anyone with the link can read. app_published lists what people have ' +
  `published, and signing in at ${SIGN_IN} reads every app of your own at ` +
  'once.'

let said = (v: unknown) => typeof v == 'string' ? v.trim() : ''

/**
 * The ONE app a signed-out read is scoped to, as the reach the graph is built
 * over. An app nobody may read without signing in is refused BY NAME — the
 * address already answers that way to a browser, so saying it plainly is what
 * lets the agent tell "not that app" from "not signed in".
 */
export let opened = async (ctx: Ctx, args: Args): Promise<Reach[]> => {
  let slug = said(args.app)
  let where = said(args.space)
  if (!slug || !where) throw new Error(NAME_IT)
  let space = await ctx.dir.space(where)
  let app = space && await ctx.dir.app(space, slug)
  // A trashed app answers nowhere else either (erase.ts): to a stranger it is
  // simply not there.
  if (!space || !app || app.trashed) throw new Error(`no app ${where}/${slug}`)
  if (!reads(mode(app.access), null)) {
    throw new Error(
      `${where}/${slug} is private — only its members read it. Sign in at ` +
        `${SIGN_IN} and ask its owner for a seat.`,
    )
  }
  return [{ space, app, who: nobody }]
}
