// The one JSON Schema validator every server here hands the SDK. A schema is
// compiled the first time something is checked against it, and once per
// distinct schema in the process. A server is built per request with every
// schema made afresh, and Ajv keeps a compiled check per schema object, so
// compiling as each is handed over would compile them all again on every
// request and keep each copy for good. Most are never checked at all: the
// runner, not the SDK's registerTool wrapper, owns tool argument validation.

import { DefaultJsonSchemaValidator } from '@modelcontextprotocol/server/_shims'
import type {
  JsonSchemaType,
  JsonSchemaValidator,
  jsonSchemaValidator,
  JsonSchemaValidatorResult,
} from '@modelcontextprotocol/server'

let ajv: DefaultJsonSchemaValidator | undefined
let checks = new Map<string, JsonSchemaValidator<unknown>>()
let compiled = (schema: JsonSchemaType): JsonSchemaValidator<unknown> => {
  let text = JSON.stringify(schema)
  let check = checks.get(text)
  if (!check) {
    check = (ajv ??= new DefaultJsonSchemaValidator()).getValidator(schema)
    checks.set(text, check)
  }
  return check
}

export let validator: jsonSchemaValidator = {
  getValidator: <T>(schema: JsonSchemaType): JsonSchemaValidator<T> => {
    let check: JsonSchemaValidator<unknown> | undefined
    return (input) =>
      (check ??= compiled(schema))(input) as JsonSchemaValidatorResult<T>
  },
}
