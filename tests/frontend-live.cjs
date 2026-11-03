const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = html.slice(html.indexOf('const { createApp }'), html.lastIndexOf('</script>'));
assert.doesNotMatch(html, /DEMO_|isDemoMode|resetToDemo|quickFillStaff|9999|7777|images\.unsplash/);
let config;
let calls = 0;
let response = {success:true,devices:[],whitelist:[],audit_queue:[],edit_logs:[]};
const context = vm.createContext({
  Vue: {createApp: options => {config=options; return {mount() {}};}},
  localStorage: {getItem: () => null, setItem() {}, removeItem() {}},
  URL,
  fetch: async () => {calls++; if (response instanceof Error) throw response; return {json:async()=>response};},
  setTimeout() {}
});
vm.runInContext(script, context);
const app = config.data();
for(const [name,fn] of Object.entries(config.methods)) app[name]=fn.bind(app);
for(const [name,fn] of Object.entries(config.computed)) Object.defineProperty(app,name,{get:fn.bind(app)});
(async()=>{
  assert.equal(app.adminUser,null);
  assert.equal(app.staffLoginForm.pin,'');
  assert.equal(app.inputMssv,'');
  await app.fetchData();
  assert.equal(calls,0);
  assert.ok(app.connectionError);
  assert.equal(app.devices.length,0);
  assert.throws(()=>app.requestApi({method:'POST'}));
  app.apiUrl='https://example.com/api';
  response={success:true,devices:[{device_id:'REAL'}],whitelist:[],audit_queue:[],edit_logs:[]};
  await app.fetchData();
  assert.equal(app.devices[0].device_id,'REAL');
  assert.equal(app.connectionError,'');
  response=new Error('offline');
  await app.fetchData();
  assert.equal(app.devices.length,0);
  assert.ok(app.connectionError.includes('offline'));
  response={success:false,message:'Denied'};
  await app.fetchData();
  assert.ok(app.connectionError.includes('Denied'));
  app.configApiUrl='';
  app.saveSettings();
  assert.equal(app.apiUrl,'https://example.com/api');
  console.log('PASS: live-only startup, API success/failure, empty state, missing API guard, no sample data');
})().catch(error=>{console.error(error);process.exitCode=1;});
