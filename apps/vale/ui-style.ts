/** Dress the new Preact surfaces only. Legacy siblings keep their styles until
 * their own port; the CSS is shared with the guide, never a panel-local skin. */
import { stylesheet } from '@yaks/ui'
import { composition } from './ui-kit.ts'

export let dressVale = async (doc: Document = document) => {
  let id = 'vale-kit-style'
  if (doc.getElementById(id)) return
  let style = doc.createElement('style')
  style.id = id
  // Document defaults in the base kit would repaint still-native siblings.
  // All Preact parts and Vale replacements remain the very same composition.
  let kits = Object.fromEntries(
    Object.entries(composition.kits).map((
      [name, kit],
    ) => [
      name,
      Object.fromEntries(
        Object.entries(kit).filter(([part]) => part != 'base'),
      ),
    ]),
  )
  style.textContent = await stylesheet({ ...composition, kits })
  doc.head.insertBefore(style, doc.head.querySelector('link[rel=stylesheet]'))
}
