/* ตัวเรียก FlowAccount Open API — ขอ token แล้วไล่ดึงทีละหน้า */

const DEFAULTS = {
  baseUrl: 'https://openapi.flowaccount.com/v3-alpha',
  tokenUrl: 'https://openapi.flowaccount.com/token',
  scope: 'openapi',
  culture: 'th',
  pageSize: 100,
  maxPages: 500,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getToken(cfg) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: cfg.scope,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error('ขอ token ไม่สำเร็จ (HTTP ' + res.status + ') จาก ' + cfg.tokenUrl
      + '\n' + text.slice(0, 400)
      + '\nตรวจ clientId/clientSecret ที่ MyCompany → connection'
      + '\nถ้า 404 ให้แก้ tokenUrl ในไฟล์ตั้งค่าให้ตรงกับที่พอร์ทัลของคุณแจ้งไว้');
  }
  let json;
  try { json = JSON.parse(text); } catch (e) { throw new Error('token ตอบกลับไม่ใช่ JSON: ' + text.slice(0, 200)); }
  const token = json.access_token || json.accessToken || json.token;
  if (!token) throw new Error('ไม่พบ access_token ในคำตอบ: ' + text.slice(0, 200));
  return token;
}

/** ลองซ้ำเมื่อโดนจำกัดอัตราหรือเซิร์ฟเวอร์ขัดข้อง — ไม่ลองซ้ำเมื่อ 4xx อื่น เพราะซ้ำไปก็ผิดเหมือนเดิม */
async function apiGet(cfg, token, url, attempt) {
  attempt = attempt || 1;
  const res = await fetch(url, { headers: { authorization: 'Bearer ' + token, accept: 'application/json' } });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 5) throw new Error('เรียก ' + url + ' ไม่สำเร็จหลังลอง 5 ครั้ง (HTTP ' + res.status + ')');
    const wait = Math.pow(2, attempt) * 1000;
    process.stderr.write('  รอ ' + wait / 1000 + ' วินาทีแล้วลองใหม่ (HTTP ' + res.status + ')\n');
    await sleep(wait);
    return apiGet(cfg, token, url, attempt + 1);
  }
  const text = await res.text();
  if (!res.ok) throw new Error('HTTP ' + res.status + ' จาก ' + url + '\n' + text.slice(0, 400));
  try { return JSON.parse(text); } catch (e) { throw new Error('คำตอบไม่ใช่ JSON จาก ' + url); }
}

/** คำตอบของแต่ละ endpoint ห่ออาร์เรย์ไว้คนละชั้น จึงต้องมองหาหลายแบบ */
function pickArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const k of ['data', 'result', 'results', 'items', 'list', 'value', 'records']) {
    if (Array.isArray(data[k])) return data[k];
    if (data[k] && typeof data[k] === 'object') {
      const inner = pickArray(data[k]);
      if (inner.length) return inner;
    }
  }
  return [];
}

async function listAll(cfg, token, pathTpl, params, label) {
  const out = [];
  for (let page = 1; page <= cfg.maxPages; page++) {
    const qs = new URLSearchParams({ ...params, CurrentPage: String(page), PageSize: String(cfg.pageSize) });
    const url = cfg.baseUrl + pathTpl.replace('{culture}', cfg.culture) + '?' + qs;
    const data = await apiGet(cfg, token, url);
    const items = pickArray(data);
    out.push(...items);
    process.stderr.write('  ' + label + ' หน้า ' + page + ' ได้ ' + items.length + ' รายการ (รวม ' + out.length + ')\n');
    if (items.length < cfg.pageSize) break;
    if (page === cfg.maxPages) throw new Error(label + ': เกิน maxPages แล้วยังไม่หมด — แบ่งช่วงวันที่ให้สั้นลง');
  }
  return out;
}

const withDefaults = (cfg) => ({ ...DEFAULTS, ...cfg });

module.exports = { DEFAULTS, withDefaults, getToken, apiGet, listAll, pickArray };
