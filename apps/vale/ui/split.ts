// A list and its selected thing. Only changed content is replaced, so picking
// leaves every list node and its scroll in place; each row paints its own
// pick (packages/ui/Tile.ts). Phones show one side at a time: a pick in the
// list shows its detail, and Back shows the list again.
import { type ComponentChildren, render } from 'preact'

export let split = (host: HTMLElement) => {
  host.classList.add('Split_Host')
  host.closest('.Panel_Sheet')?.classList.add('Split_Sheet')
  host.innerHTML =
    `<div class=Split><section class=Split_List aria-label="Things"></section><section class=Split_Detail aria-label="Selected thing"><button class="Button Split_Back" type=button>Back to list</button><div class=Split_Content></div></section></div>`
  let root = host.querySelector<HTMLElement>('.Split')!
  let list = root.querySelector<HTMLElement>('.Split_List')!
  let detail = root.querySelector<HTMLElement>('.Split_Content')!
  let wasList: ComponentChildren = '',
    wasDetail: ComponentChildren = '',
    wasPick: string | null = null
  // Markup and Preact each clear what the other drew there before drawing.
  let paint = (
    node: HTMLElement,
    content: ComponentChildren,
    was: ComponentChildren,
  ) => {
    if (typeof content == 'string') {
      render(null, node)
      node.innerHTML = content
    } else {
      if (typeof was == 'string') node.textContent = ''
      render(content, node)
    }
  }
  list.addEventListener('click', (event) => {
    let row = event.target instanceof host.ownerDocument.defaultView!.Element
      ? event.target.closest('[aria-current]')
      : null
    if (row && list.contains(row)) root.classList.add('Split-picked')
  })
  root.querySelector('.Split_Back')!.addEventListener('click', () => {
    root.classList.remove('Split-picked')
  })
  return {
    list,
    detail,
    render: (
      rows: ComponentChildren,
      content: ComponentChildren,
      picked: string | null = null,
    ) => {
      if (rows != wasList) {
        let top = list.scrollTop
        paint(list, rows, wasList)
        list.scrollTop = top
        wasList = rows
      }
      if (content != wasDetail) {
        paint(detail, content, wasDetail)
        wasDetail = content
      }
      if (picked != wasPick) {
        root.classList.toggle('Split-picked', picked != null)
        wasPick = picked
      }
    },
  }
}
