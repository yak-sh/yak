// Lists render their selected content on a document in this process.
import { equal, ok, test } from '@yaks/testing'
import { LISTS, lists } from './lists_fixture.ts'

let cases = await lists((document) =>
  LISTS.map(([name]) => {
    let root = document.querySelector<HTMLElement>(`[data-list="${name}"]`)!
    let split = root.querySelector('.Split')
    let rows = [...root.querySelectorAll('[aria-current]')]
    let selected = root.querySelector<HTMLElement>('[aria-current=true]')!
    let content = root.querySelector('.Split_Content, .Craft_Detail')!
    let detail = content.textContent!.trim()
    let title = selected.querySelector('.Tile_Title')?.textContent?.trim()
    if (!split) return { name, rows, selected, detail, title }
    let picked = () =>
      root.querySelector('.Split')!.classList.contains('Split-picked')
    let first = picked()
    root.querySelector<HTMLElement>('.Split_Back')!.click()
    let back = picked()
    root.querySelector<HTMLElement>('[aria-current=true]')!.dispatchEvent(
      new document.defaultView!.Event('click', { bubbles: true }),
    )
    return {
      name,
      rows,
      selected,
      detail,
      title,
      panes: [first, back, picked()],
      same: rows.every((row) => row.isConnected),
    }
  })
)

for (let c of cases) {
  test(`${c.name} renders its selected detail`, () => {
    ok(c.rows.length > 0)
    ok(c.selected)
    ok(c.detail.length > 0)
    if (c.panes) {
      equal(c.panes, [true, false, true])
      equal(c.same, true)
    } else {
      ok(c.title)
      ok(c.detail.includes(c.title))
    }
  })
}
