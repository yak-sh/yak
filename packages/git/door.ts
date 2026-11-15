// A repository's door: what a clone or a fetch at a repository's address is
// answered with, over repositories its host finds by name. The wire is
// ./http.ts; this decides which address is which door, how a clone is asked
// for its credential, and what it hears when it is not getting one. Where the
// refs and the objects are kept, and who may read them, are the host's.
//
// A repository is `<name>.git`, and smart HTTP knocks on two addresses under
// it (`DOORS`). A name holds no dot of its own, so the split is unambiguous.
// A clone of `<name>/`, the address a browser shows, asks for the
// advertisement there (`BARE`) and is sent to `<name>.git` by a 301, which git
// follows and posts its fetch to where it landed
// (`http.followRedirects=initial`, git's default since 2.11). So the detector
// is the query, never the user agent: `?service=git-upload-pack` is something
// no browser asks for, and a site that serves a static `info/refs` serves it
// to a browser as before.
//
// A clone has to be asked for its credential: git sends none unprompted, so a
// private repository that said 404 would be a 404 to its own owner. So a
// repository the request may not read answers `401 WWW-Authenticate: Basic`
// while nobody has proved anything, and git comes back with a password. Once
// somebody has, the answer is 403, which is terminal: 401 would send git
// round to ask for the password they already gave correctly. A repository
// the host does not find is 404 to everyone, credential or not.
import { advertise, type Refs, SERVICE, uploadPack } from './http.ts'
import type { Objects } from './objects.ts'

/** The two addresses smart HTTP knocks on, under a name wearing `.git`. */
export let DOORS: RegExp = /^\/([^/.]+)\.git\/(info\/refs|git-upload-pack)$/

/** The advertisement asked for at the name's own address, where a clone of
 * the browser's URL begins. */
export let BARE: RegExp = /^\/([^/.]+)\/info\/refs$/

/// knocks('/recipes.git/info/refs') -> true
/// knocks('/recipes/info/refs') -> true
/// knocks('/recipes/') -> false
/** Whether a path is one a clone knocks on, which a host answers with
 * {@link door} ahead of whatever else it serves there. */
export let knocks = (path: string): boolean =>
  DOORS.test(path) || BARE.test(path)

/** A repository a request may be answered from: its refs and its objects. */
export type Repository = { refs: Refs; objects: Objects }

/** A repository as its host found it for one request. */
export type Found = Repository & {
  /** whether this request may read it */
  reads: boolean
  /** whether the request proved who sent it, which makes a refusal final */
  proven: boolean
}

/** What a door is given by its host. */
export type Host = {
  /** The repository called `name`, as `req` may see it, or null where there
   * is none. `password` is what a Basic credential carried, the one scheme
   * git offers once challenged; null where the request carried none. */
  find: (
    name: string,
    req: Request,
    password: string | null,
  ) => Promise<Found | null>
  /** what git prints above its password prompt */
  realm: string
}

// What a clone hears when it is not getting one. Plain text, because the
// thing reading it is git and not a browser.
let refusal = (status: number, say: string, more: HeadersInit = {}) =>
  new Response(`git: ${say}\n`, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...more },
  })

/// password(new Request('http://x', { headers: { authorization: 'Basic ' + btoa('x:tok') } })) -> 'tok'
/// password(new Request('http://x', { headers: { authorization: 'Basic ' + btoa('x:') } })) -> null
/// password(new Request('http://x', { headers: { authorization: 'Bearer tok' } })) -> null
/// password(new Request('http://x')) -> null
/** The password of a request's Basic credential. Its username is whatever
 * the person typed in front of it, which a token that says whose it is makes
 * decoration. */
export let password = (req: Request): string | null => {
  let said = /^Basic +(\S+)$/i.exec(req.headers.get('authorization') ?? '')
  if (!said) return null
  let pair
  try {
    pair = atob(said[1])
  } catch {
    return null
  }
  let colon = pair.indexOf(':')
  return colon < 0 ? null : pair.slice(colon + 1) || null
}

// The browser's address, sent to the repository's own with its query.
let redirect = (req: Request, path: string): Response | null => {
  let bare = BARE.exec(path)
  let url = new URL(req.url)
  if (req.method != 'GET' || !bare) return null
  if (url.searchParams.get('service') != SERVICE) return null
  url.pathname = `/${bare[1]}.git/info/refs`
  return Response.redirect(url, 301)
}

/** The door: a `Response` for a repository's address, `null` for any other,
 * which its host answers as it would without one. */
export let door =
  (host: Host) => async (req: Request): Promise<Response | null> => {
    let path = new URL(req.url).pathname
    let asked = DOORS.exec(path)
    if (!asked) return redirect(req, path)
    let [, name, at] = asked
    let found = await host.find(name, req, password(req))
    if (!found) return refusal(404, 'no such repository')
    if (!found.reads) {
      return found.proven
        ? refusal(403, 'not your repository')
        : refusal(401, 'sign in to clone this repository', {
          'www-authenticate': `Basic realm="${host.realm}"`,
        })
    }
    return at == 'info/refs'
      ? advertise(req)
      : uploadPack(req, found.refs, found.objects)
  }
