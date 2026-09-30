/**
 * The editors, as the `/views` facet contributes them: `Inline.Edit`, a
 * value typed over where it stands, and `Edit`, a property's control by its
 * type (`.prop.type=enum`). A page with a registry of its own puts
 * `editorViews()` in it and names that registry's doors in its host
 * (`renderView`, `columnView`); a page without one draws them from `views`.
 *
 * @module
 */

export { editorViews, views } from './editors.ts'
