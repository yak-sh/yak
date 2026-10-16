// Raycast's native React extension lint rules.
const { defineConfig } = require('eslint/config')
const raycastConfig = require('@raycast/eslint-config')
module.exports = defineConfig([...raycastConfig])
