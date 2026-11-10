/** Pencil, yaks.app's skin. Its Surface entry sets the shared paint: drawn
 * edges, hatched elevation and inset wells. Those tokens reach every kit,
 * including parts this skin does not name. Entries below supply layout and
 * component-specific details. */
import type { Skin } from './theme.ts'

let at = (path: string) => new URL(path, import.meta.url)

export let pencil: Skin = {
  Surface: { over: at('./pencil/Surface.css') },
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
  More: { over: at('./pencil/More.css') },
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
