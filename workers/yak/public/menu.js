// The one listener behind a page's menus: a `<details data-menu>` whose open
// list lies over the page (pages.ts `chooser`). It closes the way a menu does:
// on a click outside it, when focus moves outside it, and on Escape, which
// gives focus back to its summary. Without this script the menu still opens
// and closes from its summary.
{
  let open = () => [...document.querySelectorAll('details[data-menu][open]')]
  let closeOutside = (e) => {
    for (let menu of open()) if (!menu.contains(e.target)) menu.open = false
  }
  addEventListener('click', closeOutside)
  addEventListener('focusin', closeOutside)
  addEventListener('keydown', (e) => {
    if (e.key != 'Escape') return
    let menu = e.target.closest?.('details[data-menu][open]') ?? open()[0]
    if (!menu) return
    menu.open = false
    menu.querySelector('summary').focus()
  })
}
