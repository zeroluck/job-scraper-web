import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class QualifyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR', str(Path.home() / '.hermes/cache/scratch')))
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.release = self.root / 'release'
        self.release.mkdir()
        for name, content in {
            '.next/BUILD_ID': 'fixture',
            'node_modules/next/dist/bin/next': '',
            'node_modules/@supabase/supabase-js/index.js': "exports.createClient=()=>({storage:{listBuckets:async()=>({}),from:()=>({list:async()=>({data:[{id:1,name:'fixture'}]}),download:async()=>({data:{size:1}})})}});",
            'src/utils/supabase/data.ts': "export function createJobDataClient(){return {from:()=>({select:()=>({eq(){return this;},limit:async()=>process.env.JOB_DATA_API_TOKEN==='invalid-negative-control'?{error:true,status:401}:{status:200,data:[{job_id:1}]}})})}}",
        }.items():
            p = self.release / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content)
        self.preload = self.root / 'preload.mjs'
        self.proof = self.root / 'proof.json'
        self.proof.write_text(json.dumps({'pid': 42, 'started': 'fixture-start', 'cwd': str(self.release), 'runtimeSha256': 'fixture'}))
        self.preload_prefix = (
            "import cp from 'node:child_process'; import fs from 'node:fs'; import {createHash} from 'node:crypto'; import {syncBuiltinESMExports} from 'node:module'; "
            "let calls=0; cp.execFileSync=()=>{calls++; const p=JSON.parse(fs.readFileSync(" + json.dumps(str(self.proof)) + ")); "
            "if(p.reject) throw new Error('sensitive-listener'); if(p.runtimeSha256!=='0'.repeat(64)) p.runtimeSha256=createHash('sha256').update(fs.readFileSync(" + json.dumps(str(self.root / 'runtime.json')) + ")).digest('hex'); if(p.change && calls>1) p.pid++; return JSON.stringify(p);}; syncBuiltinESMExports(); ")
        self.preload.write_text(self.preload_prefix + "globalThis.fetch=async()=>new Response('{}');")
        self.runtime = self.root / 'runtime.json'
        self.receipt = self.root / 'receipt.json'
        self.value = {'cwd': str(self.release), 'port': 3013, 'environment': {
            'NODE_ENV': 'production', 'JOB_DATA_API_URL': 'https://api.example.test',
            'JOB_DATA_API_TOKEN': 'fixture', 'NEXT_PUBLIC_SUPABASE_URL': 'https://storage.example.test',
            'NEXT_PUBLIC_SUPABASE_ANON_KEY': 'fixture', 'SUPABASE_SERVICE_ROLE_KEY': 'fixture',
            'NODE_EXTRA_CA_CERTS': str(self.root / 'trust.pem')}}
        self.save()
        self.signing = self.root / 'signing.json'
        self.signing.write_text(json.dumps({'resumeId': '2', 'objectName': 'fixture'}))
        self.signing.chmod(0o600)

    def save(self):
        self.runtime.write_text(json.dumps(self.value))
        self.runtime.chmod(0o600)

    def run_qualify(self):
        return subprocess.run([shutil.which('node') or 'node', '--experimental-strip-types', '--import', str(self.preload),
            str(getattr(self, 'qualifier', Path(__file__).with_name('qualify.mjs'))), str(self.runtime), str(self.receipt),
            'fixture_not_final', str(self.release), str(getattr(self, 'expected_node', shutil.which('node') or '/missing/node')), str(self.signing)], capture_output=True, text=True, timeout=15)

    def test_audited_executable_and_release_inputs_cannot_be_receipts(self):
        helpers = self.root / 'helpers'
        helpers.mkdir(mode=0o700)
        for name in ('qualify.mjs', 'listener.py', 'launcher.py'):
            shutil.copyfile(Path(__file__).with_name(name), helpers / name)
        self.qualifier = helpers / 'qualify.mjs'
        self.expected_node = self.root / 'pinned-node'
        self.expected_node.write_text('pinned executable fixture')
        package = self.release / 'package.json'
        package.write_text('{}')
        sources = [self.expected_node, package,
                   self.release / '.next/BUILD_ID',
                   self.release / 'node_modules/next/dist/bin/next',
                   self.release / 'src/utils/supabase/data.ts',
                   self.release / 'node_modules/@supabase/supabase-js/index.js',
                   *(helpers / name for name in ('qualify.mjs', 'listener.py', 'launcher.py'))]
        for source in sources:
            source.chmod(0o600)
            source.parent.chmod(0o700)
            original = source.read_bytes()
            for failure in (False, True):
                self.value['port'] = 3011 if failure else 3013
                self.save()
                for kind in ('direct', 'normalized', 'symlink', 'hardlink', 'ancestor_symlink'):
                    with self.subTest(source=str(source.relative_to(self.root)), failure=failure, kind=kind):
                        source.write_bytes(original)
                        alias = self.root / 'protected-alias'
                        if alias.exists() or alias.is_symlink(): alias.unlink()
                        self.receipt = source
                        if kind == 'normalized':
                            normal = source.parent / 'normal'
                            normal.mkdir(exist_ok=True)
                            self.receipt = normal / '..' / source.name
                        if kind == 'symlink':
                            alias.symlink_to(source)
                            self.receipt = alias
                        if kind == 'hardlink':
                            os.link(source, alias)
                            self.receipt = alias
                        if kind == 'ancestor_symlink':
                            alias.symlink_to(source.parent, target_is_directory=True)
                            self.receipt = alias / source.name
                        before = source.stat()
                        result = self.run_qualify()
                        self.assertEqual(source.read_bytes(), original, result.stdout + result.stderr)
                        self.assertEqual(source.stat().st_ino, before.st_ino)
                        self.assertNotEqual(result.returncode, 0)
                        self.assertNotIn('listener_identity_before_checks', result.stdout)
                        if alias.exists() or alias.is_symlink(): alias.unlink()

    def test_symlinked_sdk_entrypoint_outside_release_is_protected(self):
        entrypoint = self.release / 'node_modules/@supabase/supabase-js/index.js'
        target = self.root / 'external-sdk.js'
        entrypoint.rename(target)
        target.chmod(0o600)
        entrypoint.symlink_to(target)
        original = target.read_bytes()
        self.receipt = target
        for failure in (False, True):
            with self.subTest(failure=failure):
                target.write_bytes(original)
                self.value['port'] = 3011 if failure else 3013
                self.save()
                result = self.run_qualify()
                self.assertEqual(target.read_bytes(), original, result.stdout + result.stderr)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('listener_identity_before_checks', result.stdout)

    def test_receipt_aliases_never_replace_protected_inputs(self):
        for source in (self.runtime, self.signing):
            original = source.read_bytes()
            for kind in ('direct', 'normalized', 'ancestor_symlink', 'hardlink'):
                with self.subTest(source=source.name, kind=kind):
                    source.write_bytes(original)
                    if kind == 'direct': self.receipt = source
                    if kind == 'normalized':
                        (self.root / 'normal').mkdir(exist_ok=True)
                        self.receipt = self.root / 'normal' / '..' / source.name
                    if kind == 'ancestor_symlink':
                        alias = self.root / 'alias'
                        if not alias.exists(): alias.symlink_to(self.root, target_is_directory=True)
                        self.receipt = alias / source.name
                    if kind == 'hardlink':
                        self.receipt = self.root / 'hardlink'
                        if self.receipt.exists(): self.receipt.unlink()
                        os.link(source, self.receipt)
                    result = self.run_qualify()
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(source.read_bytes(), original)
                    self.assertNotIn('listener_identity_before_checks', result.stdout)
                    if kind == 'hardlink': self.receipt.unlink()

    def test_runtime_ca_aliases_survive_success_and_failure_receipt_attempts(self):
        trust = self.root / 'trust.pem'
        original = b'private runtime trust fixture\n'
        data = self.release / 'src/utils/supabase/data.ts'
        data.write_text("export function createJobDataClient(){return {from:(table)=>({select:()=>({eq(){return this;},limit:async()=>process.env.JOB_DATA_API_TOKEN==='invalid-negative-control'?{error:true,status:401}:{status:200,data:table==='jobs'?[{job_id:1}]:[{id:2,resume_link:'fixture'}]}})})}}")
        self.preload.write_text(self.preload_prefix + "globalThis.fetch=async()=>new Response(JSON.stringify({job_id:1,signedUrl:'https://storage.example.test/fixture'}));")
        for failure in (False, True):
            for kind in ('direct', 'normalized', 'symlink', 'hardlink', 'ancestor_symlink', 'ca_symlink'):
                with self.subTest(failure=failure, kind=kind):
                    trust.write_bytes(original)
                    trust.chmod(0o600)
                    alias = self.root / 'trust-alias'
                    if alias.exists() or alias.is_symlink(): alias.unlink()
                    self.value['environment']['NODE_EXTRA_CA_CERTS'] = str(trust)
                    self.value['port'] = 3011 if failure else 3013
                    self.receipt = trust
                    if kind == 'normalized':
                        (self.root / 'normal').mkdir(exist_ok=True)
                        self.receipt = self.root / 'normal' / '..' / trust.name
                    if kind == 'symlink':
                        alias.symlink_to(trust)
                        self.receipt = alias
                    if kind == 'hardlink':
                        os.link(trust, alias)
                        self.receipt = alias
                    if kind == 'ancestor_symlink':
                        ancestor = self.root / 'ancestor'
                        if not ancestor.exists(): ancestor.symlink_to(self.root, target_is_directory=True)
                        self.receipt = ancestor / trust.name
                    if kind == 'ca_symlink':
                        alias.symlink_to(trust)
                        self.value['environment']['NODE_EXTRA_CA_CERTS'] = str(alias)
                    self.save()
                    before = trust.stat()
                    result = self.run_qualify()
                    self.assertEqual(trust.read_bytes(), original, result.stdout + result.stderr)
                    self.assertEqual(trust.stat().st_ino, before.st_ino)
                    self.assertEqual(trust.stat().st_mode & 0o777, 0o600)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertNotIn('listener_identity_before_checks', result.stdout)
                    self.assertEqual(list(self.root.glob('*.tmp')), [])

    def test_existing_temporary_receipt_collision_preserves_signing_input(self):
        self.preload.write_text(self.preload_prefix +
            "const collision=process.argv[3]+'.'+process.pid+'.tmp'; fs.copyFileSync(process.argv[7],collision); fs.chmodSync(collision,0o600); process.argv[7]=collision; globalThis.fetch=async()=>new Response('{}');")
        original = self.signing.read_bytes()
        result = self.run_qualify()
        self.assertNotEqual(result.returncode, 0)
        collisions = list(self.root.glob('receipt.json.*.tmp'))
        self.assertEqual(len(collisions), 1, 'failed exclusive open must not unlink someone else\'s file')
        self.assertEqual(collisions[0].read_bytes(), original)

    def test_listener_runtime_snapshot_must_match_sdk_snapshot(self):
        self.proof.write_text(json.dumps({'pid': 42, 'runtimeSha256': '0' * 64}))
        result = self.run_qualify()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('job_web_authenticated_read', result.stdout)

    def test_listener_mismatch_fails_before_executable_imports_or_http(self):
        self.proof.write_text(json.dumps({'reject': True}))
        marker = self.root / 'imported'
        (self.release / 'src/utils/supabase/data.ts').write_text(
            "import fs from 'node:fs'; fs.writeFileSync(" + json.dumps(str(marker)) + ", 'executed'); throw new Error();")
        result = self.run_qualify()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(marker.exists(), 'listener must be independently checked before SDK/HTTP checks')
        self.assertNotIn('sensitive-listener', result.stdout + result.stderr)

    def test_listener_proof_is_receipted_and_revalidated_after_checks(self):
        self.proof.write_text(json.dumps({'pid': 42, 'change': True}))
        result = self.run_qualify()
        self.assertNotEqual(result.returncode, 0)
        receipt = json.loads(self.receipt.read_text())
        self.assertEqual(receipt.get('listenerBefore', {}).get('pid'), 42)
        self.assertEqual(receipt.get('listenerAfter', {}).get('pid'), 43)
        self.assertIn({'check': 'listener_unchanged_after_checks', 'pass': False}, receipt['results'])

    def test_http_api_requires_matching_job_content_not_just_status(self):
        for body in ('{}', '{"job_id":999}', '{"job_id":1}'):
            with self.subTest(body=body):
                self.preload.write_text(self.preload_prefix + 'globalThis.fetch=async()=>new Response(' + json.dumps(body) + ');')
                result = self.run_qualify()
                rows = {row['check']: row['pass'] for row in json.loads(self.receipt.read_text())['results']}
                self.assertIs(rows.get('API_job_detail'), body == '{"job_id":1}')

    def test_complete_fixtures_succeed_with_private_atomic_receipt(self):
        data = self.release / 'src/utils/supabase/data.ts'
        data.write_text("export function createJobDataClient(){return {from:(table)=>({select:()=>({eq(){return this;},limit:async()=>process.env.JOB_DATA_API_TOKEN==='invalid-negative-control'?{error:true,status:401}:{status:200,data:table==='jobs'?[{job_id:1}]:[{id:2,resume_link:'fixture'}]}})})}}")
        self.preload.write_text(self.preload_prefix + "globalThis.fetch=async()=>new Response(JSON.stringify({job_id:1,signedUrl:'https://storage.example.test/fixture'}));")
        self.receipt.write_text('old'); self.receipt.chmod(0o600)
        original = self.receipt.open('rb')
        self.addCleanup(original.close)
        old_inode = self.receipt.stat().st_ino
        result = self.run_qualify()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotEqual(self.receipt.stat().st_ino, old_inode)
        self.assertEqual(self.receipt.stat().st_mode & 0o777, 0o600)
        rows = json.loads(self.receipt.read_text())['results']
        self.assertTrue(rows)
        self.assertTrue(all(row['pass'] for row in rows))
        self.assertTrue(any(row['check'] == 'UI_retained_storage_signed_download' for row in rows))

    def test_initialization_errors_are_redacted_and_receipted(self):
        for kind in ('json', 'import'):
            with self.subTest(kind=kind):
                self.save()
                if kind == 'json': self.runtime.write_text('{sensitive-fixture')
                else: (self.release / 'src/utils/supabase/data.ts').write_text("throw new Error('sensitive-fixture');")
                result = self.run_qualify()
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('sensitive-fixture', result.stdout + result.stderr)
                self.assertNotIn('at ', result.stderr)
                if kind == 'json':
                    self.assertFalse(self.receipt.exists(), 'unknown runtime trust path must fail closed without a receipt')
                else:
                    rows = json.loads(self.receipt.read_text())['results']
                    self.assertIn({'check': 'qualification_exception_details_suppressed', 'pass': False}, rows)
                    self.assertEqual(self.receipt.stat().st_mode & 0o777, 0o600)

    def test_missing_resume_fixture_is_explicit_failure(self):
        result = self.run_qualify()
        self.assertNotEqual(result.returncode, 0)
        rows = {row['check']: row['pass'] for row in json.loads(self.receipt.read_text())['results']}
        self.assertIs(rows.get('UI_retained_storage_signing_route'), False)
        self.assertIs(rows.get('UI_retained_storage_signed_download'), False)

    def test_explicit_private_signing_fixture_required_before_imports(self):
        for kind in ('missing', 'mode', 'schema', 'symlink'):
            with self.subTest(kind=kind):
                if self.signing.exists() or self.signing.is_symlink(): self.signing.unlink()
                if kind == 'mode': self.signing.write_text('{}'); self.signing.chmod(0o644)
                if kind == 'schema': self.signing.write_text('{}'); self.signing.chmod(0o600)
                if kind == 'symlink': self.signing.symlink_to(self.runtime)
                result = self.run_qualify()
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('job_web_authenticated_read', result.stdout)

    def test_unsafe_receipt_paths_never_overwrite_target(self):
        for kind in ('symlink', 'mode'):
            with self.subTest(kind=kind):
                target = self.root / 'target'
                target.write_text('preserve')
                if self.receipt.exists() or self.receipt.is_symlink(): self.receipt.unlink()
                if kind == 'symlink': self.receipt.symlink_to(target)
                else:
                    self.receipt.write_text('preserve')
                    self.receipt.chmod(0o644)
                marker = self.root / 'imported'
                (self.release / 'src/utils/supabase/data.ts').write_text(
                    "import fs from 'node:fs'; fs.writeFileSync(" + json.dumps(str(marker)) + ", 'executed'); throw new Error();")
                result = self.run_qualify()
                self.assertFalse(marker.exists(), 'unsafe receipt must fail before executable imports')
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(target.read_text(), 'preserve')
                if kind == 'mode': self.assertEqual(self.receipt.read_text(), 'preserve')
                self.assertNotIn('at ', result.stderr)

    def test_rejects_symlink_runtime_before_import(self):
        original = self.root / 'original'
        self.runtime.rename(original)
        self.runtime.symlink_to(original)
        result = self.run_qualify()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('job_web_authenticated_read', result.stdout)
        self.assertNotIn('at ', result.stderr)

    def test_rejects_unsafe_runtime_schema_before_import(self):
        for change in ('mode', 'env', 'release', 'port'):
            with self.subTest(change=change):
                old = json.loads(json.dumps(self.value))
                if change == 'env': self.value['environment']['NODE_OPTIONS'] = '--trace-warnings'
                if change == 'release': self.value['cwd'] = str(self.root)
                if change == 'port': self.value['port'] = 3011
                self.save()
                if change == 'mode': self.runtime.chmod(0o644)
                result = self.run_qualify()
                self.assertNotIn('job_web_authenticated_read', result.stdout)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('at ', result.stderr)
                self.value = old


if __name__ == '__main__': unittest.main()
