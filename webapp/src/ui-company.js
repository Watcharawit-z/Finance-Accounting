/* ===================================================================
   จัดการบริษัท — ลบบริษัทที่เพิ่มผิด กู้คืน และไฟล์สำรอง
   ลบแล้วไม่หายทันที: ดาวน์โหลดไฟล์สำรองให้ก่อน แล้วย้ายไปถังขยะ กู้คืนได้จนกว่าจะสั่งลบถาวร
   (พ.ร.บ.การบัญชี 2543 ให้เก็บบัญชีและเอกสารไว้ 5 ปี — ลบผิดเล่มแล้วหายเลยไม่ได้)
   =================================================================== */
const BACKUP_FORMAT = 'financii-backup/1';
const LS_TRASH = 'financii.trash';
const trashKey = (id) => 'financii.trash.' + id;
const COMPANY = { trash: [] };

/* ---------- เรียกเซิร์ฟเวอร์ ---------- */
async function companyApi(method, url, body) {
  const r = await fetch(url, { method, headers: syncHeaders(), body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error((j && j.error && j.error.message) || ('HTTP ' + r.status));
    e.code = j && j.error && j.error.code;
    throw e;
  }
  return j;
}

/* ---------- ไฟล์สำรอง ---------- */
function backupPayload(data) {
  return { format: BACKUP_FORMAT, exportedAt: new Date().toISOString(),
    company: data && data.company ? { name: data.company.name, taxId: data.company.taxId || null } : null,
    entries: data && Array.isArray(data.entries) ? data.entries.length : 0, DB: data };
}
/** ชื่อไฟล์เป็นอักษรอังกฤษ — เบราว์เซอร์บางตัวไม่ยอมตั้งชื่อไฟล์ภาษาไทย */
function backupFileName(data, book) {
  const tax = data && data.company && data.company.taxId ? String(data.company.taxId).replace(/\D/g, '') : '';
  const day = new Date().toISOString().slice(0, 10);
  return 'Financii-backup-' + (tax || String(book || 'book').replace(/[^A-Za-z0-9_-]/g, '')) + '-' + day + '.json';
}
function downloadBackup(data, book) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(backupPayload(data))], { type: 'application/json' }));
  a.download = backupFileName(data, book);
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return a.download;
}
/** ข้อมูลทั้งเล่มของบริษัทหนึ่ง — เล่มที่เปิดอยู่ใช้ของในหน่วยความจำ เล่มอื่นอ่านจากที่เก็บ */
async function bookData(book) {
  if (book === SYNC.book) return JSON.parse(JSON.stringify(DB));
  if (SYNC.mode === 'server') {
    const s = await companyApi('GET', '/api/state?book=' + encodeURIComponent(book));
    return s.data;
  }
  const raw = lsGet(bookKey(book));
  if (!raw) return null;
  const d = JSON.parse(raw);
  return d && d.DB ? d.DB : null;
}
function isBackupFile(pkg) { return !!pkg && pkg.format === BACKUP_FORMAT && pkg.DB && pkg.DB.company; }

/** สรุปสิ่งที่อยู่ในเล่ม — ให้เห็นก่อนกดลบว่ากำลังจะลบอะไร */
function bookSummary(data) {
  if (!data) return null;
  const docs = Object.keys(data.docs || {}).reduce((s, k) => s + ((data.docs[k] || []).length), 0);
  const imports = (data.entries || []).filter((e) => e.src === 'import' && e.status === 'posted').length;
  return { name: data.company ? data.company.name : '', taxId: data.company ? data.company.taxId : '',
    entries: (data.entries || []).length, docs, imports,
    closed: (data.periods || []).filter((p) => p.status === 'closed').length,
    demo: !!data.isDemo };
}

/* ---------- ถังขยะในเบราว์เซอร์ ---------- */
function localTrash() {
  try { const t = JSON.parse(lsGet(LS_TRASH) || '[]'); return Array.isArray(t) ? t : []; } catch (e) { return []; }
}
function localTrashWrite(list) { lsSet(LS_TRASH, JSON.stringify(list)); }

async function refreshTrash() {
  if (SYNC.mode === 'server') {
    try { COMPANY.trash = (await companyApi('GET', '/api/trash')).items || []; }
    catch (e) { COMPANY.trash = []; }
  } else {
    COMPANY.trash = localTrash();
  }
  return COMPANY.trash;
}

/* ---------- ลบบริษัท ---------- */
async function modalDeleteCompany(book) {
  const meta = (SYNC.books || []).find((b) => b.book === book) || { book, name: book };
  if ((SYNC.books || []).length < 2) {
    toast('ลบบริษัทสุดท้ายไม่ได้', 'err', 'ระบบต้องมีอย่างน้อย 1 บริษัท — เพิ่มบริษัทที่ถูกต้องก่อน แล้วค่อยลบบริษัทที่เพิ่มผิด');
    return;
  }
  let data = null;
  try { data = await bookData(book); } catch (e) { /* ไม่มีข้อมูลก็ยังลบได้ */ }
  const sum = bookSummary(data) || { name: meta.name, taxId: meta.taxId, entries: meta.entries || 0, docs: 0, imports: 0, closed: 0 };
  const name = String((data && data.company && data.company.name) || meta.name || book).trim();
  modal({
    title:'ลบบริษัท ' + name,
    sub:'สำหรับบริษัทที่เพิ่มผิด หรือนำเข้าผิดเล่ม — ลบแล้วกู้คืนได้จากถังขยะ',
    body:'<div class="void-prev"><b>สิ่งที่อยู่ในบริษัทนี้</b><ul>'
      + '<li>เลขประจำตัวผู้เสียภาษี ' + esc(sum.taxId || 'ยังไม่ได้กรอก') + (sum.demo ? ' · ข้อมูลตัวอย่าง' : '') + '</li>'
      + '<li>ใบสำคัญ ' + sum.entries + ' ใบ · เอกสาร ' + sum.docs + ' ใบ'
      + (sum.imports ? ' · นำเข้าจากไฟล์ ' + sum.imports + ' ครั้ง' : '') + (sum.closed ? ' · ปิดงวดแล้ว ' + sum.closed + ' งวด' : '') + '</li>'
      + '</ul><b>ระบบจะทำให้ตามลำดับ</b><ul>'
      + '<li>ดาวน์โหลดไฟล์สำรองของบริษัทนี้ลงเครื่อง (.json) — เปิดกลับมาได้ที่หน้านำเข้าข้อมูล</li>'
      + '<li>ย้ายบริษัทไปถังขยะ ไม่ปรากฏในรายชื่อบริษัทอีก กู้คืนได้จากหน้าตั้งค่า</li>'
      + (book === SYNC.book ? '<li>สลับไปเปิดบริษัทอื่นให้</li>' : '')
      + '</ul></div>'
      + (sum.entries && !sum.demo ? '<div class="note">บริษัทนี้มีรายการบัญชีแล้ว ถ้าเป็นบริษัทที่ใช้งานจริง พ.ร.บ.การบัญชีกำหนดให้เก็บบัญชีไว้ 5 ปี '
        + 'ควรลบเฉพาะเล่มที่เพิ่มผิดหรือซ้ำเท่านั้น</div>' : '')
      + '<div class="flds">'
      + field({ name:'confirmName', label:'พิมพ์ชื่อบริษัทให้ตรงเพื่อยืนยัน', wide:true, placeholder: name })
      + field({ name:'reason', label:'เหตุผล', wide:true, placeholder:'เช่น เพิ่มซ้ำ / นำเข้าผิดบริษัท — อย่างน้อย 5 ตัวอักษร' })
      + '</div>',
    submitLabel:'ย้ายไปถังขยะ', submitKind:'danger',
    onSubmit: function () { deleteCompany(book, name, data); },
  });
}

async function deleteCompany(book, name, data) {
  const typed = val('confirmName').trim();
  const reason = val('reason').trim();
  if (typed !== name) { toast('ชื่อบริษัทที่พิมพ์ไม่ตรง', 'err', 'ต้องพิมพ์ว่า "' + name + '" ทุกตัวอักษร'); return; }
  if (reason.length < 5) { toast('ต้องระบุเหตุผลอย่างน้อย 5 ตัวอักษร', 'err'); return; }
  try {
    const wasActive = book === SYNC.book;
    if (wasActive) {
      if (SYNC.mode === 'server') { clearTimeout(SYNC.timer); if (SYNC.pending) await syncPush(); }
      else booksSaveActive();
      data = JSON.parse(JSON.stringify(DB));
    }
    const file = data ? downloadBackup(data, book) : null;
    if (SYNC.mode === 'server') {
      await companyApi('DELETE', '/api/books?book=' + encodeURIComponent(book), { confirmName: name, reason });
      await syncBooks();
    } else {
      const raw = lsGet(bookKey(book));
      const tid = 't' + Date.now().toString(36);
      const kept = raw ? lsSet(trashKey(tid), raw) : false;
      const list = localTrash();
      if (kept) {
        list.unshift({ id: tid, book, name, taxId: data && data.company ? data.company.taxId : null,
          entries: data ? (data.entries || []).length : 0, reason, deletedAt: new Date().toISOString() });
        localTrashWrite(list);
      }
      lsDel(bookKey(book));
      booksWrite(booksList().filter((b) => b.id !== book));
      SYNC.books = booksList().map((b) => ({ book: b.id, name: b.name, taxId: b.taxId, entries: b.entries || 0 }));
      if (!kept) toast('พื้นที่เก็บในเบราว์เซอร์ไม่พอสำหรับถังขยะ', 'err', 'ใช้ไฟล์สำรองที่ดาวน์โหลดไว้เพื่อกู้คืน');
    }
    closeModal();
    if (wasActive) {
      const next = (SYNC.books || []).find((b) => b.book !== book);
      SYNC.book = '';
      if (next) await openCompanyAfterDelete(next.book);
    }
    await refreshTrash();
    render();
    toast('ย้าย ' + name + ' ไปถังขยะแล้ว', 'ok', (file ? 'ไฟล์สำรอง ' + file + ' · ' : '') + 'กู้คืนได้ที่หน้าตั้งค่า');
  } catch (e) {
    console.error(e);
    toast('ลบบริษัทไม่สำเร็จ', 'err', e.message);
  }
}
async function openCompanyAfterDelete(book) {
  if (SYNC.mode === 'server') {
    SYNC.book = book; SYNC.version = 0;
    await syncPull();
  } else {
    SYNC.book = book;
    booksLoadLocal(book);
  }
  STATE.screen = 'settings'; STATE.sel = null; STATE.drill = null; STATE.imp = null; STATE.impResult = null;
  if (DB.periods && DB.periods.length && !DB.periods.some((p) => p.code === STATE.period)) STATE.period = DB.periods[DB.periods.length - 1].code;
}

/* ---------- กู้คืน / ลบถาวร ---------- */
async function restoreCompany(id) {
  try {
    let book;
    if (SYNC.mode === 'server') {
      book = (await companyApi('POST', '/api/trash/restore?id=' + encodeURIComponent(id))).book;
      await syncBooks();
    } else {
      const t = localTrash().find((x) => x.id === id);
      const raw = t && lsGet(trashKey(id));
      if (!raw) throw new Error('ไม่พบข้อมูลในถังขยะ');
      const taken = new Set(booksList().map((b) => b.id));
      book = t.book;
      for (let n = 2; taken.has(book); n++) book = t.book + '-' + n;
      if (!lsSet(bookKey(book), raw)) throw new Error('พื้นที่เก็บในเบราว์เซอร์ไม่พอ');
      booksWrite(booksList().concat([{ id: book, name: t.name, taxId: t.taxId, entries: t.entries }]));
      localTrashWrite(localTrash().filter((x) => x.id !== id));
      lsDel(trashKey(id));
      SYNC.books = booksList().map((b) => ({ book: b.id, name: b.name, taxId: b.taxId, entries: b.entries || 0 }));
    }
    await refreshTrash();
    render();
    toast('กู้คืนบริษัทแล้ว', 'ok', 'เลือกเปิดได้ที่รายชื่อบริษัทมุมซ้ายบน');
    return book;
  } catch (e) {
    toast('กู้คืนไม่สำเร็จ', 'err', e.message);
    return null;
  }
}
function modalPurgeCompany(id) {
  const t = COMPANY.trash.find((x) => String(x.id) === String(id));
  if (!t) return;
  modal({
    title:'ลบถาวร ' + t.name,
    sub:'ลบออกจากถังขยะแล้วกู้คืนในระบบไม่ได้อีก (ยังเปิดจากไฟล์สำรองที่ดาวน์โหลดไว้ได้)',
    body:'<div class="flds">' + field({ name:'confirmName', label:'พิมพ์ชื่อบริษัทให้ตรงเพื่อยืนยัน', wide:true, placeholder: t.name }) + '</div>',
    submitLabel:'ลบถาวร', submitKind:'danger',
    onSubmit: async function () {
      if (val('confirmName').trim() !== String(t.name).trim()) { toast('ชื่อบริษัทที่พิมพ์ไม่ตรง', 'err'); return; }
      try {
        if (SYNC.mode === 'server') await companyApi('DELETE', '/api/trash?id=' + encodeURIComponent(id), { confirmName: t.name });
        else { localTrashWrite(localTrash().filter((x) => x.id !== id)); lsDel(trashKey(id)); }
        closeModal();
        await refreshTrash();
        render();
        toast('ลบ ' + t.name + ' ถาวรแล้ว', 'ok');
      } catch (e) { toast('ลบไม่สำเร็จ', 'err', e.message); }
    },
  });
}

/* ---------- เปิดไฟล์สำรองเป็นบริษัทใหม่ ---------- */
async function restoreBackupFile(pkg, fileName) {
  const data = pkg.DB;
  /* ตรวจว่าเปิดได้จริงก่อนแตะบริษัทที่เปิดอยู่ */
  if (!data || !data.company || !Array.isArray(data.entries) || !Array.isArray(data.periods) || !data.periods.length) {
    toast('ไฟล์สำรองนี้เปิดไม่ได้', 'err', 'ไม่พบข้อมูลกิจการ รายการบัญชี หรืองวดบัญชีในไฟล์');
    return;
  }
  if (SYNC.mode === 'server') { clearTimeout(SYNC.timer); if (SYNC.pending) await syncPush(); }
  else booksSaveActive();
  const id = booksNewId(data.company.name);
  SYNC.book = id;
  SYNC.version = 0;
  loadState(JSON.parse(JSON.stringify(data)));
  STATE.period = DB.periods.length ? DB.periods[DB.periods.length - 1].code : STATE.period;
  STATE.screen = 'dashboard'; STATE.sel = null; STATE.imp = null; STATE.impResult = null;
  if (SYNC.mode === 'server') { await syncPush(); await syncBooks(); }
  else booksSaveActive();
  render();
  toast('เปิดไฟล์สำรอง ' + fileName + ' เป็นบริษัท ' + DB.company.name + ' แล้ว', 'ok',
    DB.entries.length + ' ใบสำคัญ · เป็นเล่มแยก ไม่ทับบริษัทเดิม');
}

/* ---------- การ์ดในหน้าตั้งค่า ---------- */
function companiesCard() {
  const books = SYNC.books || [];
  const trash = COMPANY.trash || [];
  return card({
    title:'บริษัทในระบบ', sub: books.length + ' บริษัท · ' + (SYNC.mode === 'server' ? 'เก็บบนเซิร์ฟเวอร์ ทุกเครื่องเห็นชุดเดียวกัน' : 'เก็บในเบราว์เซอร์เครื่องนี้'),
    actions: btn('company:backup', 'ดาวน์โหลดไฟล์สำรองของบริษัทนี้') + btn('company:new', '+ เพิ่มบริษัท', 'primary'),
    noExport: true,
    body: tbl({
      cols:[{t:'บริษัท'},{t:'เลขประจำตัวผู้เสียภาษี'},{t:'ใบสำคัญ',a:'r'},{t:''},{t:''}],
      rows: books.map((b) => [b.name || b.book, b.taxId ? {mono:b.taxId} : {dim:'—'}, {c:String(b.entries || 0)},
        b.book === SYNC.book ? {st:['paid','เปิดอยู่']} : {html: btn('company:open:' + b.book, 'เปิด')},
        {html: btn('company:delete:' + b.book, 'ลบ…', 'danger', books.length < 2 ? ' disabled title="ต้องมีอย่างน้อย 1 บริษัท"' : '')}]),
      empty:'ยังไม่มีบริษัท',
    })
    + (trash.length ? '<div class="sub-h">ถังขยะ — บริษัทที่ลบแล้ว กู้คืนได้</div>' + tbl({
      cols:[{t:'บริษัท'},{t:'ใบสำคัญ',a:'r'},{t:'ลบเมื่อ'},{t:'เหตุผล'},{t:''},{t:''}],
      rows: trash.map((t) => [t.name, {c:String(t.entries || 0)}, thDate(String(t.deletedAt || '').slice(0, 10)), t.reason || {dim:'—'},
        {html: btn('company:restore:' + t.id, 'กู้คืน')}, {html: btn('company:purge:' + t.id, 'ลบถาวร…', 'danger')}]),
    }) : ''),
    foot:'ลบบริษัทที่เพิ่มผิดได้ที่ปุ่ม "ลบ…" — ระบบดาวน์โหลดไฟล์สำรองให้ก่อนทุกครั้ง แล้วย้ายไปถังขยะ · '
      + 'เปิดไฟล์สำรองกลับมาได้ที่ ระบบ → นำเข้าข้อมูลจากระบบเดิม (ลากไฟล์ .json วาง)',
  });
}

/** คำสั่ง company:* — คืน true ถ้ารับไปจัดการ */
function companyDispatch(arg, rest) {
  const what = rest[0], id = rest.slice(1).join(':');
  if (what === 'manage') { STATE.screen = 'settings'; STATE.sel = null; refreshTrash().then(render); return true; }
  if (what === 'open') { switchCompany(id); return true; }
  if (what === 'delete') { modalDeleteCompany(id); return true; }
  if (what === 'restore') { restoreCompany(id); return true; }
  if (what === 'purge') { modalPurgeCompany(id); return true; }
  if (what === 'backup') { const f = downloadBackup(JSON.parse(JSON.stringify(DB)), SYNC.book); toast('ดาวน์โหลด ' + f + ' แล้ว', 'ok', 'เก็บไว้ที่ปลอดภัย เปิดกลับมาได้ที่หน้านำเข้าข้อมูล'); return true; }
  return false;
}
