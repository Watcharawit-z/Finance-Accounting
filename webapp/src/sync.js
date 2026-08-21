/* ===================================================================
   ซิงก์ข้อมูลกับเซิร์ฟเวอร์
   ถ้าเซิร์ฟเวอร์ต่อฐานข้อมูลไว้ ทุกเครื่องจะเห็นข้อมูลชุดเดียวกัน
   ถ้าไม่ได้ต่อ ก็กลับไปเก็บในเบราว์เซอร์เหมือนเดิม ไม่ต้องแก้อะไร
   =================================================================== */
const SYNC = {
  mode: 'browser',        // 'browser' | 'server'
  version: 0,
  needsPasscode: false,
  passcode: '',
  status: 'idle',         // idle | saving | saved | error | conflict | locked
  message: '',
  pending: false,
  timer: null,
  retry: null,
};
const PASS_KEY = 'duly.passcode';

/** ส่วนหัวของ HTTP รับได้แค่ ASCII รหัสผ่านภาษาไทยจึงต้องแปลงเป็น base64 ก่อนส่ง */
function encodePass(s) {
  const bytes = new TextEncoder().encode(String(s));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
const syncHeaders = () => {
  const h = { 'content-type': 'application/json' };
  if (SYNC.passcode) h['x-passcode'] = encodePass(SYNC.passcode);
  return h;
};

function setStatus(s, msg) {
  SYNC.status = s;
  SYNC.message = msg || '';
  const el = document.getElementById('syncTag');
  if (!el) return;
  const map = {
    idle:     ['', ''],
    saving:   ['saving', 'กำลังบันทึก…'],
    saved:    ['saved', 'บันทึกขึ้นเซิร์ฟเวอร์แล้ว'],
    error:    ['error', 'บันทึกไม่สำเร็จ'],
    conflict: ['error', 'มีการแก้จากอีกเครื่อง'],
    locked:   ['error', 'ต้องใส่รหัสผ่าน'],
  };
  const m = map[s] || ['', ''];
  el.className = 'sync-tag ' + m[0];
  el.textContent = SYNC.mode === 'server' ? m[1] : '';
  el.title = SYNC.message;
}

async function syncConfig() {
  /* เปิดไฟล์ตรง ๆ จากเครื่อง ไม่มีเซิร์ฟเวอร์ให้ถาม และการเรียก fetch จะพ่นข้อผิดพลาดเปล่า ๆ */
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return false;
  try {
    const r = await fetch('/api/config');
    if (!r.ok) return false;
    const c = await r.json();
    SYNC.mode = c.storage === 'server' ? 'server' : 'browser';
    SYNC.needsPasscode = Boolean(c.needsPasscode);
    return SYNC.mode === 'server';
  } catch (e) {
    return false;                       // เปิดจากไฟล์ในเครื่อง ไม่มีเซิร์ฟเวอร์
  }
}

/** ดึงข้อมูลจากเซิร์ฟเวอร์ — คืน 'ok' | 'empty' | 'locked' | 'error' */
async function syncPull() {
  try {
    const r = await fetch('/api/state', { headers: syncHeaders() });
    if (r.status === 401) { setStatus('locked'); return 'locked'; }
    if (!r.ok) { setStatus('error', 'อ่านข้อมูลจากเซิร์ฟเวอร์ไม่ได้'); return 'error'; }
    const s = await r.json();
    SYNC.version = s.version || 0;
    if (!s.data) return 'empty';
    Object.keys(s.data).forEach(function (k) { DB[k] = s.data[k]; });
    if (DB.isDemo === undefined) DB.isDemo = DB.company.name === 'บริษัท ศรีวัฒนาการค้า จำกัด';
    setStatus('saved', 'ดึงข้อมูลรุ่นที่ ' + SYNC.version + ' มาแล้ว');
    return 'ok';
  } catch (e) {
    setStatus('error', e.message);
    return 'error';
  }
}

async function syncPush() {
  if (SYNC.mode !== 'server') return;
  SYNC.pending = false;
  setStatus('saving');
  try {
    const r = await fetch('/api/state', {
      method: 'PUT',
      headers: syncHeaders(),
      body: JSON.stringify({ version: SYNC.version, data: DB }),
    });
    if (r.status === 401) { setStatus('locked'); return; }
    if (r.status === 409) {
      /* อีกเครื่องบันทึกแทรกเข้ามา — ไม่เขียนทับ ให้ดึงของใหม่มาแทน
         ข้อมูลบัญชีหายเงียบ ๆ ไม่ได้ ต้องบอกให้รู้ทุกครั้ง */
      const s = await r.json();
      SYNC.version = s.version || 0;
      if (s.data) Object.keys(s.data).forEach(function (k) { DB[k] = s.data[k]; });
      setStatus('conflict');
      toast('มีการบันทึกจากอีกเครื่อง', 'err',
        'ระบบดึงข้อมูลล่าสุดมาแสดงแทนแล้ว สิ่งที่เพิ่งทำอาจต้องทำซ้ำ');
      render();
      return;
    }
    if (!r.ok) {
      const b = await r.json().catch(() => null);
      setStatus('error', (b && b.error && b.error.message) || ('HTTP ' + r.status));
      scheduleRetry();
      return;
    }
    const b = await r.json();
    SYNC.version = b.version;
    setStatus('saved', 'รุ่นที่ ' + SYNC.version);
  } catch (e) {
    setStatus('error', e.message);
    scheduleRetry();
  }
}

function scheduleRetry() {
  clearTimeout(SYNC.retry);
  SYNC.retry = setTimeout(function () { if (SYNC.pending || SYNC.status === 'error') syncPush(); }, 5000);
}

/** รวบการบันทึกหลายครั้งติดกันให้ยิงครั้งเดียว */
function syncSave() {
  SYNC.pending = true;
  clearTimeout(SYNC.timer);
  SYNC.timer = setTimeout(syncPush, 500);
}

function syncPasscodeScreen(wrong) {
  return card({
    title:'ใส่รหัสผ่านเพื่อเปิดสมุดบัญชี',
    sub:'ข้อมูลชุดนี้เก็บบนเซิร์ฟเวอร์ร่วมกัน จึงต้องใส่รหัสผ่านก่อน',
    body:'<div class="flds">'
      + field({ name:'passcode', label:'รหัสผ่าน', type:'password', wide:true,
          hint: wrong ? 'รหัสผ่านไม่ถูกต้อง ลองใหม่อีกครั้ง' : 'ผู้ดูแลเป็นผู้ตั้งไว้ในตัวแปร APP_PASSCODE' })
      + '</div>',
    foot: btn('pass:submit', 'เปิดสมุดบัญชี', 'primary'),
  });
}

async function syncUnlock(code) {
  SYNC.passcode = code;
  const r = await syncPull();
  if (r === 'locked') { SYNC.passcode = ''; return false; }
  try { localStorage.setItem(PASS_KEY, code); } catch (e) { /* ปิดการเก็บข้อมูลไว้ */ }
  if (r === 'empty') { buildSeed(); await syncPush(); }
  return true;
}
