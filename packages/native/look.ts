/**
 * The native look a host reads through `paint`: the tags' defaults, and the
 * style of each class the kit parts render (`Card`, `Card_Head`,
 * `Button-go`), which each part carries beside its terminal `sheet` in
 * @yaks/ui (`native`).
 *
 * @module
 */

import { type Colors, type Composition, composition, native } from '@yaks/ui'
import type { Look } from './mod.ts'

export type { Colors }

/** The native look over a theme's colours, of the parts in `at`'s kits as
 * its skin wears them, @yaks/ui's own composition by default. A
 * white-labelled app themes it with data: its colours, and the composition
 * it wears. */
export let look = (c: Colors, at: Composition = composition): Look => ({
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
    a: { color: c.link },
    b: { fontWeight: '700' },
    strong: { fontWeight: '700' },
    em: { fontStyle: 'italic' },
    code: { fontFamily: 'Menlo', fontSize: 14, color: c.literal },
    pre: { fontFamily: 'Menlo', fontSize: 13, color: c.text },
    details: { gap: 6 },
    summary: { fontSize: 15, color: c.muted },
    dl: { gap: 4 },
    dt: { fontSize: 13, color: c.dim },
    dd: { fontSize: 15, color: c.text, paddingLeft: 8 },
    time: { fontSize: 12, color: c.dim },
    form: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    button: {
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 10,
      color: c.accent,
      fontSize: 16,
      fontWeight: '600',
    },
    img: { width: 64, height: 64, borderRadius: 8 },
    hr: { height: 1, backgroundColor: c.border, marginVertical: 8 },
    table: { gap: 2 },
    tr: { flexDirection: 'row', gap: 12 },
    th: { flex: 1, fontSize: 13, fontWeight: '600', color: c.dim },
    td: { flex: 1, fontSize: 15, color: c.text },
    select: {
      fontSize: 16,
      color: c.text,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
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
  classes: native({ ...at, theme: { ...at.theme, colors: c } }),
})
