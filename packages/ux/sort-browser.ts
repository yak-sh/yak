/** Sort behavior for server-rendered Sort tables, controlled by page bundles.
 * @module
 */
import type { Bundle } from '@yaks/graph'
import { sorted, sortOf, sortRows, type SortValue } from './Sort.ts'
export { Sort, sortAt, sorted, sortOf, sortRows } from './Sort.ts'
export type { SortProps, SortRow, SortState, SortValue } from './Sort.ts'

/** The host keeps choices in its page graph and returns them on each press. */
export type SortHost = {
  read: (eid: string) => Bundle | undefined
  write: (bundle: Bundle) => unknown | Promise<unknown>
}
/** Bind all Sort tables under a surface; returns listener cleanup. */
export let bindSort = (root: ParentNode, host: SortHost): () => void => {
  let cleanup = [...root.querySelectorAll<HTMLElement>('[data-sort]')].map(
    (table) => {
      let eid = table.dataset.sort!
      let groups = [
        ...table.querySelectorAll<HTMLElement>('[data-sort-values]'),
      ]
      let values = new Map(
        groups.map((
          g,
        ) => [g, JSON.parse(g.dataset.sortValues!) as SortValue[]]),
      )
      let buttons = [
        ...table.querySelectorAll<HTMLButtonElement>('[data-sort-column]'),
      ]
      let draw = () => {
        let state = sortOf(host.read(eid))
        for (let group of sortRows(groups, (g) => values.get(g)!, state)) {
          table.appendChild(group)
        }
        for (let button of buttons) {
          let heading = button.parentElement!
          let dir = state?.column == Number(button.dataset.sortColumn) &&
            state.direction
          heading.setAttribute(
            'aria-sort',
            dir ? dir == 'asc' ? 'ascending' : 'descending' : 'none',
          )
          heading.classList.toggle('Table_Heading-asc', dir == 'asc')
          heading.classList.toggle('Table_Heading-desc', dir == 'desc')
          heading.querySelector('.Table_Direction')!.textContent = dir == 'asc'
            ? ' ↑'
            : dir == 'desc'
            ? ' ↓'
            : ''
        }
      }
      let handlers = buttons.map((button) => {
        let press = async () => {
          await host.write(
            sorted(
              host.read(eid) ?? { entity: { eid } },
              Number(button.dataset.sortColumn),
            ),
          )
          draw()
        }
        button.addEventListener('click', press)
        return () => button.removeEventListener('click', press)
      })
      draw()
      return () => handlers.forEach((off) => off())
    },
  )
  return () => cleanup.forEach((off) => off())
}
