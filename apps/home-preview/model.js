// The demo reads the published recipe vocabulary without inventing recipe
// content. Ingredient lines stay verbatim: units are not guessed or merged.
export const categories = (
  rows,
) => [...new Set(rows.map((r) => r.recipe.category || 'Unsorted'))]
export const ingredients = (rows, selected) =>
  rows.filter((r) => selected.has(r.entity.eid)).map((r) => ({
    title: r.doc.title,
    lines: (r.recipe.ingredients || '').split('\n').filter((s) => s.trim()),
  }))
export const escapeHTML = (text) =>
  String(text ?? '').replace(
    /[&<>"']/g,
    (
      c,
    ) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]),
  )
