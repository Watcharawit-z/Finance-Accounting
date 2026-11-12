/* ===================================================================
   ซิงก์ข้อมูลกับเซิร์ฟเวอร์
   ถ้าเซิร์ฟเวอร์ต่อฐานข้อมูลไว้ ทุกเครื่องจะเห็นข้อมูลชุดเดียวกัน
   ถ้าไม่ได้ต่อ ก็กลับไปเก็บในเบราว์เซอร์เหมือนเดิม ไม่ต้องแก้อะไร
   =================================================================== */
const SYNC = {
  mode: 'browser',        // 'browser' | 'server'
  book: 'default',        // สมุดบัญชีที่เปิดอยู่ = หนึ่งบริษัท
  books: [],              // [{book, name, taxId, entries}]
  version: 0,
  needsPasscode: false,
  passcode: '',
  role: null,             // staff | owner — เซิร์ฟเวอร์บอกตามรหัสที่ใช้เข้า (ui-owner.js)
  ownerLogin: false,      // เซิร์ฟเวอร์ตั้งรหัสเจ้าของไว้
  ingest: false,          // เซิร์ฟเวอร์รับค่าแอดจากระบบอื่นได้ (ตั้ง APP_INGEST_KEY แล้ว)
  status: 'idle',         // idle | saving | saved | error | conflict | locked
  message: '',
  pending: false,
  timer: null,
  retry: null,
};
/* รหัสที่ใช้เข้า — จำไว้แค่จนปิดเบราว์เซอร์ (sessionStorage) เว้นแต่ติ๊ก "จำไว้ในเครื่องนี้" (localStorage)
   รุ่นก่อนจำไว้ถาวรใต้ชื่อ financii.passcode ทุกเครื่อง — ลบทิ้ง ทุกคนเข้าใหม่หนึ่งครั้ง */
const PASS_KEY = 'financii.pass.v2';
const OLD_PASS_KEYS = ['financii.passcode', 'duly.passcode'];
function passLoad() {
  try {
    OLD_PASS_KEYS.forEach((k) => localStorage.removeItem(k));
    return sessionStorage.getItem(PASS_KEY) || localStorage.getItem(PASS_KEY) || '';
  } catch (e) { return ''; }
}
function passSave(code, remember) {
  try {
    sessionStorage.setItem(PASS_KEY, code);
    if (remember) localStorage.setItem(PASS_KEY, code); else localStorage.removeItem(PASS_KEY);
  } catch (e) { /* ปิดการเก็บข้อมูลไว้ — ใช้ได้จนรีเฟรชหน้า */ }
}
function passForget() {
  try { sessionStorage.removeItem(PASS_KEY); localStorage.removeItem(PASS_KEY); OLD_PASS_KEYS.forEach((k) => localStorage.removeItem(k)); }
  catch (e) { /* ปิดการเก็บข้อมูลไว้ */ }
}

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
    SYNC.ownerLogin = Boolean(c.ownerLogin);
    SYNC.teamPassSet = c.teamPassSet !== false;
    return SYNC.mode === 'server';
  } catch (e) {
    return false;                       // เปิดจากไฟล์ในเครื่อง ไม่มีเซิร์ฟเวอร์
  }
}

/** ดึงข้อมูลจากเซิร์ฟเวอร์ — คืน 'ok' | 'empty' | 'locked' | 'error' */
async function syncBooks() {
  if (SYNC.mode !== 'server') return SYNC.books;
  try {
    const r = await fetch('/api/books', { headers: syncHeaders() });
    if (!r.ok) return SYNC.books;
    const b = await r.json();
    SYNC.books = b.books || [];
  } catch (e) { /* ไม่เป็นไร ใช้รายชื่อเดิมไปก่อน */ }
  return SYNC.books;
}

async function syncPull() {
  try {
    const r = await fetch('/api/state?book=' + encodeURIComponent(SYNC.book), { headers: syncHeaders() });
    if (r.status === 401) { setStatus('locked'); return 'locked'; }
    if (!r.ok) { setStatus('error', 'อ่านข้อมูลจากเซิร์ฟเวอร์ไม่ได้'); return 'error'; }
    const s = await r.json();
    SYNC.version = s.version || 0;
    if (!s.data) { loadState(null); return 'empty'; }
    loadState(s.data);          // ★ แทนที่ทั้งก้อน ไม่ผสมกับบริษัทที่เปิดอยู่ก่อนหน้า
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
    const r = await fetch('/api/state?book=' + encodeURIComponent(SYNC.book), {
      method: 'PUT',
      headers: syncHeaders(),
      body: JSON.stringify({ version: SYNC.version, data: DB }),
    });
    if (r.status === 401) { syncLocked(); return; }
    if (r.status === 409) {
      /* อีกเครื่องบันทึกแทรกเข้ามา — ไม่เขียนทับ ให้ดึงของใหม่มาแทน
         ข้อมูลบัญชีหายเงียบ ๆ ไม่ได้ ต้องบอกให้รู้ทุกครั้ง */
      const s = await r.json();
      SYNC.version = s.version || 0;
      if (s.data) loadState(s.data);
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
    syncBooks();                // ให้รายชื่อบริษัทอัปเดตชื่อและจำนวนรายการตาม
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
  const noTeam = SYNC.teamPassSet === false;
  return '<div class="login-w">' + card({
    title:'เข้าสู่ระบบ',
    sub:'ใส่รหัสผ่านของคุณ — ทีมบัญชีใช้รหัสทีม เจ้าของใช้รหัสเจ้าของ',
    body:'<div class="flds">'
      + field({ name:'passcode', label:'รหัสผ่าน', type:'password', wide:true,
          hint: wrong ? 'รหัสผ่านไม่ถูกต้อง ลองใหม่อีกครั้ง'
            : noTeam ? 'ยังไม่ได้ตั้งรหัสทีมบัญชี — ตอนนี้เข้าได้เฉพาะเจ้าของ (เข้าแล้วตั้งรหัสทีมได้ที่หน้าตั้งค่า)' : '' })
      + '<label class="chk-line"><input type="checkbox" name="passRemember"> จำไว้ในเครื่องนี้ (เฉพาะเครื่องส่วนตัว)</label>'
      + '</div>',
    foot: btn('pass:submit', 'เข้าสู่ระบบ', 'primary'),
  }) + '</div>';
}

/** รหัสใช้ไม่ได้แล้วระหว่างใช้งาน (เจ้าของเปลี่ยนรหัสทีม) — ลืมรหัสเดิม แล้วขึ้นหน้าเข้าสู่ระบบ */
function syncLocked() {
  passForget();
  SYNC.passcode = '';
  SYNC.role = null;
  setStatus('locked');
  STATE.passWrong = false;
  render();
  toast('ต้องเข้าสู่ระบบใหม่', 'err', 'รหัสผ่านเปลี่ยนแล้ว หรือหมดสิทธิ์ใช้รหัสเดิม');
}

/** สลับบริษัท — ต้องบันทึกของเดิมให้จบก่อน แล้วค่อยยกข้อมูลใหม่เข้ามาแทนทั้งก้อน */
async function syncSwitch(book) {
  if (SYNC.mode === 'server') {
    clearTimeout(SYNC.timer);
    if (SYNC.pending) await syncPush();
    SYNC.book = book;
    SYNC.version = 0;
    const r = await syncPull();
    if (r === 'empty') { loadState(null); return 'empty'; }
    return r;
  }
  booksSaveActive();
  SYNC.book = book;
  return booksLoadLocal(book) ? 'ok' : 'empty';
}

/** สิทธิ์ของรหัสที่ใช้อยู่ — เซิร์ฟเวอร์เป็นคนบอก (หน้าจอแค่ซ่อนเมนู ข้อมูลค่าแอดเซิร์ฟเวอร์ไม่ส่งให้รหัสร่วมอยู่แล้ว) */
async function syncMe() {
  if (SYNC.mode !== 'server') { SYNC.role = null; return null; }
  try {
    const r = await fetch('/api/me', { headers: syncHeaders() });
    if (!r.ok) { SYNC.role = null; return null; }
    const b = await r.json();
    SYNC.role = b.role || null;
    SYNC.ownerLogin = Boolean(b.ownerLogin);
    SYNC.ingest = Boolean(b.ingest);
    SYNC.teamPassSet = b.teamPassSet !== false;
    SYNC.teamPassFrom = b.teamPassFrom || null;
  } catch (e) { SYNC.role = null; }
  return SYNC.role;
}
/** ออกจากระบบ — ลืมรหัสที่จำไว้ในเบราว์เซอร์นี้ แล้วเปิดหน้าใหม่ (ใช้เครื่องร่วมกับน้องบัญชีต้องกดทุกครั้ง) */
function syncLogout() {
  passForget();
  SYNC.passcode = '';
  SYNC.role = null;
  location.reload();
}

async function syncUnlock(code, remember) {
  SYNC.passcode = code;
  const r = await syncPull();
  if (r === 'locked') { SYNC.passcode = ''; return false; }
  await syncMe();
  passSave(code, remember);
  if (r === 'empty') { buildSeed(); await syncPush(); }
  return true;
}
