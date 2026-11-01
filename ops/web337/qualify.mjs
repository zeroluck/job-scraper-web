// Read-only qualification. Never prints credentials, endpoints, object names or data.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {createHash} from 'node:crypto';
const [runtimePath, receiptPath, databaseLabel, expectedRelease, expectedNode, signingFixturePath] = process.argv.slice(2);
const results = [];
const receipt = {databaseLabel, finalCandidateQualified: false, port: 3013, timestamp: new Date().toISOString(), results};
let runtimeSha256;
function listenerProof() {
  if (!expectedNode || !path.isAbsolute(expectedNode)) throw new Error();
  return JSON.parse(execFileSync('/usr/bin/python3', [fileURLToPath(new URL('./listener.py', import.meta.url)), runtimePath, expectedRelease, expectedNode], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000}));
}
function readRuntimeDocument() {
  const fd = fs.openSync(runtimePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600) throw new Error();
    const snapshot = fs.readFileSync(fd);
    return {runtime: JSON.parse(snapshot.toString('utf8')), sha256: createHash('sha256').update(snapshot).digest('hex')};
  } finally { fs.closeSync(fd); }
}
function readRuntime() {
  const {runtime, sha256} = readRuntimeDocument();
  runtimeSha256 = sha256;
  const required = ['JOB_DATA_API_URL', 'JOB_DATA_API_TOKEN', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NODE_EXTRA_CA_CERTS', 'NODE_ENV'];
  const allowed = [...required, 'JOB_DATA_API_CONNECT_IP'];
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime) || runtime.port !== 3013 ||
      !expectedRelease || !path.isAbsolute(expectedRelease) || runtime.cwd !== expectedRelease ||
      !runtime.environment || Array.isArray(runtime.environment) ||
      required.some(key => typeof runtime.environment[key] !== 'string' || !runtime.environment[key]) ||
      Object.entries(runtime.environment).some(([key, value]) => !allowed.includes(key) || typeof value !== 'string' || value.includes('\0')) ||
      runtime.environment.NODE_ENV !== 'production' || !path.isAbsolute(runtime.environment.NODE_EXTRA_CA_CERTS) ||
      !fs.statSync(path.join(expectedRelease, '.next/BUILD_ID')).isFile() ||
      !fs.statSync(path.join(expectedRelease, 'node_modules/next/dist/bin/next')).isFile()) throw new Error();
  return runtime;
}
function readSigningFixture() {
  const fd = fs.openSync(signingFixturePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600) throw new Error();
    const value = JSON.parse(fs.readFileSync(fd, 'utf8'));
    if (!value || typeof value.resumeId !== 'string' || !value.resumeId ||
        typeof value.objectName !== 'string' || !value.objectName || value.objectName.split('/').some(x => !x || x === '.' || x === '..')) throw new Error();
    return value;
  } finally { fs.closeSync(fd); }
}
const runtimeTrustPaths = new Set();
function validateReceipt() {
  // Discover trust even when later runtime/schema/fixture checks fail. If it
  // cannot be determined safely, diagnostic receipts must also fail closed.
  const document = readRuntimeDocument().runtime;
  const trust = document?.environment?.NODE_EXTRA_CA_CERTS;
  if (typeof trust !== 'string' || !path.isAbsolute(trust) || trust.includes('\0')) throw new Error();
  runtimeTrustPaths.add(trust);
  const destination = path.join(fs.realpathSync(path.dirname(receiptPath)), path.basename(receiptPath));
  // Receipts do not belong in immutable release/helper trees, including files
  // not yet created. Existing hardlink aliases are independently refused below.
  for (const tree of [expectedRelease, document?.cwd, fileURLToPath(new URL('.', import.meta.url))]) {
    if (typeof tree !== 'string' || !path.isAbsolute(tree)) throw new Error();
    const canonical = fs.realpathSync(tree);
    if (destination === canonical || destination.startsWith(canonical + path.sep)) throw new Error();
  }
  const inputs = [runtimePath, signingFixturePath, ...runtimeTrustPaths, expectedNode, process.execPath,
    createRequire(path.join(expectedRelease, 'package.json')).resolve('@supabase/supabase-js'),
    '/usr/bin/python3', '/usr/sbin/lsof', '/bin/ps', '/usr/lib/libSystem.B.dylib',
    ...['qualify.mjs', 'listener.py', 'launcher.py'].map(name => fileURLToPath(new URL(name, import.meta.url))),
    ...['package.json', '.next/BUILD_ID', 'node_modules/next/dist/bin/next', 'src/utils/supabase/data.ts']
      .map(name => path.join(expectedRelease, name))];
  for (const input of inputs) {
    if (!input) throw new Error();
    let canonical;
    try { canonical = fs.realpathSync(input); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      canonical = path.join(fs.realpathSync(path.dirname(input)), path.basename(input));
    }
    if (destination === canonical) throw new Error();
    try {
      const target = fs.statSync(receiptPath);
      const source = fs.statSync(input);
      if (target.dev === source.dev && target.ino === source.ino) throw new Error();
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const parent = fs.lstatSync(path.dirname(receiptPath));
  if (!parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o777) !== 0o700) throw new Error();
  try {
    const info = fs.lstatSync(receiptPath);
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600 || info.nlink !== 1) throw new Error();
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
function record(check, pass, metadata = {}) {
  results.push({check, pass, ...metadata});
  validateReceipt();
  const temp = receiptPath + '.' + process.pid + '.tmp';
  let fd;
  let created = false;
  try {
    fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    created = true;
    fs.writeFileSync(fd, JSON.stringify(receipt, null, 2) + '\n');
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    validateReceipt();
    fs.renameSync(temp, receiptPath);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (created) {
      try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  console.log(JSON.stringify(results.at(-1)));
}
try {
  if (!runtimePath || !receiptPath || !databaseLabel) throw new Error();
  validateReceipt();
  const runtime = readRuntime();
  const signingFixture = readSigningFixture();
  receipt.listenerBefore = listenerProof();
  if (receipt.listenerBefore.runtimeSha256 !== runtimeSha256) throw new Error();
  record('listener_identity_before_checks', true);
  receipt.cwd = runtime.cwd;
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, runtime.environment);
  const require = createRequire(expectedRelease + '/package.json');
  const {createClient} = require('@supabase/supabase-js');
  const {createJobDataClient} = await import(pathToFileURL(expectedRelease + '/src/utils/supabase/data.ts'));
  const data = createJobDataClient();
  const jobs = await data.from('jobs').select('job_id').limit(1);
  record('job_web_authenticated_read', !jobs.error && jobs.status === 200 && jobs.data.length > 0, {status: jobs.status, rows: jobs.data?.length ?? 0});
  const resumes = await data.from('customized_resumes').select('id,resume_link').eq('id', signingFixture.resumeId).limit(1);
  record('resume_metadata_read', !resumes.error, {status: resumes.status, rows: resumes.data?.length ?? 0});
  process.env.JOB_DATA_API_TOKEN = 'invalid-negative-control';
  const denied = await createJobDataClient().from('jobs').select('job_id').limit(1);
  process.env.JOB_DATA_API_TOKEN = runtime.environment.JOB_DATA_API_TOKEN;
  record('invalid_token_rejected', !!denied.error && denied.status === 401, {status: denied.status});
  const storage = createClient(runtime.environment.NEXT_PUBLIC_SUPABASE_URL, runtime.environment.SUPABASE_SERVICE_ROLE_KEY, {auth: {persistSession: false, autoRefreshToken: false}}).storage;
  const buckets = await storage.listBuckets();
  record('retained_storage_bucket_read', !buckets.error);
  const objectDirectory = path.posix.dirname(signingFixture.objectName);
  const objectBasename = path.posix.basename(signingFixture.objectName);
  const objects = await storage.from('personalized_resumes').list(objectDirectory === '.' ? '' : objectDirectory, {search: objectBasename, limit: 100});
  record('retained_storage_object_metadata_read', !objects.error);
  const object = objects.data?.find(item => item.id && item.name === objectBasename);
  if (object) {
    const downloaded = await storage.from('personalized_resumes').download(signingFixture.objectName);
    record('retained_storage_object_download', !downloaded.error && downloaded.data.size > 0, {bytes: downloaded.data?.size ?? 0});
  } else record('retained_storage_object_download', false);
  const jobId = jobs.data?.[0]?.job_id;
  for (const path of ['/', '/jobs/all', '/profile', '/insights', ...(jobId ? ['/jobs/' + encodeURIComponent(jobId), '/api/jobs/' + encodeURIComponent(jobId)] : [])]) {
    const response = await fetch('http://127.0.0.1:3013' + path, {signal: AbortSignal.timeout(120000)});
    const body = await response.text();
    let contentMatches = true;
    if (path.startsWith('/api/jobs/')) {
      try {
        const job = JSON.parse(body);
        contentMatches = job && !job.error && String(job.job_id) === String(jobId);
      } catch { contentMatches = false; }
    }
    record(path.startsWith('/jobs/') && path !== '/jobs/all' ? 'UI_job_detail' : path.startsWith('/api/jobs/') ? 'API_job_detail' : 'UI_' + path, response.ok && contentMatches && !body.includes('NEXT_HTTP_ERROR_FALLBACK;500') && !body.includes('Application error: a server-side exception') && !/"digest":"[0-9]+"/.test(body), {status: response.status, bytes: Buffer.byteLength(body)});
  }
  const resume = resumes.data?.find(row => String(row.id) === signingFixture.resumeId && row.resume_link);
  if (resume) {
    const response = await fetch('http://127.0.0.1:3013/api/customized_resumes/' + encodeURIComponent(resume.id) + '/signed-url', {signal: AbortSignal.timeout(60000)});
    const signed = await response.json();
    record('UI_retained_storage_signing_route', response.ok && typeof signed.signedUrl === 'string', {status: response.status});
    if (signed.signedUrl) {
      const downloaded = await fetch(signed.signedUrl, {signal: AbortSignal.timeout(60000)});
      const bytes = await downloaded.arrayBuffer();
      record('UI_retained_storage_signed_download', downloaded.ok && bytes.byteLength > 0, {status: downloaded.status, bytes: bytes.byteLength});
    } else record('UI_retained_storage_signed_download', false);
  } else {
    record('UI_retained_storage_signing_route', false);
    record('UI_retained_storage_signed_download', false);
  }
} catch {
  try { record('qualification_exception_details_suppressed', false); }
  catch { console.error('qualification failed; protected receipt unavailable'); }
  process.exitCode = 1;
} finally {
  if (receipt.listenerBefore) {
    try {
      receipt.listenerAfter = listenerProof();
      record('listener_unchanged_after_checks', JSON.stringify(receipt.listenerBefore) === JSON.stringify(receipt.listenerAfter));
    } catch {
      try { record('listener_unchanged_after_checks', false); } catch { process.exitCode = 1; }
    }
  }
}
process.exit(process.exitCode || (results.some(row => !row.pass) ? 1 : 0));
