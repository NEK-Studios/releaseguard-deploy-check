import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/check.mjs';
import { createApp } from '../src/server.mjs';

const run = (manifest, lockfiles = []) => analyze({ manifest, lockfiles });
test('clean Next.js manifest returns no findings', () => {
  const r = run({ name: 'clean', dependencies: {next:'^15',react:'^19','react-dom':'^19'}, scripts:{build:'next build'}, private:true });
  assert.equal(r.findings.length, 0);
  assert.equal(r.status, 'review');
});
test('missing React is a release-blocking error candidate', () => {
  const r = run({ dependencies:{next:'^15', 'react-dom':'^19'},scripts:{build:'next build'} });
  assert.equal(r.counts.errors, 1);
  assert.equal(r.findings[0].ruleId, 'RG-NEXT-REACT');
});
test('missing react-dom is a warning', () => {
  const r = run({ dependencies:{next:'^15',react:'^19'},scripts:{build:'next build'} });
  assert.ok(r.findings.some(f=>f.ruleId==='RG-NEXT-DOM'));
});
test('Expo without react-native warns, not hard error', () => {
  const r = run({ dependencies:{expo:'^54',react:'^19'} });
  assert.ok(r.findings.some(f=>f.ruleId==='RG-EXPO-RN' && f.severity==='warning'));
});
test('duplicate dep and floating spec are found', () => {
  const r = run({ dependencies:{react:'*'},devDependencies:{react:'^19'} });
  assert.ok(r.findings.some(f=>f.ruleId==='RG-DEP-DUPLICATE'));
  assert.ok(r.findings.some(f=>f.ruleId==='RG-DEP-UNPINNED'));
});
test('mixed packageManager and lockfile are found', () => {
  const r = run({packageManager:'pnpm@10',dependencies:{}},['package-lock.json']);
  assert.ok(r.findings.some(f=>f.ruleId==='RG-LOCKFILE-MISMATCH'));
});
test('workspace private warning', () => {
  const r = run({workspaces:['packages/*']});
  assert.ok(r.findings.some(f=>f.ruleId==='RG-WORKSPACE-PRIVATE'));
});
test('invalid dependency type rejected', () => assert.throws(() => run({dependencies:{next:10}}), TypeError));
test('invalid input rejected', () => assert.throws(() => analyze({manifest:null}), TypeError));
test('lockfile input bounds enforced', () => assert.throws(() => run({},Array(21).fill('a')),TypeError));

test('local API health and check work', async () => {
  const app = createApp().listen(0, '127.0.0.1');
  try {
    await new Promise(resolve=>app.once('listening',resolve));
    const port = app.address().port;
    const h=await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(h.status, 200);
    const r=await fetch(`http://127.0.0.1:${port}/v1/release-check`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({manifest:{dependencies:{next:'latest'}}})});
    assert.equal(r.status,200);
    const data=await r.json();
    assert.equal(data.counts.errors,1);
    assert.equal(r.headers.get('cache-control'),'no-store');
  } finally { await new Promise(resolve=>app.close(resolve)); }
});
test('local API rejects invalid content-type and invalid payload', async () => {
  const app=createApp().listen(0,'127.0.0.1');
  try {
    await new Promise(resolve=>app.once('listening',resolve));
    const url=`http://127.0.0.1:${app.address().port}/v1/release-check`;
    const a=await fetch(url,{method:'POST',body:'abc',headers:{'content-type':'text/plain'}});
    assert.equal(a.status,415);
    const b=await fetch(url,{method:'POST',body:'nope',headers:{'content-type':'application/json'}});
    assert.equal(b.status,400);
  } finally {await new Promise(resolve=>app.close(resolve));}
});
