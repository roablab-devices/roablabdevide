const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '../Code.gs'), 'utf8');
let count = 0;
function setup(status = 'Trong kho', holder = '') {
  let writes = 0;
  const devices = [['header'], ['D1', 'Device', '', '', '', '', '', '', status, holder, '', '', '']];
  const logs = [['header']];
  const users = [['ID','PIN','Name','Phone','Role','Khóa'],
    ['admin','old-admin-pin','Admin','','ADMIN'],
    ['inspector','old-inspector-pin','Inspector','','INSPECTOR']];
  const cache = new Map();
  function sheet(rows) {
    return {
      getDataRange: () => ({getValues: () => rows.map(r => [...r])}),
      getLastRow: () => rows.length,
      appendRow: row => { writes++; rows.push(row); },
      getRange: (r,c) => ({
        setValue: value => { writes++; rows[r-1][c-1] = value; },
        setFormula: value => { writes++; rows[r-1][c-1] = value; }
      })
    };
  }
  const sheets = {Devices: sheet(devices), Logs: sheet(logs), Users: sheet(users)};
  const ctx = vm.createContext({
    SpreadsheetApp: {getActiveSpreadsheet: () => ({getSheetByName: n => sheets[n]}), flush() {}},
    LockService: {getScriptLock: () => ({waitLock() {}, releaseLock() {}})},
    CacheService: {getScriptCache: () => ({get: k => cache.get(k), put: (k,v) => cache.set(k,v), remove: k => cache.delete(k)})},
    ContentService: {MimeType: {JSON: 'json'}, createTextOutput: text => ({setMimeType: () => JSON.parse(text)})},
    Utilities: {formatDate: () => '2026-11-03'},
    // Invalid transactions must never reach an upload.
    DriveApp: {getRootFolder: () => {throw Error('Unexpected upload');}}
  });
  vm.runInContext(source, ctx);
  return {ctx, devices, logs, users, writes: () => writes,
    post: p => ctx.doPost({postData: {contents: JSON.stringify(p)}})};
}
const base = {action:'transaction', tx_type:'Mượn mới', user_id:'sv01', user_name:'An', device_ids:['D1']};
function rejected(status, holder, extra) {
  const s = setup(status, holder);
  assert.equal(s.post({...base, ...extra}).success, false);
  assert.equal(s.writes(), 0, 'Rejected requests must have no writes');
  count++;
}
rejected('Đang mượn', 'sv02', {});
rejected('Báo lỗi/Khóa', '', {});
rejected('Trong kho', 'sv02', {});
rejected('Đang mượn', 'sv02', {tx_type:'Trả về kho'});
rejected('Trong kho', '', {tx_type:'Trả về kho'});
rejected('Đang mượn', 'sv02', {tx_type:'Nhận bàn giao tay đôi'});
rejected('Trong kho', '', {tx_type:'invalid'});
rejected('Trong kho', '', {device_ids:['D1','missing']});
rejected('Trong kho', '', {device_ids:['D1','d1']});
rejected('Trong kho', '', {device_ids:'D1'});
rejected('Trong kho', '', {device_ids:[{}]});
rejected('Đang mượn', 'sv01', {tx_type:'Trả về kho', return_condition:'invalid'});
{
  const s = setup();
  assert.equal(s.post({...base, note:'=1+1', project_tag:'=2+2'}).success, true);
  assert.equal(s.devices[1][8], 'Đang mượn');
  assert.equal(s.devices[1][9], 'sv01');
  assert.equal(s.logs[1][8], "'=1+1");
  assert.equal(s.devices[1][11], "'=2+2");
  const before = s.writes();
  assert.equal(s.post({...base, user_id:'sv02'}).success, false);
  assert.equal(s.writes(), before);
  count++;
}
for (const condition of ['Hoạt động tốt - Đủ đồ','Thiếu phụ kiện','Báo lỗi/Hỏng']) {
  const s = setup('Đang mượn', 'sv01');
  assert.equal(s.post({...base, tx_type:'Trả về kho', return_condition:condition}).success, true);
  assert.equal(s.devices[1][8], 'Chờ kiểm định');
  assert.equal(s.devices[1][9], '');
  count++;
}
{
  const s = setup();
  assert.equal(s.post({action:'admin_save_device', device_id:'D1', name:'=1+1', accessories:'=3+3'}).success, true);
  assert.equal(s.devices[1][1], "'=1+1");
  assert.equal(s.devices[1][4], "'=3+3");
  assert.equal(s.post({action:'admin_save_device', device_id:'D2', name:'=4+4'}).success, true);
  assert.equal(s.devices[2][1], "'=4+4");
  s.logs.push(['now','T1']);
  assert.equal(s.post({action:'audit_transaction', tx_id:'T1', audit_note:'=5+5'}).success, true);
  assert.equal(s.logs.at(-1)[13], "'=5+5");
  for (const text of ['=1+1',' \t=1+1','+1','@x','-1',"'=1+1"]) {
    assert.equal(s.ctx.sheetText(text), "'" + text);
  }
  assert.equal(s.ctx.sheetText('Thiết bị A'), 'Thiết bị A');
  count++;
}
{
  const s = setup('Đang mượn', 'sv01');
  assert.equal(s.post({action:'admin_unlock', device_id:'D1'}).success, false);
  assert.equal(s.writes(), 0);
  const locked = setup('Báo lỗi/Khóa');
  assert.equal(locked.post({action:'admin_unlock', device_id:'D1'}).success, true);
  assert.equal(locked.devices[1][8], 'Trong kho');
  count++;
}
{
  const s = setup();
  const request = {action:'admin_change_password', admin_id:'admin', admin_pin:'old-admin-pin', target_id:'inspector', new_pin:'new-inspector-pin'};
  for (const extra of [{admin_id:'inspector', admin_pin:'old-inspector-pin'}, {admin_pin:'wrong'}, {target_id:'missing'}, {new_pin:'123'}, {new_pin:' secret123 '}]) {
    assert.equal(s.post({...request,...extra}).success, false);
    assert.equal(s.writes(), 0);
    count++;
  }
  assert.equal(s.post(request).success, true);
  assert.equal(s.post({action:'admin_login',user_id:'inspector',pin:'old-inspector-pin'}).success, false);
  assert.equal(s.post({action:'admin_login',user_id:'inspector',pin:'new-inspector-pin'}).success, true);
  assert.equal(s.post({...request,target_id:'admin',new_pin:'new-admin-pin'}).success, true);
  assert.equal(s.post(request).success, false, 'Old Admin password must stop authorizing changes');
  count++;
  const limited = setup();
  for (let i=0;i<5;i++) assert.equal(limited.post({...request,admin_pin:'wrong'}).success, false);
  assert.equal(limited.post(request).success, false, 'Throttle password-change attempts');
  assert.equal(limited.writes(), 0);
  count++;
}
for (const decision of ['Đã duyệt hợp lệ','Báo vi phạm']) {
  const s = setup('Đang mượn','sv01');
  const returned = s.post({...base,tx_type:'Trả về kho'});
  assert.equal(returned.success,true);
  const before=s.writes();
  assert.equal(s.post(base).success,false,'Cannot borrow before inspection');
  assert.equal(s.post({action:'admin_unlock',device_id:'D1'}).success,false,'Cannot bypass pending inspection');
  assert.equal(s.writes(),before);
  const audit={action:'audit_transaction',tx_id:returned.tx_id,audit_status:decision};
  assert.equal(s.post(audit).success,true);
  assert.equal(s.devices[1][8],decision === 'Đã duyệt hợp lệ' ? 'Trong kho' : 'Báo lỗi/Khóa');
  const after=s.writes();
  assert.equal(s.post(audit).success,false,'Cannot audit twice');
  assert.equal(s.writes(),after);
  count++;
}
{
  const s=setup('Chờ kiểm định');
  s.logs.push(['now','OLD','An','Trả về kho','D1','','','','','','','Chờ kiểm định']);
  s.logs.push(['now','NEW','An','Trả về kho','D1','','','','','','','Chờ kiểm định']);
  assert.equal(s.post({action:'audit_transaction',tx_id:'OLD',audit_status:'Đã duyệt hợp lệ'}).success,false);
  assert.equal(s.writes(),0);
  assert.equal(s.post({action:'audit_transaction',tx_id:'NEW',audit_status:'invalid'}).success,false);
  assert.equal(s.writes(),0);
  count++;
}
console.log(`PASS: ${count} backend security scenarios (offline Apps Script mocks)`);
