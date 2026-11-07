/**
 * The native look of the kit parts a first app wears, keyed by the classes
 * they render (`Card`, `Card_Head`, `Button-go`), and the tags' defaults
 * beneath them. Each part's entry belongs beside its terminal `sheet` in
 * @yaks/ui, where it will move (T-148415); until then they are here, one
 * table a host reads through `paint`.
 *
 * @module
 */

import type { Colors } from '@yaks/ui'
import type { Look } from './mod.ts'

export type { Colors }

/** The native look over a theme's colors. */
export let look = (c: Colors): Look => ({
  tags: {
    root: { flex: 1, backgroundColor: c.bg },
    main: { padding: 16, gap: 16 },
    h1: { fontSize: 28, fontWeight: '700', color: c.heading },
    h2: { fontSize: 20, fontWeight: '600', color: c.heading },
    h3: { fontSize: 17, fontWeight: '600', color: c.heading },
    p: { fontSize: 16, color: c.text },
    span: { color: c.text },
    label: { fontSize: 16, color: c.text },
    ul: { gap: 4 },
    li: { fontSize: 16, color: c.text },
    form: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    button: {
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 10,
      color: c.accent,
      fontSize: 16,
      fontWeight: '600',
    },
    input: {
      flex: 1,
      fontSize: 16,
      color: c.text,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
  },
  classes: {
    Card: {
      backgroundColor: c.card,
      borderRadius: 14,
      padding: 16,
      gap: 12,
    },
    Card_Head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    Card_Title: { fontSize: 20, fontWeight: '600', color: c.heading },
    Card_Sub: { fontSize: 14, color: c.muted },
    Card_Actions: { flexDirection: 'row', gap: 8 },
    Button: { color: c.accent },
    'Button-go': { backgroundColor: c.accent, color: c.bg },
    'Button-danger': { color: c.negative },
    'Button-quiet': { color: c.muted, paddingHorizontal: 6 },
    Check: { fontSize: 17, color: c.text, paddingVertical: 6 },
    Empty: {
      borderColor: c.border2,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderRadius: 14,
      padding: 16,
      gap: 6,
      color: c.muted,
    },
    Field: { color: c.text },
    Notice: { color: c.muted, fontSize: 14 },
  },
})
