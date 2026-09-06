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
import type { Tool } from '@yaks/graph'
import type { Security } from '@yaks/mcp'
import { mode, reads } from '@yaks/member'
import { EITHER, SIGNIN } from './preauth.ts'
import type { Reach } from './reach.ts'
import { SAYS, SIGN_IN } from './route.ts'
import { nobody } from './session.ts'
import { type Ctx, TOOLS } from './tools.ts'

type Args = Record<string, unknown>

/** Does this tool work with nobody signed in? A tool says so by declaring
 * `noauth` among its schemes (preauth.ts `EITHER`), which is the same field a
 * host reads to tell a mixed-auth server's open tools from its closed ones —
 * so the claim and the declaration cannot drift apart. */
export let openly = (t: { security?: Security[] }) =>
  !!t.security?.some((s) => s.type == 'noauth')

/**
 * One tool a stranger is SHOWN and may not call (T-34465, T-34541).
 *
 * Mixed auth is a menu, not a smaller restaurant: the host lists the whole
 * surface with nobody signed in, reads `securitySchemes` to see which tools
 * want a token, and offers the sign-in the first time the person asks for one
 * of those (developers.openai.com/plugins/build/auth). Owner, 2026-09-06:
 * "mixed auth is documented and should work correctly. chatgpt will then
 * prompt auth on the first auth-required tool use." A list holding only what a
 * stranger may CALL is a connector that can never ask them to sign in.
 *
 * It is also what makes the roster FIXED: the same names in the same order for
 * everybody, which is the only list a directory's snapshot can go on matching
 * (declared.ts). So a tool is never dropped for want of a token — it is listed
 * saying `oauth2`, and refused if called.
 *
 * Nothing here is reachable anyway: the door meets a call for any of them with
 * the 401 and its challenge before this server sees it (mcp.ts `stranger`).
 * The sentence is said again here so a later path that let one through could
 * not answer anything else.
 */
export let barred = (t: Tool): Tool => ({
  ...t,
  meta: { ...t.meta, securitySchemes: SIGNIN },
  run: () => Promise.reject(new Error(SAYS)),
})

/**
 * What a tool of THIS door declares about signing in, per tool: the pair for
 * anything a stranger may call, and `oauth2` for the rest. It is a function
 * because the generic tier's tools are the package's own — a read a stranger
 * makes needs no token and the write does — and a host reads this field to
 * decide whether to offer the sign-in at all.
 */
export let asked = (t: { name: string }): Security[] =>
  anonymous(t.name) ? EITHER : SIGNIN

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
