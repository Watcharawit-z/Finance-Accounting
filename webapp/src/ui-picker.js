/* ===================================================================
   ช่องเลือกที่ค้นหาได้ — รายการยาว (ผังบัญชี ผู้ติดต่อ สินค้า) ไม่ต้องเลื่อนหา
   ช่องเลือกที่มีตัวเลือกตั้งแต่ PICK_MIN รายการขึ้นไป กดแล้วเปิดกล่องค้นหาแทนรายการของเบราว์เซอร์
   พิมพ์รหัสหรือชื่อบางส่วนได้ (หลายคำ = ต้องเจอทุกคำ) · ลูกศรขึ้นลงเลือก · Enter ตกลง · Esc ปิด
   ค่าที่เลือกเขียนกลับไปที่ช่องเลือกเดิมแล้วส่ง change — โค้ดฟอร์มทุกที่อ่านค่าแบบเดิมได้เลย
   ไม่ต้องการให้ค้นหา ใส่ data-nosearch ที่ช่องนั้น
   =================================================================== */
const PICK_MIN = 15;
let PICK = null;          // { sel, items, shown, at }

const pickable = (sel) => !!sel && sel.tagName === 'SELECT' && !sel.disabled && !sel.multiple
  && !sel.hasAttribute('data-nosearch') && sel.options.length >= PICK_MIN;
/** ข้อความที่ใช้ค้น — ตัวพิมพ์เล็ก ช่องว่างเดียว */
const pickNorm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function pickItems(sel) {
  const out = [];
  Array.from(sel.options).forEach(function (o) {
    const g = o.parentElement && o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : '';
    out.push({ value: o.value, text: o.textContent, group: g, disabled: o.disabled, key: pickNorm(g + ' ' + o.textContent) });
  });
  return out;
}
/** ตัวเลือกที่ปิดไว้ (เช่น บัญชีคุม) ยังแสดงให้เห็นพร้อมเหตุผล แต่เลือกไม่ได้ */
function pickFilter(q) {
  const words = pickNorm(q).split(' ').filter(Boolean);
  return PICK.items.filter((it) => words.every((w) => it.key.indexOf(w) >= 0));
}
/** ขยับไปตัวเลือกถัดไปที่เลือกได้ */
function pickStep(from, dir) {
  const n = PICK.shown.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + dir * k + n * k) % n;
    if (!PICK.shown[i].disabled) return i;
  }
  return -1;
}
function pickRender() {
  const box = document.getElementById('selPick');
  const list = box.querySelector('.sp-list');
  const q = box.querySelector('input').value;
  PICK.shown = pickFilter(q);
  if (!PICK.shown[PICK.at] || PICK.shown[PICK.at].disabled) PICK.at = pickStep(-1, 1);
  let g = null, h = '';
  PICK.shown.forEach(function (it, i) {
    if (it.group && it.group !== g) { g = it.group; h += '<div class="sp-g">' + esc(g) + '</div>'; }
    h += '<div class="sp-i' + (i === PICK.at ? ' on' : '') + (it.value === PICK.sel.value ? ' cur' : '') + (it.disabled ? ' off' : '')
      + '" role="option" aria-selected="' + (i === PICK.at) + '"' + (it.disabled ? ' aria-disabled="true"' : '')
      + ' data-i="' + i + '">' + esc(it.text) + '</div>';
  });
  list.innerHTML = h || '<div class="sp-none">ไม่พบ "' + esc(q) + '" — ลองพิมพ์รหัสหรือบางส่วนของชื่อ</div>';
  const on = list.querySelector('.sp-i.on');
  if (on) on.scrollIntoView({ block: 'nearest' });
  const real = (x) => x.value !== '';
  box.querySelector('.sp-n').textContent = PICK.shown.filter(real).length + ' จาก ' + PICK.items.filter(real).length;
}
function pickPlace() {
  const box = document.getElementById('selPick');
  const r = PICK.sel.getBoundingClientRect();
  const w = Math.min(Math.max(r.width, 320), window.innerWidth - 16);
  const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
  const below = window.innerHeight - r.bottom - 8, above = r.top - 8;
  const up = below < 260 && above > below;
  box.style.width = w + 'px';
  box.style.left = left + 'px';
  box.style.maxHeight = Math.max(180, Math.min(420, up ? above : below)) + 'px';
  if (up) { box.style.top = ''; box.style.bottom = (window.innerHeight - r.top + 4) + 'px'; }
  else { box.style.bottom = ''; box.style.top = (r.bottom + 4) + 'px'; }
}
function openPicker(sel, q) {
  let box = document.getElementById('selPick');
  if (!box) {
    box = document.createElement('div');
    box.id = 'selPick';
    box.setAttribute('role', 'dialog');
    box.innerHTML = '<div class="sp-h"><input type="search" autocomplete="off" spellcheck="false" aria-label="ค้นหา"'
      + ' placeholder="พิมพ์รหัสหรือชื่อเพื่อค้นหา"><span class="sp-n"></span></div><div class="sp-list" role="listbox"></div>';
    document.body.appendChild(box);
    const input = box.querySelector('input');
    input.addEventListener('input', function () { PICK.at = 0; pickRender(); });
    input.addEventListener('keydown', pickKey);
    /* mousedown ไม่ให้ช่องค้นหาเสียโฟกัสก่อนคลิกเลือก */
    box.addEventListener('mousedown', function (ev) { if (ev.target.tagName !== 'INPUT') ev.preventDefault(); });
    box.addEventListener('click', function (ev) {
      const it = ev.target.closest('.sp-i');
      if (it) pickChoose(Number(it.getAttribute('data-i')));
    });
  }
  const items = pickItems(sel);
  PICK = { sel, items, shown: [], at: 0 };
  const cur = items.findIndex((x) => x.value === sel.value && x.value !== '' && !x.disabled);
  const input = box.querySelector('input');
  input.value = q || '';
  box.classList.add('show');
  pickPlace();
  pickRender();
  /* ยังไม่พิมพ์อะไร — ชี้ที่ค่าที่เลือกอยู่ */
  if (!q && cur >= 0) { PICK.at = cur; pickRender(); }
  input.focus();
}
function closePicker(refocus) {
  const box = document.getElementById('selPick');
  if (!box || !box.classList.contains('show')) return false;
  box.classList.remove('show');
  const sel = PICK && PICK.sel;
  PICK = null;
  if (refocus && sel && document.body.contains(sel)) sel.focus();
  return true;
}
function pickChoose(i) {
  const it = PICK && PICK.shown[i];
  if (!it || it.disabled) return;
  const sel = PICK.sel;
  const changed = sel.value !== it.value;
  sel.value = it.value;
  closePicker(true);
  if (changed) {
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
function pickKey(ev) {
  /* Enter และ Esc ในกล่องค้นหาไม่ไปถึงฟอร์ม — ไม่งั้น Enter บันทึกฟอร์มทั้งใบ Esc ปิดฟอร์ม */
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    const i = PICK.shown.length ? pickStep(PICK.at < 0 ? -1 : PICK.at, ev.key === 'ArrowDown' ? 1 : -1) : -1;
    if (i >= 0) { PICK.at = i; pickRender(); }
  } else if (ev.key === 'Enter') {
    ev.preventDefault(); ev.stopPropagation();
    pickChoose(PICK.at);
  } else if (ev.key === 'Escape') {
    ev.preventDefault(); ev.stopPropagation();
    closePicker(true);
  } else if (ev.key === 'Tab') {
    closePicker(false);
  }
}

/* คลิกช่องเลือกที่ยาว → เปิดกล่องค้นหาแทนรายการของเบราว์เซอร์ */
document.addEventListener('mousedown', function (ev) {
  const box = document.getElementById('selPick');
  if (box && box.classList.contains('show') && !box.contains(ev.target)) {
    const same = PICK && ev.target === PICK.sel;
    closePicker(false);
    if (same) { ev.preventDefault(); return; }
  }
  const sel = ev.target.closest && ev.target.closest('select');
  if (ev.button === 0 && pickable(sel)) { ev.preventDefault(); sel.focus(); openPicker(sel, ''); }
});
/* โฟกัสอยู่ที่ช่องเลือก (กด Tab มา) แล้วพิมพ์ตัวอักษร Enter Space หรือลูกศรลง → เปิดกล่องค้นหา ตัวที่พิมพ์เป็นคำค้น */
document.addEventListener('keydown', function (ev) {
  const sel = ev.target;
  if (!pickable(sel) || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const ch = ev.key.length === 1 && ev.key !== ' ' ? ev.key : '';
  if (ch || ev.key === 'Enter' || ev.key === ' ' || ev.key === 'ArrowDown') {
    ev.preventDefault(); ev.stopPropagation();
    openPicker(sel, ch);
  }
}, true);
/* เลื่อนหน้าหรือย่อขยายหน้าต่าง — ปิดกล่อง (ตำแหน่งจะไม่ตรงกับช่องแล้ว) ยกเว้นเลื่อนรายการในกล่องเอง */
document.addEventListener('scroll', function (ev) {
  const box = document.getElementById('selPick');
  if (box && box.classList.contains('show') && !box.contains(ev.target)) closePicker(false);
}, true);
window.addEventListener('resize', function () { closePicker(false); });
