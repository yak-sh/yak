// Settings use the same durable draft desk as chat and app inputs. This door
// only admits this person's draft text; it never applies the browser's bundles.
import { draftEid } from '@yaks/draft'
import type { Bundle, Comp } from '@yaks/graph'
import type { Directory } from './directory.ts'
import type { Who } from './session.ts'
import { vouched } from './session.ts'
import { CallError } from '@yaks/tools/errors'

export let settingsPlace = (scope: string) => `settings:${scope}:`

export let settingsDraft = async (
  req: Request,
  dir: Pick<Directory, 'read' | 'apply'>,
  who: Who & { person: string },
): Promise<Response> => {
  let url = new URL(req.url)
  let scope = url.searchParams.get('scope') ?? url.pathname
  let prefix = settingsPlace(scope)
  let headers = {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  }
  let answer = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers })
  if (req.method == 'GET') {
    let bundles = (await dir.read(`.draft.by=${who.person}`)).filter((b) => {
      let d = b.draft as Comp | undefined
      return typeof d?.place == 'string' && d.place.startsWith(prefix)
    })
    return answer({ person: who.person, bundles })
  }
  if (req.method != 'POST') return answer({ message: 'Use GET or POST.' }, 405)
  // Cookie-backed writes arrive only from our own pages.
  if (req.headers.get('origin') != new URL(req.url).origin) {
    return answer(
      { message: 'Open settings on yaks.app to keep this draft.' },
      403,
    )
  }
  let body: { bundles?: Bundle[] }
  try {
    body = await req.json()
  } catch {
    return answer({ message: 'Send draft bundles as JSON.' }, 400)
  }
  if (!Array.isArray(body?.bundles)) {
    return answer({ message: 'Send draft bundles as JSON.' }, 400)
  }
  let bundles: Bundle[] = []
  for (let b of body.bundles) {
    let d = b?.draft as Comp | undefined
    let over = (b?.typed as Comp | undefined)?.over
    if (
      !d || typeof d.place != 'string' || !d.place.startsWith(prefix) ||
      typeof d.text != 'string' || typeof over != 'string'
    ) {
      return answer({
        message: 'Each draft needs its place, text and typed over.',
      }, 400)
    }
    bundles.push({
      entity: { eid: draftEid(who.person, d.place) },
      draft: { by: who.person, place: d.place, text: d.text },
      typed: { over },
    })
  }
  try {
    return answer({
      bundles: await dir.apply({ entities: bundles }, vouched(who)),
    })
  } catch (e) {
    if (e instanceof CallError) return answer({ message: e.message }, 400)
    throw e
  }
}
