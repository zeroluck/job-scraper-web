import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runServer(code: string, env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [
    "--conditions=react-server", "--experimental-strip-types", "--input-type=module", "-e", `
      import { registerHooks } from 'node:module';
      registerHooks({resolve(specifier, context, nextResolve) {
        if (specifier.startsWith('@/')) return nextResolve(new URL('./src/' + specifier.slice(2) + '.ts', import.meta.url).href, context);
        if (context.parentURL?.startsWith(new URL('./src/', import.meta.url).href) && specifier.startsWith('./') && !specifier.split('/').at(-1).includes('.')) return nextResolve(specifier + '.ts', context);
        return nextResolve(specifier, context);
      }});
      ${code}
    `,
  ], {
    cwd: process.cwd(), encoding: "utf8",
    env: { ...process.env, JOB_DATA_API_URL: "https://data.example.test", JOB_DATA_API_TOKEN: "test-data-token", JOB_DATA_API_CONNECT_IP: "", ...env },
  });
  assert.equal(result.status, 0, result.stderr);
}

test("data client fails closed without either server-only setting, never falls back to source", () => {
  const code = `
    import assert from 'node:assert/strict';
    import { createJobDataClient } from './src/utils/supabase/data.ts';
    assert.throws(() => createJobDataClient(), /Missing JOB_DATA_API_URL or JOB_DATA_API_TOKEN/);
  `;
  const source = { NEXT_PUBLIC_SUPABASE_URL: 'https://legacy.example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-storage-token' };
  runServer(code, { ...source, JOB_DATA_API_URL: '' });
  runServer(code, { ...source, JOB_DATA_API_TOKEN: '' });
});

test("connection override rejects nonnumeric IPs and non-HTTPS endpoints without exposing values", () => {
  runServer(`
    import assert from 'node:assert/strict';
    import { createJobDataClient } from './src/utils/supabase/data.ts';
    for (const ip of ['example.test', '127.1', '2130706433', '0x7f000001', '127.0.0.1:443', '[::1]', ' 127.0.0.1', '127.0.0.1 ', '::1%lo0', 'secret-value']) {
      process.env.JOB_DATA_API_CONNECT_IP = ip;
      assert.throws(() => createJobDataClient(), {message: 'Invalid JOB_DATA_API_CONNECT_IP: expected a numeric IPv4 or IPv6 address'});
    }
    process.env.JOB_DATA_API_CONNECT_IP = '127.0.0.1';
    process.env.JOB_DATA_API_URL = 'http://localhost:54321';
    assert.throws(() => createJobDataClient(), {message: 'JOB_DATA_API_CONNECT_IP requires an HTTPS JOB_DATA_API_URL'});
    for (const base of ['https://127.0.0.1', 'https://[::1]']) {
      process.env.JOB_DATA_API_URL = base;
      assert.throws(() => createJobDataClient(), {message: 'JOB_DATA_API_CONNECT_IP requires a DNS hostname in JOB_DATA_API_URL'});
    }
  `);
});

test("connection override reaches loopback TLS with original Host/SNI and trusted localhost certificate", () => {
  const dir = mkdtempSync(join(tmpdir(), 'job-data-tls-'));
  try {
    const key = join(dir, 'key.pem');
    const cert = join(dir, 'cert.pem');
    const config = join(dir, 'openssl.cnf');
    writeFileSync(config, '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost\nbasicConstraints=critical,CA:TRUE\n');
    const generated = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', key, '-out', cert, '-config', config], {encoding: 'utf8'});
    assert.equal(generated.status, 0, 'loopback certificate generation failed');
    const tlsCode = `
      import assert from 'node:assert/strict';
      import https from 'node:https';
      import dns from 'node:dns';
      import { readFileSync } from 'node:fs';
      import { once } from 'node:events';
      import { createJobDataClient } from './src/utils/supabase/data.ts';
      const originalLookup = dns.lookup;
      const originalFetch = globalThis.fetch;
      const requests = [];
      const server = https.createServer({key: readFileSync(process.env.TEST_TLS_KEY), cert: readFileSync(process.env.TEST_TLS_CERT)}, (req, res) => {
        requests.push({host: req.headers.host, sni: req.socket.servername, url: req.url});
        res.setHeader('Content-Type', 'application/json');
        if (req.url.startsWith('/rest/v1/redirect_test')) {
          res.writeHead(302, {Location: 'https://other.invalid/storage/v1/object'});
        }
        res.end('[]');
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      server.unref();
      const port = server.address().port;
      try {
        process.env.JOB_DATA_API_URL = 'https://' + (process.env.TEST_TLS_HOST || 'localhost') + ':' + port;
        const result = await createJobDataClient().from('jobs').select('job_id').retry(false).abortSignal(AbortSignal.timeout(3000));
        if (process.env.TEST_TLS_FAILURE) {
          assert.notEqual(result.error, null);
          assert.ok(result.error.details.includes(process.env.TEST_TLS_FAILURE), result.error.details);
          assert.equal(requests.length, 0, 'TLS failure must occur before an HTTP request');
        } else {
        assert.equal(result.error, null, JSON.stringify(result.error));
        assert.deepEqual(requests, [{host: 'localhost:' + port, sni: 'localhost', url: '/rest/v1/jobs?select=job_id'}]);
        process.env.JOB_DATA_API_CONNECT_IP = '::1';
        const wrongAddress = await createJobDataClient().from('jobs').select('job_id').retry(false).abortSignal(AbortSignal.timeout(3000));
        assert.notEqual(wrongAddress.error, null, 'override must actually select the connection address');
        assert.equal(requests.length, 1);
        process.env.JOB_DATA_API_CONNECT_IP = '127.0.0.1';
        const redirected = await createJobDataClient().from('redirect_test').select().retry(false);
        assert.notEqual(redirected.error, null);
        assert.match(redirected.error.details, /unexpected redirect/);
        assert.equal(requests.length, 2);
        assert.equal(dns.lookup, originalLookup);
        assert.equal(globalThis.fetch, originalFetch);
        const { getSignedUrl } = await import('./src/lib/supabase/storage.ts');
        let storageCalls = 0;
        globalThis.fetch = async (url) => {
          assert.equal(new URL(String(url)).origin, 'https://legacy.example.test');
          storageCalls++;
          return new Response(JSON.stringify({signedURL: '/object/sign/personalized_resumes/test.pdf?token=fake'}), {headers: {'Content-Type': 'application/json'}});
        };
        try {
          assert.equal(await getSignedUrl('test.pdf'), 'https://legacy.example.test/storage/v1/object/sign/personalized_resumes/test.pdf?token=fake');
          assert.equal(storageCalls, 1, 'Storage must retain its ordinary fetch even with the data override active');
        } finally { globalThis.fetch = originalFetch; }
        }
      } finally { server.closeAllConnections(); server.close(); }
    `;
    const env = {JOB_DATA_API_CONNECT_IP: '127.0.0.1', NODE_EXTRA_CA_CERTS: cert, TEST_TLS_KEY: key, TEST_TLS_CERT: cert, NEXT_PUBLIC_SUPABASE_URL: 'https://legacy.example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-storage-token'};
    runServer(tlsCode, env);
    runServer(tlsCode, {...env, NODE_EXTRA_CA_CERTS: '', TEST_TLS_FAILURE: 'self-signed certificate'});
    runServer(tlsCode, {...env, TEST_TLS_HOST: 'mismatch.invalid', TEST_TLS_FAILURE: 'Hostname/IP does not match'});
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test("database module cannot load outside the server-only condition", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", "await import('./src/utils/supabase/data.ts')"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot be imported from a Client Component/);
});

test("data client normalizes HTTP(S) origins and explicit /rest/v1 endpoints", () => {
  runServer(`
    import assert from 'node:assert/strict';
    import { createJobDataClient } from './src/utils/supabase/data.ts';
    const requests = [];
    globalThis.fetch = async (url) => {
      requests.push(String(url));
      return new Response('[]', {headers: {'Content-Type': 'application/json'}});
    };
    for (const base of ['https://data.example.test', 'https://data.example.test/', 'https://data.example.test/rest/v1', 'https://data.example.test/rest/v1/', 'http://localhost:54321']) {
      process.env.JOB_DATA_API_URL = base;
      await createJobDataClient().from('jobs').select('job_id');
      assert.equal(requests.at(-1), new URL(base).origin + '/rest/v1/jobs?select=job_id');
    }
  `);
});

test("data client rejects unsafe URLs and unsupported paths without echoing configuration", () => {
  runServer(`
    import assert from 'node:assert/strict';
    import { createJobDataClient } from './src/utils/supabase/data.ts';
    for (const base of [
      'ftp://data.example.test', '/rest/v1', 'not-a-url',
      'https://user:secret@data.example.test', 'https://user@data.example.test', 'https://@data.example.test',
      'https://data.example.test?secret=value', 'https://data.example.test?',
      'https://data.example.test#secret', 'https://data.example.test#',
      'https://data.example.test/jobs', 'https://data.example.test/rest/v2',
      'https://data.example.test/rest/v1/jobs', 'https://data.example.test//',
      'https://data.example.test/rest/v1//', 'https://data.example.test/other/../rest/v1',
      ' https://data.example.test', 'https://data.example.test/ ',
    ]) {
      process.env.JOB_DATA_API_URL = base;
      assert.throws(() => createJobDataClient(), error => {
        assert.equal(error.message, 'Invalid JOB_DATA_API_URL: expected an HTTP(S) origin or /rest/v1 endpoint without credentials, query or fragment');
        return true;
      });
    }
  `);
});

test("data client uses native PostgREST root, bearer token and no session or storage", () => {
  runServer(`
    import assert from 'node:assert/strict';
    import { createJobDataClient } from './src/utils/supabase/data.ts';
    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push({url: String(url), init});
      return new Response('[]', {status: 200, headers: {'Content-Type': 'application/json'}});
    };
    const client = createJobDataClient();
    assert.equal(client.auth, undefined);
    assert.equal(client.storage, undefined);
    assert.equal(client.realtime, undefined);
    assert.equal((await client.from('jobs').select('job_id').limit(1)).error, null);
    assert.equal((await client.rpc('get_scraper_configuration')).error, null);
    assert.equal(requests[0].url, 'https://data.example.test/rest/v1/jobs?select=job_id&limit=1');
    assert.equal(requests[1].url, 'https://data.example.test/rest/v1/rpc/get_scraper_configuration');
    for (const {init} of requests) {
      const headers = new Headers(init.headers);
      assert.equal(headers.get('authorization'), 'Bearer test-data-token');
      assert.equal(headers.has('cookie'), false);
    }
  `);
});

test("legacy server and service factories now use the data endpoint", () => {
  runServer(`
    import assert from 'node:assert/strict';
    import { createSupabaseServerClient } from './src/utils/supabase/server.ts';
    import { createSupabaseServiceClient } from './src/utils/supabase/service.ts';
    globalThis.fetch = async (url) => {
      assert.equal(new URL(String(url)).origin, 'https://data.example.test');
      return new Response('[]', {headers: {'Content-Type':'application/json'}});
    };
    for (const client of [await createSupabaseServerClient(), createSupabaseServiceClient()]) {
      assert.equal(client.storage, undefined);
      assert.equal((await client.from('jobs').select('job_id')).error, null);
    }
  `);
});

test("config repository reads and writes route only to the data endpoint", () => {
  runServer(`
    import assert from 'node:assert/strict';
    const repository = await import('./src/lib/config/repository.ts');
    const calls = [];
    globalThis.fetch = async (url, init) => {
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-data-token');
      calls.push({url: String(url), body: init.body && JSON.parse(init.body)});
      return new Response(JSON.stringify({revision: 7}), {headers: {'Content-Type':'application/json'}});
    };
    await repository.getScraperConfiguration();
    await repository.getLinkedInDiscoveryStatus();
    await repository.replaceScraperConfiguration({revision: 7});
    assert.deepEqual(calls.map(({url}) => url), [
      'https://data.example.test/rest/v1/rpc/get_scraper_configuration',
      'https://data.example.test/rest/v1/rpc/get_linkedin_discovery_status',
      'https://data.example.test/rest/v1/rpc/replace_career_lane_configuration',
    ]);
    assert.equal(calls[2].body.p_expected_revision, 7);
    assert.equal(calls[2].body.p_actor_id, null);
  `);
});

test("resume uploads and signed URLs stay on legacy Storage, database queries use target", () => {
  runServer(`
    import assert from 'node:assert/strict';
    const { uploadPersonalizedResume, getCustomizedResumeById } = await import('./src/lib/supabase/queries.ts');
    const { getSignedUrl } = await import('./src/lib/supabase/storage.ts');
    const calls = [];
    globalThis.fetch = async (url, init) => {
      const u = new URL(String(url));
      calls.push({u, init});
      const isStorage = u.origin === 'https://legacy.example.test';
      assert.equal(new Headers(init.headers).get('authorization'), isStorage ? 'Bearer test-storage-token' : 'Bearer test-data-token');
      if (u.pathname.startsWith('/storage/v1/object/sign/')) {
        return new Response(JSON.stringify({signedURL: '/object/sign/personalized_resumes/test.pdf?token=fake'}), {headers: {'Content-Type':'application/json'}});
      }
      if (isStorage) {
        return new Response(JSON.stringify({Key: 'personalized_resumes/test.pdf'}), {headers: {'Content-Type':'application/json'}});
      }
      return new Response(JSON.stringify({id: 'test-id'}), {headers: {'Content-Type':'application/json'}});
    };
    assert.equal(await uploadPersonalizedResume('test.pdf', new File(['pdf'], 'test.pdf')), 'test.pdf');
    assert.equal(await getSignedUrl('test.pdf'), 'https://legacy.example.test/storage/v1/object/sign/personalized_resumes/test.pdf?token=fake');
    assert.equal((await getCustomizedResumeById('test-id')).id, 'test-id');
    assert.deepEqual(calls.map(({u}) => u.origin + u.pathname), [
      'https://legacy.example.test/storage/v1/object/personalized_resumes/test.pdf',
      'https://legacy.example.test/storage/v1/object/sign/personalized_resumes/test.pdf',
      'https://data.example.test/rest/v1/customized_resumes',
    ]);
    assert.equal(new Headers(calls[0].init.headers).get('x-upsert'), 'true');
    assert.equal(JSON.parse(calls[1].init.body).expiresIn, 3600);
  `, { NEXT_PUBLIC_SUPABASE_URL: 'https://legacy.example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-storage-token' });
});
