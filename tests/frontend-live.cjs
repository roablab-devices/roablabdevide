const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = html.slice(html.indexOf('const { createApp }'), html.lastIndexOf('</script>'));
assert.doesNotMatch(html, /DEMO_|isDemoMode|resetToDemo|quickFillStaff|9999|7777|images\.unsplash/);
let config;
const storage = new Map();
let calls = 0;
let response = {success:true,devices:[],whitelist:[],audit_queue:[],edit_logs:[]};
const context = vm.createContext({
  Vue: {createApp: options => {config=options; return {mount() {}};}},
  localStorage: {getItem: key => storage.get(key) || null, setItem: (key,value) => storage.set(key,value), removeItem: key => storage.delete(key)},
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
  storage.set('slam_staff_user', JSON.stringify({user_id:'admin',full_name:'Admin',role:'ADMIN'}));
  assert.equal(config.data().adminUser.user_id,'admin','Refresh restores staff login');
  app.adminUser=config.data().adminUser;
  app.logoutStaff();
  assert.equal(config.data().adminUser,null,'Logout clears saved login');
  storage.set('slam_staff_user','broken-json');
  assert.equal(config.data().adminUser,null,'Corrupt saved data cannot break startup');
  storage.set('slam_staff_user',JSON.stringify({user_id:'x',full_name:'X',role:'STUDENT'}));
  assert.equal(config.data().adminUser,null);
  storage.delete('slam_staff_user');
  assert.equal(app.staffLoginForm.pin,'');
  assert.equal(app.inputMssv,'');
  assert.ok(app.apiUrl.startsWith('https://script.google.com/macros/s/'));
  assert.equal(app.configApiUrl,app.apiUrl);
  app.apiUrl='';
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
