/** Vale's page graph: panel navigation and row selection, never game state.
 * The manager and each List instance have named entities. Consumers subscribe
 * to these rows and send controlled outputs through mutate; no hook owns state.
 */
import { client } from '@yaks/client'
import { type Bundle, comps, derivedEid, mint } from '@yaks/graph'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { kitDocs } from '@yaks/ux'
import { ux as base } from '@yaks/ux/ui'
import { selected, selection, ux } from './ux-kit.ts'

/** Base declarations are composed once, not copied into Vale's vocabulary. */
export let pageDocs = () => kitDocs({ ...base, ...ux })
let query = (eid: string) => `.entity.eid=${JSON.stringify(eid)}`

/** One controller per page; owner can be supplied again for a named instance. */
export let pageState = (owner = mint()) => {
  let front = client(loadVocab(pageDocs()), [], {
    vault: false,
    wireVault: false,
  })
  let mutate = (bundles: Bundle[]) => front.mutate(bundles)
  let row = (eid: string): Bundle =>
    front.read(parse(query(eid)))[0] ?? { entity: { eid } }
  let comp = (eid: string, word: string) =>
    comps(row(eid)).find(([name]) => name == word)?.[1]
  let current = () => comp(owner, 'Panels')
  let opened = () => {
    let panel = current()?.panel
    return typeof panel == 'string' ? panel : undefined
  }
  let pane = () => {
    let tab = current()?.pane
    return typeof tab == 'string' ? tab : undefined
  }
  let open = (panel: string, tab?: string) =>
    mutate([{
      entity: { eid: owner },
      Panels: { panel, pane: tab ?? null },
    }])
  let close = (panel?: string) =>
    panel && opened() != panel ? [] : mutate([{
      entity: { eid: owner },
      Panels: { panel: null },
    }])
  let toggle = (panel: string, tab?: string) =>
    opened() == panel && (tab === undefined || pane() == tab)
      ? close(panel)
      : open(panel, tab)
  let listAt = (panel: string) => derivedEid(`List|${owner}|${panel}`)
  let list = (panel: string) => row(listAt(panel))
  let select = (panel: string, cursor: string | null) =>
    mutate([selected(list(panel), cursor)])
  return {
    owner,
    front,
    ready: front.ready,
    mutate,
    get opened() {
      return opened()
    },
    get pane() {
      return pane()
    },
    open,
    close,
    toggle,
    head: (panel: string, head: string) =>
      mutate([{
        entity: { eid: panel },
        Panel: { head },
      }]),
    heading: (panel: string): string => {
      let head = comp(panel, 'Panel')?.head
      return typeof head == 'string' ? head : ''
    },
    mark: (tab: string, marked: boolean) =>
      mutate([{
        entity: { eid: tab },
        Tab: { marked },
      }]),
    marked: (tab: string) => comp(tab, 'Tab')?.marked == true,
    watchPanel: (panel: string) => front.watch(query(panel)),
    watch: () => front.watch(query(owner)),
    listAt,
    list,
    select,
    cursor: (panel: string) => selection(list(panel)).cursor,
    watchList: (panel: string) => front.watch(query(listAt(panel))),
    dispose: () => front.close(),
  }
}
export type PageState = ReturnType<typeof pageState>
