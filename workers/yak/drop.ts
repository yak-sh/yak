// Deploying by dropping a file (T-34230): `POST /deploy` on a space's own
// hostname, taking one `.zip` of an app's files or one page of HTML, and
// answering the page that says what is live. Jeff: "can we add one other
// simple deploy method? a droppable file input to deploy either a zip of files
// or like a single index.html?"
//
// It is the one door here a person walks through with no assistant at all, so
// it is a plain multipart form (pages.ts `dropZone`) and every no it answers is
// a sentence on a page rather than a code in a body.
//
// What it does with what it took is not written here: form.ts and unzip.ts
// turn the bytes into files as they arrive, each pinned at its content address
// and let go before the next (tools.ts `pinning`), so a drop is bounded by the
// space's room and not the Worker's memory (T-124990). Then the three tools an
// agent would call do the rest — `app_new` where the name is new, the write
// half of `app_files`, `app_deploy` (tools.ts `call`, `wrotePinned`). So a
// drop lands under the same room, the same member guard and the same version
// bump as everything else, and there is no second implementation of a deploy
// to keep in step with the first.
//
// The guard is `writes` (@yaks/member): a space's owner or editor deploys,
// nobody else — the same rule as the file door in apps.ts, which is not the
// app's `access` bargain. An app's `access` says what a stranger may do with
// its data; its bytes are always a member's.
import { apex } from './host.ts'
import * as dirPart from './directory.ts'
import { directory, url as addressOf } from './directory.ts'
import { bound, type Env } from './env.ts'
import { dropped, nothingHere } from './pages.ts'
import { hostOf, route, SLUG } from './route.ts'
import { whoIs } from './session.ts'
import { call, inApp, pinning, wrotePinned } from './tools.ts'
import { unfolded, unzip } from './unzip.ts'
import { FILES } from './meter.ts'
import { writes } from '@yaks/member'
import { caught } from './defects.ts'
import type { Objects } from '@yaks/blob'
import { gathered } from './bytes.ts'
import { type Part, parts } from './form.ts'
import { r2RawObjects } from './lib/objects.ts'
import { refuse } from './tool.ts'
import type { Change } from './written.ts'

// How many bytes a drop's files may hold waiting on their puts at once
// (tools.ts `pinning`). The isolate's 128 MB also holds the file being
// unpacked, the request's chunks and everything else the Worker is doing.
let HELD = 16 * 2 ** 20

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

// The files a drop carries, pinned one by one as they arrive: a zip is its
// entries, and anything else is itself, at its own name.
let opened = async (
  file: Part,
  room: number,
  pins: ReturnType<typeof pinning>,
) => {
  let name = file.filename ?? ''
  if (!/\.zip$/i.test(name) && file.type != 'application/zip') {
    let bytes = await gathered(
      file.body,
      room,
      () => refuse('limit', 'That file is more than this space has room for.'),
    )
    if (bytes.length) await pins.pin({ path: basename(name), bytes })
    return await pins.pinned()
  }
  for await (let entry of unzip(file.body, room)) await pins.pin(entry)
  return unfolded(await pins.pinned())
}

/**
 * What a drop's form carries, read as it arrives: the name typed beside the
 * file, the file's own name, and the files it is, each pinned at its content
 * address as it comes out, with no more than `held` bytes waiting on their
 * puts at once (tools.ts `pinning`). No files when it carries none.
 */
export let received = async (
  req: Request,
  blobs: Pick<Objects, 'put'>,
  room: number,
  held = HELD,
) => {
  let asked = ''
  let name = ''
  let files: Change[] = []
  for await (let part of parts(req)) {
    if (part.name == 'slug') {
      asked = new TextDecoder().decode(
        await gathered(part.body, 1024, () =>
          refuse(
            'arguments',
            'That name cannot be an address — letters, digits and hyphens.',
          )),
      ).trim().toLowerCase()
    } else if (part.name == 'file' && part.filename && !name) {
      name = part.filename
      files = await opened(part, room, pinning(blobs, held))
    }
  }
  return { asked, name, files }
}

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  let r = route(hostOf(req, env), new URL(req.url).pathname, env)
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), true)
  let space = r.space ? await dir.space(r.space) : null
  if (!space) return nothingHere(env)
  let no = (why: string, status = 400) =>
    dropped({ space: space!.slug, why, status }, env)
  let who = await whoIs(
    req,
    env.SESSION_SECRET,
    (p) => dir.role(space!, p),
    space!.eid,
  )
  // Signing in is the way through for a stranger; for somebody signed in who
  // is nobody here, there is no way through and the sentence says whose it is
  // to give.
  if (!writes(who.role)) {
    return who.person
      ? no(
        `${space.slug}.${
          apex(env)
        } is not yours to deploy to — its owner can ` +
          'make you an editor.',
        403,
      )
      : no(
        `Sign in at https://${apex(env)}/login first — deploying here is for ` +
          'whoever this space belongs to.',
        401,
      )
  }
  try {
    let form = await received(
      req,
      r2RawObjects(env.BLOBS),
      FILES[space.tier ?? 'free'],
    )
    if (!form.files.length) {
      return no('Pick a file first — a .zip of the app, or one index.html.')
    }
    let slug = form.asked || slugged(form.name)
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
    let { paths } = await wrotePinned(env, space, it.app, it.who, form.files)
    await call(ctx, 'app_deploy', { space: space.slug, app: slug })
    // The version this drop became, read back rather than parsed out of the
    // tool's sentence: the row is where a version lives.
    let now = await dir.app(space, slug)
    return dropped({
      space: space.slug,
      slug,
      url: now ? addressOf(space, now, env) : undefined,
      version: now?.version ?? undefined,
      files: paths,
    }, env)
  } catch (e) {
    // Everything below here answers a sentence: unzip.ts writes one per
    // refusal, and a tool's own no is already the words an agent would read.
    // Anything else is ours, and the tracker hears it too.
    caught(e, { request: 'POST /deploy', space: space.slug })
    return no(e instanceof Error ? e.message : String(e))
  }
}
