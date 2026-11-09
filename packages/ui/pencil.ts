/** Pencil, yaks.app's skin: pencil on paper. Its document is its own
 * (pencil/base.css: the pencil's tokens and yaks.app's defaults, with the
 * grain paper/grain.css shares, re-pointed at yaks.app's tile), and each part
 * it names is drawn in graphite through pencil.svg: a line around what is
 * worth outlining, a hatch under what can be pressed, a well for what is
 * typed into. Every part it does not name keeps the kit's rendering. */
import type { Skin } from './theme.ts'

let at = (path: string) => new URL(path, import.meta.url)

export let pencil: Skin = {
  base: { css: at('./pencil/base.css'), over: at('./paper/grain.css') },
  Tabs: { css: at('./pencil/Tabs.css') },
  SideNav: { css: at('./pencil/SideNav.css') },
  Body: { over: at('./pencil/Body.css') },
  Field: { css: at('./pencil/Field.css') },
  At: { css: at('./pencil/At.css') },
  Check: { css: at('./pencil/Check.css') },
  Form: { css: at('./pencil/Form.css') },
  Drop: { css: at('./pencil/Drop.css') },
  Menu: { over: at('./pencil/Menu.css') },
  More: { css: at('./pencil/More.css') },
  Button: { css: at('./pencil/Button.css') },
  Chip: { css: at('./pencil/Chip.css') },
  Chips: { css: at('./pencil/Chips.css') },
  Address: { over: at('./pencil/Address.css') },
  Copy: { css: at('./pencil/Copy.css') },
  Card: { css: at('./pencil/Card.css') },
  Report: { over: at('./pencil/Report.css') },
  Group: { over: at('./pencil/Group.css') },
  Empty: { css: at('./pencil/Empty.css') },
  Rows: { over: at('./pencil/Rows.css') },
  State: { over: at('./pencil/State.css') },
  Chart: { over: at('./pencil/Chart.css') },
  Loading: { css: at('./pencil/Loading.css') },
}
