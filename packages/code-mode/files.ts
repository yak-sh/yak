// The script's two mounts. Workerd owns the request-local /tmp filesystem;
// the app mount sees its draft through the caller's recorded tool calls.
export const FILE_BYTES = 1024 * 1024

export type FileScope = { space?: string; app?: string; draft?: string }

export let fileDeclarations = `
declare const fs: {
  readFile(path: string): Promise<Uint8Array>
  readFile(path: string, encoding: 'utf8' | { encoding: 'utf8' }): Promise<string>
  writeFile(path: string, data: string | Uint8Array): Promise<void>
  readdir(path: string): Promise<string[]>
  unlink(path: string): Promise<void>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
}`

export let fileModule = `import * as tmp from 'node:fs/promises';
import { Buffer } from 'node:buffer';

function locate(path) {
  if (typeof path !== 'string' || path.includes('\\0') || path.includes('\\\\')) {
    throw new TypeError('fs takes an absolute /tmp or /apps/<app> path');
  }
  let parts = path.split('/');
  let [, mount, app, ...file] = parts;
  if (parts[0] || !['tmp', 'apps'].includes(mount) || parts.includes('..') ||
      (mount === 'apps' && !/^[a-z0-9][a-z0-9-]*$/.test(app ?? ''))) {
    throw new TypeError('fs takes an absolute /tmp or /apps/<app> path without ..');
  }
  return mount === 'tmp' ? null : {app, path: file.filter(p => p && p !== '.').join('/')};
}

export function filesystem(call) {
  async function appFile(at, op, args) {
    let result = await call(at.app, JSON.stringify({op, path: at.path || undefined, ...args}));
    if (result.isError) throw new Error(result.content.map(c => c.text).join('\\n'));
    return result.structuredContent;
  }
  function file(at, path) {
    if (!at.path) throw new Error('EISDIR: ' + path);
    return at;
  }
  return {
    async readFile(path, options) {
      let at = locate(path);
      if (!at) return tmp.readFile(path, options);
      let encoding = typeof options === 'string' ? options : options?.encoding;
      let result = await appFile(file(at, path), 'read', {encoding: 'base64'});
      let data = Buffer.from(result.base64, 'base64');
      return encoding == null ? data : data.toString(encoding);
    },
    async writeFile(path, data) {
      let at = locate(path);
      if (!at) return tmp.writeFile(path, data);
      if (typeof data !== 'string' && !ArrayBuffer.isView(data)) {
        throw new TypeError('fs.writeFile takes a string or bytes');
      }
      let bytes = Buffer.from(data);
      if (bytes.length > ${FILE_BYTES}) throw new Error('app files are limited to 1 MiB per fs write');
      await appFile(file(at, path), 'write', {base64: bytes.toString('base64')});
    },
    async readdir(path) {
      let at = locate(path);
      if (!at) return tmp.readdir(path);
      let {files} = await appFile(at, 'list', {path: undefined});
      let prefix = at.path ? at.path + '/' : '';
      let entries = files.filter(f => f.path.startsWith(prefix))
        .map(f => f.path.slice(prefix.length).split('/')[0]);
      if (at.path && !entries.length) {
        let code = files.some(f => f.path === at.path) ? 'ENOTDIR' : 'ENOENT';
        throw new Error(code + ': ' + path);
      }
      return [...new Set(entries)].sort();
    },
    async unlink(path) {
      let at = locate(path);
      if (!at) return tmp.unlink(path);
      await appFile(file(at, path), 'delete');
    },
    async mkdir(path, options) {
      if (locate(path)) throw new Error('app directories are created by writing a file in them');
      return tmp.mkdir(path, options);
    },
  };
}`
