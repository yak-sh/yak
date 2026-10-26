export let workspace = ({ tabs, panels, buttons, room }) => {
  let selected = 'mix'
  let update = () => {
    let focus = document.activeElement, onTab = tabs.contains(focus)
    tabs.hidden = room.matches
    for (let name of Object.keys(panels)) {
      panels[name].hidden = !room.matches && selected !== name
      buttons[name].setAttribute('aria-pressed', selected === name)
    }
    if (room.matches && onTab) {
      panels[selected].querySelector('button,input,select')?.focus()
    } else if (
      Object.values(panels).some((panel) =>
        panel.hidden && panel.contains(focus)
      )
    ) {
      buttons[selected].focus()
    }
  }
  for (let name of Object.keys(buttons)) {
    buttons[name].addEventListener('click', () => {
      selected = name
      update()
    })
  }
  room.addEventListener('change', update)
  update()
  return () => room.removeEventListener('change', update)
}
