/** The last transcript this browser drew, in the person's page graph. */
import { RETENTION_ROWS, wireIdb } from '@yaks/client'
import { derivedEid } from '@yaks/graph/identity'
import { PAGE_EPOCH, pageDatabase, pageGraph } from './page-graph.ts'

let address = (space: string, person: string) =>
  derivedEid(`operator-copy|${space}|${person}`)

let vault = (person: string) => wireIdb({ name: pageDatabase(person) })

/** The kept transcript for this person and space, if there is one. */
export let keptChat = async (space: string, person: string) => {
  if (!globalThis.indexedDB) return
  let row = await vault(person).peek(PAGE_EPOCH, address(space, person))
  return (row?.comps.operatorCopy as { html?: string } | undefined)?.html
}

// Keep the newest lines. A long attachment, tool output or folded chat must
// not make the local first draw as large as an uncropped conversation.
let recent = (box: HTMLElement) => {
  let talk = box.querySelector('[data-task]')?.cloneNode(true) as
    | HTMLElement
    | undefined
  if (!talk) return ''
  let lines = talk.querySelector('.Transcript_Lines')
  if (!lines) return ''
  while (lines.children.length > 30) lines.firstElementChild?.remove()
  let html = talk.outerHTML
  while (html.length > 256 * 1024 && lines.firstElementChild) {
    lines.firstElementChild.remove()
    html = talk.outerHTML
  }
  return lines.children.length ? html : ''
}

/** Keep a bounded copy after the main conversation draws or changes. */
export let rememberChat = (
  box: HTMLElement,
  space: string,
  person: string,
  signal: AbortSignal,
) => {
  if (!globalThis.indexedDB) return () => {}
  let disk = vault(person), eid = address(space, person)
  let timer: ReturnType<typeof setTimeout> | undefined
  let previous: string | undefined
  let keep = async () => {
    timer = undefined
    let html = recent(box)
    if (previous === html) return
    await pageGraph([], person).ready
    if (html) {
      await disk.save(
        PAGE_EPOCH,
        [{ eid, comps: { operatorCopy: { html } } }],
        RETENTION_ROWS,
      )
    } else await disk.drop(PAGE_EPOCH, [eid])
    previous = html
  }
  let report = (error: unknown) => globalThis.reportError?.(error)
  signal.addEventListener('abort', () => {
    if (timer == null) return
    clearTimeout(timer)
    void keep().catch(report)
  }, { once: true })
  return () => {
    if (timer != null || signal.aborted) return
    timer = setTimeout(() => void keep().catch(report), 100)
  }
}
