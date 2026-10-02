/** Dress Preact surfaces and shared skin defaults with the guide's composition.
 * Vale's base skin has no document layout to repaint still-native siblings. */
import { stylesheet } from '@yaks/ui'
import { composition } from './ui-kit.ts'

export let dressVale = async (doc: Document = document) => {
  let id = 'vale-kit-style'
  if (doc.getElementById(id)) return
  let style = doc.createElement('style')
  style.id = id
  style.textContent = await stylesheet(composition)
  doc.head.insertBefore(style, doc.head.querySelector('link[rel=stylesheet]'))
}
