// The layers a page opens over itself by its address (`#menu`, `#app`,
// `#needs`, each shown by `:target` in pages.css), opened and closed without
// a history entry: a link marked `data-pane` replaces the address's fragment
// instead of following it, so Back leaves the page as in any chat app and
// never opens a layer. Coming back to a page whose address still names a
// layer (Back from a page the menu led to), the layer is taken off. Without
// this script the links work as links.
{
  let layers = () =>
    new Set(
      [...document.querySelectorAll('a[data-pane]')]
        .map((a) => new URL(a.href, location.href).hash)
        .filter(Boolean),
    )
  addEventListener('click', (e) => {
    let link = e.target.closest?.('a[data-pane]')
    if (
      !link || e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey ||
      e.shiftKey || e.altKey
    ) return
    e.preventDefault()
    location.replace(new URL(link.href, location.href).hash || '#')
  })
  addEventListener('pageshow', (e) => {
    let back = e.persisted ||
      performance.getEntriesByType?.('navigation')[0]?.type == 'back_forward'
    if (back && layers().has(location.hash)) location.replace('#')
  })
}
