// Deploying by dropping a file (T-34230): `POST /deploy` on a space's own
// hostname, taking one `.zip` of an app's files or one page of HTML, and
// answering the page that says what is live. Jeff: "can we add one other
// simple deploy method? a droppable file input to deploy either a zip of files
// or like a single index.html?"
//
// It is the one door here a person walks through with no assistant at all, so
// it is a plain multipart form (pages.ts `dropZone`) and every no it answers is
// a SENTENCE on a page rather than a code in a body.
//
// What it does with what it took is not written here: unzip.ts turns the bytes
// into files, and then the three tools an agent would call do the rest —
// `app_new` where the name is new, the write half of `app_files`, `app_deploy`
// (tools.ts `call`, `wrote`). So a drop lands under the same ceilings, the same
// member guard and the same version bump as everything else, and there is no
// second spelling of a deploy to keep in step with the first.
//
// The guard is `writes` (@yaks/member): a space's owner or editor deploys,
// nobody else — the same rule as the file door in apps.ts, which is not the
// app's `access` bargain. An app's `access` says what a STRANGER may do with
// its data; its bytes are always a member's.
import * as dirPart from './directory.ts'
import { directory, url as addressOf } from './directory.ts'
import { bound, type Env } from './env.ts'
import { dropped, nothingHere } from './pages.ts'
import { hostOf, PLATFORM, route, SLUG } from './route.ts'
import { whoIs } from './session.ts'
import { call, inApp, wrote } from './tools.ts'
import { type Entry, MAX, unzip } from './unzip.ts'
import { writes } from '@yaks/member'

// A file's own name, with any folders a browser sent in front of it gone
// (a directory drop names `pics/cat.png`) and nothing that could escape left.
let basename = (name: string) => (name.split(/[/\\]/).pop() ?? '').slice(0, 200)

/// slugged('Recipes.zip') -> 'recipes'
/// slugged('My Photo Album.zip') -> 'my-photo-album'
/// slugged('index.html') -> ''
/// slugged('...') -> ''
/** What to call the app, from what the file is called — the same rule the page
 * runs in the browser (pages.ts `dropping`), here for the browser that ran no
 * script. A bare `index.html` says nothing about an app, so it names none and
 * the person is asked. */
export let slugged = (name: string) => {
  let stem = basename(name).replace(/\.[a-z0-9]+$/i, '').toLowerCase()
  if (stem == 'index') return ''
  let slug = stem.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 63)
  return SLUG.test(slug) ? slug : ''
}

// What a new app is called until somebody says otherwise: its own name, said
// the way a person would write it.
let titled = (slug: string) =>
  slug.replace(/-+/g, ' ').replace(/^./, (c) => c.toUpperCase())

// The files a drop carries: a zip is its entries, and anything else is itself,
// at its own name.
let opened = async (file: File): Promise<Entry[]> => {
  let bytes = new Uint8Array(await file.arrayBuffer())
  if (!/\.zip$/i.test(file.name) && file.type != 'application/zip') {
    return [{ path: basename(file.name), bytes }]
  }
  return await unzip(bytes.buffer as ArrayBuffer)
}

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  let r = route(hostOf(req), new URL(req.url).pathname)
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), true)
  let space = r.space ? await dir.space(r.space) : null
  if (!space) return nothingHere()
  let no = (why: string, status = 400) =>
    dropped({ space: space!.slug, why, status })
  let who = await whoIs(req, env.SESSION_SECRET, (p) => dir.role(space!, p))
  // Signing in is the way through for a stranger; for somebody signed in who
  // is nobody here, there is no way through and the sentence says whose it is
  // to give.
  if (!writes(who.role)) {
    return who.person
      ? no(
        `${space.slug}.yaks.app is not yours to deploy to — its owner can ` +
          'make you an editor.',
        403,
      )
      : no(
        `Sign in at https://${PLATFORM}/login first — deploying here is for ` +
          'whoever this space belongs to.',
        401,
      )
  }
  try {
    let form = await req.formData()
    let file = form.get('file')
    if (!(file instanceof File) || !file.size) {
      return no('Pick a file first — a .zip of the app, or one index.html.')
    }
    if (file.size > MAX) {
      return no(
        `That file is ${Math.round(file.size / 1024 / 1024)} MB, and ${
          MAX / 1024 / 1024
        } MB is the most one drop may be.`,
      )
    }
    let asked = String(form.get('slug') ?? '').trim().toLowerCase()
    let slug = asked || slugged(file.name)
    if (!slug) {
      return no(
        'What should the app be called? A zip is named after itself, but ' +
          'index.html needs a name typed beside it — recipes, say.',
      )
    }
    if (!SLUG.test(slug)) {
      return no(
        `${slug} cannot be an address — letters, digits and hyphens, ` +
          'starting with a letter or a digit.',
      )
    }
    let files = await opened(file)
    let ctx = { env, dir, person: who.person! }
    // A name nobody has taken is a new app; a name that is somebody's is an
    // update of it, which is what dropping the same zip twice means. app_new
    // refuses a slug that exists, so asking first is what tells the two apart.
    if (!await dir.app(space, slug)) {
      await call(ctx, 'app_new', {
        space: space.slug,
        slug,
        title: titled(slug),
      })
    }
    // The member guard again, and this time it is the tool's own: `inApp` is
    // what every write in tools.ts goes through.
    let it = await inApp(ctx, { space: space.slug, app: slug }, true)
    let paths = await wrote(env, space, it.app, files)
    await call(ctx, 'app_deploy', { space: space.slug, app: slug })
    // The version this drop became, read back rather than parsed out of the
    // tool's sentence: the row is where a version lives.
    let now = await dir.app(space, slug)
    return dropped({
      space: space.slug,
      slug,
      url: now ? addressOf(space, now) : undefined,
      version: now?.version ?? undefined,
      files: paths,
    })
  } catch (e) {
    // Everything below here answers a sentence: unzip.ts writes one per
    // refusal, and a tool's own no is already the words an agent would read.
    return no(e instanceof Error ? e.message : String(e))
  }
}
