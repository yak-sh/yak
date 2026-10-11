// The cold source scanner's TS/TSX fallback. The compiler arrives only when
// the fast module lexer cannot read a source; a memo hit imports neither.
import ts from 'typescript'

/** Runtime import dependencies, including literal dynamic imports. A source's
 * name selects its syntax: JSX in .tsx/.jsx, type assertions in .ts/.mts.
 * Callers can exclude function-valued callbacks omitted from their derivation;
 * only dynamic imports inside those callbacks are omitted. */
export let imports = (
  source: string,
  name = 'source.tsx',
  callbacks: readonly string[] = [],
): string[] => {
  let file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest)
  let found: string[] = []
  let ignored = new Set(callbacks)
  let callback = (node: ts.Node): boolean => {
    if (!ignored.size) return false
    if (
      !ts.isMethodDeclaration(node) && !ts.isPropertyAssignment(node) &&
      !ts.isPropertyDeclaration(node)
    ) return false
    let key: ts.Node = node.name
    if (ts.isComputedPropertyName(key)) {
      if (!ts.isStringLiteralLike(key.expression)) return false
      key = key.expression
    }
    if (
      !ts.isIdentifier(key) && !ts.isStringLiteralLike(key) ||
      !ignored.has(key.text)
    ) return false
    if (ts.isMethodDeclaration(node)) return true
    let value = node.initializer
    while (
      value &&
      (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) ||
        ts.isTypeAssertionExpression(value) ||
        ts.isSatisfiesExpression(value) ||
        ts.isNonNullExpression(value))
    ) value = value.expression
    return !!value &&
      (ts.isArrowFunction(value) || ts.isFunctionExpression(value))
  }
  let add = (value: ts.Node | undefined) => {
    if (value && ts.isStringLiteralLike(value)) found.push(value.text)
  }
  let visit = (node: ts.Node, excluded = false) => {
    excluded ||= callback(node)
    if (ts.isImportDeclaration(node)) {
      let clause = node.importClause
      let named = clause?.namedBindings
      if (
        !clause?.isTypeOnly &&
        (!named || !ts.isNamedImports(named) || clause?.name ||
          !named.elements.length || named.elements.some((m) => !m.isTypeOnly))
      ) add(node.moduleSpecifier)
    } else if (ts.isExportDeclaration(node)) {
      let named = node.exportClause
      if (
        !node.isTypeOnly &&
        (!named || !ts.isNamedExports(named) || !named.elements.length ||
          named.elements.some((m) => !m.isTypeOnly))
      ) add(node.moduleSpecifier)
    } else if (
      ts.isImportEqualsDeclaration(node) && !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression)
    } else if (
      !excluded && ts.isCallExpression(node) &&
      node.expression.kind == ts.SyntaxKind.ImportKeyword
    ) add(node.arguments[0])
    ts.forEachChild(node, (child) => visit(child, excluded))
  }
  visit(file)
  return found
}
