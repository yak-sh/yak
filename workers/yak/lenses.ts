// The platform's lens wiring: the page's kept deploy decides what it speaks;
// the store keeps the newest chain when its code is rolled back.
import { compile, lensesIn, versions } from '@yaks/lens'
import type { Bundle, Comp } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import type { VocabDoc } from '@yaks/vocab'
import {
  declaredLenses,
  lensDocAt,
  ownSpeaks,
  sessionPackage,
  sessionStep,
} from '@yaks/platform/lenses'
import type { App, Directory, Space } from './directory.ts'
import { storeName } from './directory.ts'
import type { Objects } from '@yaks/blob'
import { pins } from '@yaks/platform/versions'
import type { Rule } from './mover.ts'
import type { Mark } from '@yaks/platform/mover'

// Only lens apps reach this lookup. A deploy's vocabulary bytes are immutable,
// so repeated API calls from the same page never re-read the directory or R2.
// A release records what its pages speak, so a page of one reads its row and
// no file; one made before that reads its vocabulary file from the bucket.
let kept = new Map<string, Record<string, number>>()
export let pageSpeaks = async (
  request: Request,
  dir: Directory,
  blobs: Objects,
  space: Space,
  app: App,
  readDoc: (source: string, file: string) => VocabDoc,
): Promise<Record<string, string>> => {
  let raw = request.headers.get('x-yak-version') ??
    (new URL(request.url).pathname.endsWith('/ws')
      ? new URL(request.url).searchParams.get('version')
      : null)
  if (raw == null) return {}
  let n = Number(raw)
  if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(n)) {
    throw new Refused('invalid page version')
  }
  let key = `${app.eid}/${n}`
  let speaks = kept.get(key)
  if (!speaks) {
    let deploy = await dir.deployAt(app, n)
    if (!deploy) throw new Refused(`no kept page version ${n}`)
    speaks = deploy.speaks
    if (!speaks) {
      let file = ['vocab.yml', 'vocab.json'].find((f) => deploy.files[f])
      let doc: VocabDoc = {}
      if (file) {
        let bytes = await pins(blobs).get(deploy.files[file])
        if (!bytes) throw new Error(`no vocabulary for page version ${n}`)
        doc = readDoc(new TextDecoder().decode(bytes), file)
      }
      speaks = ownSpeaks(
        storeName(space, app),
        doc,
        deploy.lenses?.[sessionPackage] ?? 0,
      )
    }
    // An old vocabulary with no step still speaks the app's version zero.
    kept.set(key, speaks)
    if (kept.size > 128) kept.delete(kept.keys().next().value!)
  }
  let latest = { ...app.lenses, [sessionPackage]: sessionStep }
  if (
    Object.keys(latest).length == Object.keys(speaks).length &&
    Object.entries(latest).every(([pkg, version]) => speaks[pkg] === version)
  ) return {}
  return { 'x-yak-speaks': JSON.stringify(speaks) }
}

export let LENS_MARK = 'yak/store/lens-contract' as const

/** Scoped to this app's own declarations, never a fleet recipe rename. */
export let lensRule = (
  name: string,
  doc: VocabDoc,
  admits: (path: string) => boolean = () => true,
): Rule | null => {
  if (!declaredLenses(doc)) return null
  let rows = lensesIn([lensDocAt(name, doc)])
  let latest = versions([lensDocAt(name, doc)])
  let lens = compile(
    rows,
    Object.fromEntries(
      Object.keys(latest).map((pkg) => [pkg, 0]),
    ),
  )
  let source = lens.sources
  return {
    mark: `${LENS_MARK}/${Object.values(latest)[0]}` as Mark,
    ...(Object.values(doc.$defs ?? {}).some((s) =>
        s.lens === true && s.live === false
      )
      ? {}
      : { live: 'apps' as const }),
    find: lens.find(admits),
    drop: source.filter((path) => {
      let [comp, prop] = path.split('.')
      return prop ? !!doc.$defs?.[comp]?.properties?.[prop] : true
    }),
    move: (row: Bundle, read) => {
      if (
        !source.some((path) => {
          let [comp, prop] = path.split('.')
          return prop
            ? (row[comp] as Comp | undefined)?.[prop] != null
            : !!row[comp]
        })
      ) return []
      // Storage returns null for an empty column. A snapshot's null is
      // absence; a patch's null is a clear, which must not erase its target.
      let present = Object.fromEntries(
        Object.entries(row).map(([name, comp]) => [
          name,
          comp && typeof comp == 'object' && !Array.isArray(comp)
            ? Object.fromEntries(
              Object.entries(comp).filter(([, v]) => v != null),
            )
            : comp,
        ]),
      ) as Bundle
      let facts = lens.views.flatMap((v) =>
        Object.values(v.props).flatMap((p) =>
          'ack' in p
            ? read?.(
              `.${p.ack.component}&?${
                p.ack.order.split('.')[0]
              }&?${p.ack.mark}&*`,
            ) ?? []
            : []
        )
      )
      let patches = lens.put([present], {
        facts: [row, ...facts],
        migrate: true,
      })
      let patch = patches[0]
      for (let path of source) {
        let [comp, prop] = path.split('.')
        if (!prop) {
          patch[comp] = null
          continue
        }
        if ((row[comp] as Comp | undefined)?.[prop] == null) continue
        patch[comp] = { ...patch[comp] as Comp, [prop]: null }
      }
      return patches
    },
  }
}
