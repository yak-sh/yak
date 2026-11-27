// Settings use the same durable draft desk as chat and app inputs. This door
// only admits this person's draft text; it never applies the browser's bundles.
import { type Built, line } from '@yaks/query'
import { draftEid } from '@yaks/draft'
import type { Bundle, Comp } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import type { Vault } from '@yaks/secrets'
import {
  credentialDraft,
  mergeDraft,
  openDraftRow,
} from './credential-drafts.ts'
import { CallError } from '@yaks/tools/errors'

let settingsPlace = (scope: string) => `settings:${scope}:`

type DraftDoor = {
  read: (asked: Built) => Promise<Bundle[]>
  apply: (entities: Bundle[]) => Promise<Bundle[]>
  reread: () => void
}
type DraftVault = Pick<Vault, 'read' | 'seal'>

let keepCredential = async (
  dir: DraftDoor,
  vault: DraftVault,
  row: Bundle,
  draft: Comp,
): Promise<Bundle[]> => {
  let { eid } = row.entity
  for (let attempt = 0;; attempt++) {
    dir.reread()
    let [held] = await dir.read(line`.entity.eid=${eid}&?draft`)
    let kept = await mergeDraft(
      vault,
      row,
      draft,
      held?.draft as Comp | undefined,
      String(draft.text),
      String((row.typed as Comp).over),
    )
    try {
      return (await dir.apply([kept.row])).map((b) =>
        b.entity.eid == eid && b.draft
          ? { ...b, draft: { ...(b.draft as Comp), text: kept.text } }
          : b
      )
    } catch (error) {
      if (!(error instanceof Stale) || attempt >= 2) throw error
    }
  }
}

/** The authenticated settings drafts door, scoped to the signed-in person. */
export let settingsDrafts = async (
  req: Request,
  dir: DraftDoor,
  vault: DraftVault,
  person: string,
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
    let bundles = (await dir.read(line`.draft.by=${person}`)).filter(
      (b) => {
        let d = b.draft as Comp | undefined
        return typeof d?.place == 'string' && d.place.startsWith(prefix)
      },
    )
    return answer({
      person,
      bundles: await Promise.all(bundles.map((b) => openDraftRow(vault, b))),
    })
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
      entity: { eid: draftEid(person, d.place) },
      draft: { by: person, place: d.place, text: d.text },
      typed: { over },
    })
  }
  try {
    let ordinary: Bundle[] = []
    let applied: Bundle[] = []
    for (let row of bundles) {
      let draft = credentialDraft(row)
      if (draft) {
        applied.push(...await keepCredential(dir, vault, row, draft))
      } else ordinary.push(row)
    }
    return answer({
      bundles: [
        ...applied,
        ...ordinary.length ? await dir.apply(ordinary) : [],
      ],
    })
  } catch (e) {
    if (e instanceof CallError) return answer({ message: e.message }, 400)
    throw e
  }
}
