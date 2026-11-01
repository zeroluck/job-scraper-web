import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
process.env.JOB_DATA_API_URL = 'https://data.invalid';
process.env.JOB_DATA_API_TOKEN = 'inert-data-token';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://storage.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'inert-storage-key';
function load(relative, overrides = {}) {
  const filename = path.join(root, relative);
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  const localRequire = (id) => {
    if (id === 'server-only') return {};
    if (Object.hasOwn(overrides, id)) return overrides[id];
    if (id === 'next/headers') return { cookies: async () => ({ getAll: () => [], set() {} }) };
    if (id.startsWith('./') || id.startsWith('../') || id.startsWith('@/')) {
      const target = id.startsWith('@/') ? path.join(root, 'src', id.slice(2)) : path.resolve(path.dirname(filename), id);
      return load(path.relative(root, target.endsWith('.ts') ? target : `${target}.ts`), overrides);
    }
    return require(id);
  };
  new Function('require', 'module', 'exports', compiled)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}
async function requests(run) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push({ url: request.url, authorization: request.headers.get('authorization'), apikey: request.headers.get('apikey') });
    return new Response(JSON.stringify(request.url.includes('/storage/v1/') ? { signedURL: '/object/sign/resumes/test.pdf?token=inert' } : []), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try { await run(); return calls; } finally { globalThis.fetch = original; }
}
test('server SDK table and RPC requests use the new data origin/token', async () => {
  const calls = await requests(async () => {
    const client = await load('src/utils/supabase/server.ts').createSupabaseServerClient();
    await client.from('jobs').select('id');
    await client.rpc('get_jobs');
  });
  assert.deepEqual(calls.map(x => new URL(x.url).pathname), ['/rest/v1/jobs', '/rest/v1/rpc/get_jobs']);
  for (const call of calls) {
    assert.equal(new URL(call.url).origin, 'https://data.invalid');
    assert.equal(call.authorization, 'Bearer inert-data-token');
    assert.equal(call.apikey, 'inert-data-token');
  }
});
test('cached/service SDK reads use data without request cookies', async () => {
  const calls = await requests(async () => {
    const client = load('src/utils/supabase/service.ts', { 'next/headers': { cookies() { throw Error('unexpected cookies'); } } }).createSupabaseServiceClient();
    await client.from('jobs').select('id');
  });
  assert.equal(new URL(calls[0].url).origin, 'https://data.invalid');
  assert.equal(calls[0].authorization, 'Bearer inert-data-token');
});
test('server factory retains original request cookie reads/writes and read-only catch', async () => {
  const writes = []; let reads = 0; let options;
  const cookie = { name: 'existing', value: 'session' };
  const loaded = load('src/utils/supabase/server.ts', {
    '@supabase/ssr': { createServerClient(_url, _key, opts) { options = opts; return {}; } },
    'next/headers': { cookies: async () => { reads++; return { getAll: () => [cookie], set: (...args) => { writes.push(args); if (writes.length > 1) throw Error('read-only'); } }; } },
  });
  await loaded.createSupabaseServerClient();
  assert.equal(reads, 1);
  assert.deepEqual(options.cookies.getAll(), [cookie]);
  options.cookies.setAll([{ name: 'new', value: 'value', options: { httpOnly: true } }]);
  assert.deepEqual(writes[0], ['new', 'value', { httpOnly: true }]);
  assert.doesNotThrow(() => options.cookies.setAll([{ name: 'new', value: 'again' }]));
});
test('retained Storage SDK signing and uploads use original endpoint and cookies', async () => {
  let cookieReads = 0;
  const calls = await requests(async () => {
    const client = await load('src/utils/supabase/storage.ts', { 'next/headers': { cookies: async () => { cookieReads++; return { getAll: () => [], set() {} }; } } }).createSupabaseStorageClient();
    await client.storage.from('resumes').createSignedUrl('test.pdf', 60);
    await client.storage.from('resumes').upload('test.pdf', new Blob(['inert']));
  });
  assert.equal(cookieReads, 1);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(new URL(call.url).origin, 'https://storage.invalid');
    assert.ok(new URL(call.url).pathname.startsWith('/storage/v1/'));
    assert.equal(call.authorization, 'Bearer inert-storage-key');
  }
});
test('database factories fail closed without either data variable despite retained Storage credentials', async () => {
  for (const key of ['JOB_DATA_API_URL', 'JOB_DATA_API_TOKEN']) {
    const previous = process.env[key];
    delete process.env[key];
    try {
      await assert.rejects(load('src/utils/supabase/server.ts').createSupabaseServerClient(), /Missing JOB_DATA_API_URL or JOB_DATA_API_TOKEN/);
      assert.throws(() => load('src/utils/supabase/service.ts').createSupabaseServiceClient(), /Missing JOB_DATA_API_URL or JOB_DATA_API_TOKEN/);
    } finally { process.env[key] = previous; }
  }
});
test('both object-operation callsites select retained Storage factory', () => {
  const signing = fs.readFileSync(path.join(root, 'src/lib/supabase/storage.ts'), 'utf8');
  const queries = fs.readFileSync(path.join(root, 'src/lib/supabase/queries.ts'), 'utf8');
  assert.match(signing, /await createSupabaseStorageClient\(\)/);
  const upload = queries.slice(queries.indexOf('export async function uploadPersonalizedResume('));
  assert.match(upload, /await createSupabaseStorageClient\(\)/);
});
