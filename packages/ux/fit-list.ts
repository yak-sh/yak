type Browser = Pick<typeof globalThis, 'getComputedStyle' | 'ResizeObserver'>

let bottom = (view: HTMLElement, win: Browser) =>
  view.getBoundingClientRect().top + view.clientTop + view.clientHeight -
  parseFloat(win.getComputedStyle(view).paddingBottom)

/** Keep whole rows in view, leaving room for the disclosure and everything
 * after the list. Without the browser enhancement, every row is shown. */
export let fitList = (list: HTMLElement, win: Browser): () => void => {
  let view = list.closest<HTMLElement>('[data-fit-scroll]')!
  let more = list.querySelector<HTMLButtonElement>('[data-fit-more]')!
  let label = more.querySelector<HTMLElement>('[data-fit-label]')!
  // Read each time: rows come and go as what the list shows changes.
  let rows = () =>
    [...list.children].filter((row) => row !== more) as HTMLElement[]

  let expand = (open: boolean) => {
    more.setAttribute('aria-expanded', String(open))
    label.textContent = more.title = open ? 'Less' : 'More'
  }
  let fit = () => {
    let all = rows()
    if (!view.clientHeight || !all.length) return
    for (let row of all) row.hidden = false
    more.hidden = false

    let end = view.lastElementChild!.getBoundingClientRect().bottom
    let overflow = end + view.scrollTop - bottom(view, win)
    let last = all.at(-1)!.getBoundingClientRect().bottom
    let reserve = more.getBoundingClientRect().bottom - last
    if (overflow <= reserve) {
      more.hidden = true
      expand(false)
    } else if (more.getAttribute('aria-expanded') != 'true') {
      let cropped = all.filter((row) =>
        row.getBoundingClientRect().bottom > last - overflow
      )
      for (let row of cropped) row.hidden = true
    }
  }
  let toggle = () => {
    let first = rows().find((row) => row.hidden)
    expand(!!first)
    fit()
    first?.focus()
  }
  let size = new win.ResizeObserver(fit)
  size.observe(view)
  size.observe(list)
  more.addEventListener('click', toggle)
  fit()
  return () => {
    size.disconnect()
    more.removeEventListener('click', toggle)
  }
}

if (typeof document != 'undefined') {
  let stop: (() => void) | undefined
  let bind = () => {
    stop?.()
    let list = document.querySelector<HTMLElement>('[data-fit-list]')
    stop = list ? fitList(list, globalThis) : undefined
  }
  bind()
  document.addEventListener('yak-page', bind)
}
