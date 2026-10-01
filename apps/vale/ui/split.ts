// A list and its selected thing. Only changed content is replaced, so picking
// leaves every list node and its scroll in place. Phones show one side at a time.
export let split = (host: HTMLElement) => {
  host.classList.add('Split_Host')
  host.closest('.Panel_Sheet')?.classList.add('Split_Sheet')
  host.innerHTML =
    `<div class=Split><section class=Split_List aria-label="Things"></section><section class=Split_Detail aria-label="Selected thing"><button class="Btn Btn-small Split_Back" type=button>Back to list</button><div class=Split_Content></div></section></div>`
  let root = host.querySelector<HTMLElement>('.Split')!
  let list = root.querySelector<HTMLElement>('.Split_List')!
  let detail = root.querySelector<HTMLElement>('.Split_Content')!
  let wasList = '', wasDetail = '', wasPick: string | null = null
  list.addEventListener('click', (event) => {
    let row = event.target instanceof host.ownerDocument.defaultView!.Element
      ? event.target.closest('[data-pick], [data-skill], [data-select]')
      : null
    if (row && list.contains(row)) root.classList.add('Split-picked')
  })
  root.querySelector('.Split_Back')!.addEventListener('click', () => {
    root.classList.remove('Split-picked')
  })
  return {
    list,
    detail,
    render: (rows: string, content: string, picked: string | null = null) => {
      // Older tile renderers include the highlight in their HTML; it is state,
      // not list content, and must never replace the list on selection.
      rows = rows.replace(/ (?:Pack_Tile-on|Board_Skill-on)/g, '')
      if (rows != wasList) {
        let top = list.scrollTop
        list.innerHTML = rows
        list.scrollTop = top
        wasList = rows
      }
      if (content != wasDetail) {
        detail.innerHTML = content
        wasDetail = content
      }
      for (
        let row of list.querySelectorAll<HTMLElement>(
          '[data-pick], [data-skill], [data-select]',
        )
      ) {
        let on = picked != null &&
          (row.dataset.pick ?? row.dataset.skill ?? row.dataset.select) ==
            picked
        row.classList.toggle('Split_Row-on', on)
        row.setAttribute('aria-pressed', String(on))
      }
      if (picked != wasPick) {
        root.classList.toggle('Split-picked', picked != null)
        wasPick = picked
      }
    },
  }
}
