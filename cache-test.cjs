const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const data = {'transcript:old': 'obsolete', setting: true};
let fail = false;
const bytes = (k, v) => Buffer.byteLength(k) + Buffer.byteLength(JSON.stringify(v));
const storage = {
  QUOTA_BYTES: 10485760,
  async get() {return structuredClone(data);},
  async getBytesInUse(keys) {return keys.reduce((n,k)=>n+bytes(k,data[k]),0);},
  async remove(keys) {for(const key of keys) delete data[key];},
  async set(values) {
    if(fail) throw new Error('Storage failed');
    const next = {...data,...values};
    assert.ok(Object.entries(next).reduce((n,[k,v])=>n+bytes(k,v),0) <= this.QUOTA_BYTES);
    Object.assign(data,structuredClone(values));
  }
};
const ctx = vm.createContext({chrome: {storage: {local: storage}}, TextEncoder});
vm.runInContext(fs.readFileSync(__dirname+'/cache.js','utf8'),ctx);
const size = () => Object.entries(data).filter(([k])=>k.startsWith('direct-v3:')||k==='transcript-fifo-v1').reduce((n,[k,v])=>n+bytes(k,v),0);
(async()=>{
  await vm.runInContext('cacheQueue',ctx);
  assert.equal(data['transcript:old'],undefined);
  assert.equal(data.setting,true);
  const chunk = 'x'.repeat(2*1024*1024);
  await Promise.all([ctx.saveTranscript('a',chunk),ctx.saveTranscript('b',chunk),ctx.saveTranscript('c',chunk)]);
  assert.equal(data['direct-v3:a'],undefined);
  assert.deepEqual(data['transcript-fifo-v1'],['direct-v3:b','direct-v3:c']);
  assert.ok(size()<=5*1024*1024);
  console.log('PASS concurrent writes, FIFO eviction, byte cap, legacy cleanup');
  const before = JSON.stringify(data);
  const result = await ctx.saveTranscript('giant','x'.repeat(10*1024*1024));
  assert.equal(result.cached,false);
  assert.match(result.note,/Too large/);
  assert.equal(JSON.stringify(data),before);
  console.log('PASS 10 MiB transcript bypasses cache without eviction');
  assert.equal(ctx.cacheBytes('jp','日本語'),bytes('jp','日本語'));
  assert.equal(ctx.cacheBytes('escape','"\n\\'),bytes('escape','"\n\\'));
  await ctx.saveTranscript('b','short');
  assert.deepEqual(data['transcript-fifo-v1'],['direct-v3:b','direct-v3:c']);
  console.log('PASS Unicode/JSON byte accounting and no reorder on update');
  fail = true;
  const failed = await ctx.saveTranscript('d','still copyable');
  assert.equal(failed.cached,false);
  fail = false;
  assert.equal((await ctx.saveTranscript('e','next write')).cached,true);
  console.log('PASS write failure is nonfatal and does not poison queue');
  // Simulate worker restart and verify persisted order is retained.
  const restarted = vm.createContext({chrome:{storage:{local:storage}},TextEncoder});
  vm.runInContext(fs.readFileSync(__dirname+'/cache.js','utf8'),restarted);
  await vm.runInContext('cacheQueue',restarted);
  assert.deepEqual(data['transcript-fifo-v1'],['direct-v3:b','direct-v3:c','direct-v3:e']);
  console.log('PASS FIFO order survives worker restart');
  const record = {text: 'example', metadata: {title: '日本語', description: 'source links'}};
  assert.equal((await restarted.saveTranscript('meta',record)).cached,true);
  assert.deepEqual(data['direct-v3:meta'],record);
  assert.equal(restarted.cacheBytes('direct-v3:meta',record),bytes('direct-v3:meta',record));
  console.log('PASS structured metadata cache record and byte accounting');
})().catch(e=>{console.error(e);process.exitCode=1;});
