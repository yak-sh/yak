// deno-lint-ignore-file no-explicit-any -- dynamically loaded npm build/runtime tooling
// Manual, Docker-free workerd integration probe; deliberately outside the test
// suite/budget. Run after installing workers/yak's dependencies:
// deno run -A workers/yak/sandbox-entry-probe.ts /path/to/workers/yak/node_modules
// Optional second argument: a production build directory with index.js + map.
// Only test seams: fake ctx.container on the REAL branded DO state, SDK
// observation subclass, and a non-network replacement for swapped(). Production
// facade/runtime sources are bundled unchanged. This does NOT prove container
// startup, exec, process/file RPC success, or remote Cloudflare behavior.
import { strict as assert } from 'node:assert'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const deps = resolve(Deno.args[0] || 'workers/yak/node_modules')
const esbuild = require(join(deps, 'esbuild'))
const { Miniflare, Log, LogLevel } = require(join(deps, 'miniflare'))
const here = dirname(fileURLToPath(import.meta.url))
const out = await Deno.makeTempDir({ prefix: 'sandbox-entry-probe-' })
const sdk = join(deps, '@cloudflare/sandbox/dist/index.js')
const records = `globalThis.__probe ??= new Map();`
const entry = `
import { Sandbox, ContainerProxy } from ${
  JSON.stringify(join(here, 'sandbox-entry.ts'))
};
export { Sandbox, ContainerProxy };
export default {async fetch(req, env, ctx) {
  const u = new URL(req.url);
  if (u.pathname === '/status') return Response.json({constructions: globalThis.__constructions || 0});
  if (u.pathname === '/proxy') return ctx.exports.ContainerProxy({props: {className:'Sandbox',containerId:'proxy-only',enableInternet:true,interceptAll:false}}).fetch('https://' + (u.searchParams.get('host') || env.APEX) + '/test');
  const box = env.SANDBOX.get(env.SANDBOX.idFromName('test'));
  if (u.pathname === '/sdk-fetch') return box.fetch('http://sandbox.invalid/');
  const method = u.pathname.slice(1);
  try {return Response.json({ok:true,result:await box[method](...JSON.parse(u.searchParams.get('args') || '[]'))});}
  catch(e) {return Response.json({ok:false,message:e.message}, {status:500});}
}};`
await esbuild.build({
  stdin: { contents: entry, resolveDir: here, sourcefile: 'probe-entry.ts' },
  outdir: out,
  outbase: here,
  bundle: true,
  format: 'esm',
  splitting: true,
  platform: 'neutral',
  target: 'es2022',
  external: ['cloudflare:*', 'node:*'],
  nodePaths: [deps],
  conditions: ['workerd', 'worker', 'browser'],
  keepNames: true,
  plugins: [{
    name: 'observation-only',
    setup(build: any) {
      build.onResolve(
        { filter: /^cloudflare:workers$/ },
        (a: any) =>
          a.importer === join(here, 'sandbox-entry.ts')
            ? { path: 'state', namespace: 'probe' }
            : undefined,
      )
      build.onResolve(
        { filter: /^@cloudflare\/sandbox$/ },
        (a: any) =>
          a.importer === join(here, 'sandbox-runtime.ts')
            ? { path: 'sdk', namespace: 'probe' }
            : undefined,
      )
      build.onResolve(
        { filter: /^\.\/sandbox\.ts$/ },
        (a: any) =>
          a.importer === join(here, 'sandbox-runtime.ts')
            ? { path: 'outbound', namespace: 'probe' }
            : undefined,
      )
      build.onLoad({ filter: /.*/, namespace: 'probe' }, (a: any) => ({
        loader: 'ts',
        resolveDir: here,
        contents: a.path === 'state'
          ? `import {DurableObject as Native, WorkerEntrypoint} from 'cloudflare:workers';
export {WorkerEntrypoint};
${records}
export class DurableObject extends Native {
  constructor(ctx, env) {
    super(ctx,env);
    const r = {ctx,events:[],real:null}; globalThis.__probe.set(ctx.id.toString(),r);
    Object.defineProperty(ctx,'container',{value:{running:false,start(){throw Error('FAKE_CONTAINER_START_REACHED')},async destroy(){r.events.push('container.destroy')},async interceptOutboundHttp(){},async interceptOutboundHttps(){}}});
    const native = ctx.blockConcurrencyWhile.bind(ctx); let n=0;
    ctx.blockConcurrencyWhile = fn => { const i=++n; r.events.push('gate'+i+':call'); return native(async()=>{const result=await fn();if(i>1)await new Promise(r=>setTimeout(r,10));r.events.push('gate'+i+':done');return result;}); };
  }
  async inspect(){const r=globalThis.__probe.get(this.ctx.id.toString());return {events:r.events,sameCtx:r.real.ctx===this.ctx,realName:r.real.constructor.name,sleepAfter:r.real.sleepAfter,keepAliveEnabled:r.real.keepAliveEnabled,httpsEnv:r.real.envVars.SANDBOX_INTERCEPT_HTTPS,interceptHttps:r.real.interceptHttps,allowedHostsOverride:r.real.allowedHostsOverride??null,alarm:await this.ctx.storage.getAlarm()};}
  async prime(){await this.ctx.storage.put('sleepAfter','17m');await this.ctx.storage.put('keepAliveEnabled',true);}
  async expireAlarm(){await this.ctx.storage.setAlarm(Date.now()-1);}
}`
          : a.path === 'sdk'
          ? `import {Sandbox as Real} from ${JSON.stringify(sdk)};
export * from ${JSON.stringify(sdk)};
export class Sandbox extends Real {
  constructor(ctx,env){super(ctx,env);globalThis.__constructions=(globalThis.__constructions||0)+1;globalThis.__probe.get(ctx.id.toString()).real=this;}
  async getState(...args){globalThis.__probe.get(this.ctx.id.toString()).events.push('getState:entered');return super.getState(...args);}
  async alarm(...args){globalThis.__probe.get(this.ctx.id.toString()).events.push('alarm:entered');return super.alarm(...args);}
}`
          : `export const swapped=(env,id,req)=>Response.json({containerId:id,host:new URL(req.url).hostname,apex:env.APEX,constructions:globalThis.__constructions||0});`,
      }))
    },
  }],
})
let mf: any
const make = () =>
  new Miniflare({
    name: 'actual-sandbox-facade',
    rootPath: out,
    modulesRoot: out,
    scriptPath: join(out, 'stdin.js'),
    modules: true,
    compatibilityDate: '2025-05-08',
    compatibilityFlags: [
      'nodejs_compat',
      'global_fetch_strictly_public',
      'enable_ctx_exports',
    ],
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    durableObjects: { SANDBOX: { className: 'Sandbox', useSQLite: true } },
    durableObjectsPersist: join(out, 'persist'),
    bindings: { APEX: 'platform.invalid' },
    log: new Log(LogLevel.ERROR),
  })
const results: unknown[] = []
const call = async (path: string) => {
  const response = await mf.dispatchFetch('http://probe.invalid' + path)
  const body = await response.json()
  results.push({ path, status: response.status, body })
  return body
}
try {
  mf = make()
  await mf.ready
  assert.deepEqual(await call('/status'), { constructions: 0 })
  for (const host of ['platform.invalid', 'x.platform.invalid']) {
    assert.deepEqual(await call('/proxy?host=' + host), {
      containerId: 'proxy-only',
      host,
      apex: 'platform.invalid',
      constructions: 0,
    })
  }
  const states = await Promise.all([call('/getState'), call('/getState')])
  assert(states.every((s) => s.ok))
  assert.deepEqual(await call('/status'), { constructions: 1 })
  let inspected = (await call('/inspect')).result
  assert(inspected.sameCtx)
  assert.equal(inspected.realName, 'Sandbox')
  assert.equal(inspected.interceptHttps, true)
  assert.equal(inspected.allowedHostsOverride, null)
  for (const gate of ['gate2:done', 'gate3:done']) {
    assert(inspected.events.includes(gate))
    assert(
      inspected.events.indexOf('getState:entered') >
        inspected.events.indexOf(gate),
    )
  }
  assert((await call('/setSleepAfter?args=' + encodeURIComponent('["9m"]'))).ok)
  assert.equal((await call('/inspect')).result.sleepAfter, '9m')
  assert((await call('/destroy')).ok)
  const fetched = await call('/sdk-fetch')
  assert.equal(fetched.context.error, 'FAKE_CONTAINER_START_REACHED')
  assert((await call('/expireAlarm')).ok)
  for (let n = 0; n < 50; n++) {
    await new Promise((r) => setTimeout(r, 20))
    inspected = (await call('/inspect')).result
    if (
      inspected.events.includes('alarm:entered') && inspected.alarm === null
    ) break
  }
  assert(inspected.events.includes('alarm:entered'))
  assert.equal(inspected.alarm, null)
  assert((await call('/prime')).ok)
  await mf.dispose()
  mf = make()
  await mf.ready
  assert((await call('/getState')).ok)
  inspected = (await call('/inspect')).result
  assert.equal(inspected.sleepAfter, '17m')
  assert.equal(inspected.keepAliveEnabled, true)
  assert.equal(inspected.httpsEnv, '1')
  await Deno.writeTextFile(
    join(out, 'result.json'),
    JSON.stringify({ pass: true, results }, null, 2),
  )
  console.log(JSON.stringify({ pass: true, result: join(out, 'result.json') }))
} finally {
  await mf?.dispose()
}

// An optional second phase observes the actual production bundle, without the
// facade test seams. Source-map-selected initializer markers live in a COPY.
// /docs/code is a static kernel page; repeating it is NOT a CF-cache HIT claim.
if (Deno.args[1]) {
  const built = resolve(Deno.args[1])
  const pageOut = join(out, 'page')
  const script = String.raw`
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [built,deps,out,assets]=process.argv.slice(1);
const acorn=require('internal/deps/acorn/acorn/dist/acorn');
const {TraceMap,originalPositionFor}=require(path.join(deps,'@jridgewell/trace-mapping'));
const {Miniflare,Log,LogLevel}=require(path.join(deps,'miniflare'));
const code=fs.readFileSync(path.join(built,'index.js'),'utf8');
const map=new TraceMap(JSON.parse(fs.readFileSync(path.join(built,'index.js.map'),'utf8')));
const ast=acorn.parse(code,{ecmaVersion:'latest',sourceType:'module',locations:true});
let edits=[],records=[];
for(const st of ast.body) if(st.type==='VariableDeclaration') for(const n of st.declarations){
 const call=n.init,fn=call?.arguments?.[0];
 if(call?.type!=='CallExpression'||!['ArrowFunctionExpression','FunctionExpression'].includes(fn?.type)||fn.body.type!=='BlockStatement')continue;
 const source=originalPositionFor(map,n.loc.start).source;
 if(!source||!/\/node_modules\/(?:@cloudflare\/(?:sandbox|containers)\/|capnweb\/)/.test(source))continue;
 const marker={name:n.id.name,source};records.push(marker);
 edits.push([fn.body.start+1,'globalThis.__sandboxMarkers.push('+JSON.stringify(marker)+');']);
}
assert(records.length,'No SDK initializers marked');
fs.mkdirSync(out,{recursive:true});
for(const f of fs.readdirSync(built))if(f.endsWith('.wasm'))fs.copyFileSync(path.join(built,f),path.join(out,f));
let changed=code;for(const [p,t]of edits.sort((a,b)=>b[0]-a[0]))changed=changed.slice(0,p)+t+changed.slice(p);
fs.writeFileSync(path.join(out,'index.js'),'globalThis.__sandboxMarkers=[];\n'+changed);
fs.writeFileSync(path.join(out,'wrapper.js'),
 'import kernel from "./index.js"; export default {async fetch(req,env,ctx){if(new URL(req.url).pathname==="/__markers")return Response.json(globalThis.__sandboxMarkers);return kernel.fetch(req,env,ctx)}}');
(async()=>{
 const mf=new Miniflare({name:'production-page',rootPath:out,modulesRoot:out,scriptPath:path.join(out,'wrapper.js'),modules:true,compatibilityDate:'2025-05-08',compatibilityFlags:['nodejs_compat','global_fetch_strictly_public','enable_ctx_exports'],modulesRules:[{type:'ESModule',include:['**/*.js'],fallthrough:true},{type:'CompiledWasm',include:['**/*.wasm'],fallthrough:true}],bindings:{APEX:'platform.invalid'},serviceBindings:{ASSETS:async req=>{const file=path.join(assets,new URL(req.url).pathname);return new Response(fs.readFileSync(file));}},log:new Log(LogLevel.ERROR)});
 try{
  await mf.ready;
  const markers=async()=>await(await mf.dispatchFetch('https://platform.invalid/__markers')).json();
  const startup=await markers();assert.deepEqual(startup,[]);
  const pages=[];
  for(let i=0;i<2;i++){
   const r=await mf.dispatchFetch('https://platform.invalid/docs/code');const text=await r.text();
   assert.equal(r.status,200,text.slice(0,500));assert(text.includes('<html'));
   const evaluated=await markers();assert.deepEqual(evaluated,[]);
   pages.push({status:r.status,bytes:Buffer.byteLength(text),evaluated});
  }
  const result={pass:true,built,markedInitializers:records.length,startup,pages,limitation:'Static docs page twice, not CF cache HIT/MISS or a graph-backed homepage; instrumented production bundle copy.'};
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await mf.dispose()}
})().catch(e=>{console.error(e);process.exitCode=1});`
  const run = await new Deno.Command('node', {
    args: [
      '--expose-internals',
      '-e',
      script,
      built,
      deps,
      pageOut,
      join(here, 'public'),
    ],
    stdout: 'inherit',
    stderr: 'inherit',
  }).output()
  assert.equal(run.code, 0, 'production page marker probe failed')
}
