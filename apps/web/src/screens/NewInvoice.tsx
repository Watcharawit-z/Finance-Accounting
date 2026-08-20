import { useEffect, useMemo, useState } from 'react';
import { DEMO, api, baht } from '../api';
import type { ApiError } from '../api';

interface Line { description: string; quantity: string; unitPrice: string; revenueSubType: string }

const EMPTY: Line = { description: '', quantity: '1', unitPrice: '', revenueSubType: 'sales_revenue' };

export function NewInvoice({ onIssued }: { onIssued: () => void }) {
  const [partners, setPartners] = useState<any[]>([]);
  const [partnerId, setPartnerId] = useState(DEMO.customerId);
  const [docDate, setDocDate] = useState('2026-07-31');
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<any | null>(null);

  useEffect(() => { api.partners().then(setPartners).catch(() => undefined); }, []);

  /**
   * ตัวเลขในหน้าจอเป็นเพียงการแสดงผลล่วงหน้า
   * ยอดที่ใช้จริงมาจากเซิร์ฟเวอร์เสมอ — ห้ามให้ฝั่งเบราว์เซอร์เป็นผู้ตัดสินตัวเลขภาษี
   */
  const preview = useMemo(() => {
    const base = lines.reduce((s, l) => {
      const q = Number(l.quantity || 0), p = Number(l.unitPrice || 0);
      return s + (Number.isFinite(q * p) ? q * p : 0);
    }, 0);
    const vat = Math.round(base * 7) / 100;
    return { base, vat, total: base + vat };
  }, [lines]);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function submit(issue: boolean) {
    setBusy(true); setError(null); setDone(null);
    try {
      const draft = await api.createInvoice({
        branchId: DEMO.branchId, partnerId, docDate,
        lines: lines
          .filter((l) => l.description.trim() && l.unitPrice)
          .map((l) => ({
            description: l.description.trim(),
            quantity: l.quantity || '1',
            unitPrice: l.unitPrice,
            revenueSubType: l.revenueSubType,
          })),
      });
      const result = issue ? await api.issueInvoice(draft.id) : draft;
      setDone(result);
      setLines([{ ...EMPTY }]);
      if (issue) setTimeout(onIssued, 1400);
    } catch (e: any) {
      setError(e.detail ?? { code: 'UNKNOWN', message: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-h"><h2>สร้างใบกำกับภาษีเต็มรูป</h2>
        <span className="dim" style={{ fontSize: 12 }}>ตามมาตรา 86/4</span></div>

      {error && (
        <div className="alert error">
          <b>{error.message}</b>
          {error.hint && <div>{error.hint}</div>}
          <div className="mono dim" style={{ marginTop: 4, fontSize: 11 }}>
            {error.code}{error.field ? ` · ฟิลด์ ${error.field}` : ''}
          </div>
        </div>
      )}
      {done && (
        <div className="alert ok">
          <b>{done.docNo ? `ออกใบกำกับภาษีเลขที่ ${done.docNo} และลงบัญชีแล้ว` : 'บันทึกฉบับร่างแล้ว'}</b>
          ยอดรวม {baht(done.grandTotal)} บาท
          {done.journalEntryId && ' · สร้างรายการบัญชีคู่เรียบร้อย'}
        </div>
      )}

      <div className="form">
        <div>
          <label htmlFor="partner">ลูกค้า</label>
          <select id="partner" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>{p.legal_name_th} ({p.tax_id ?? 'ไม่มีเลขภาษี'})</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="docdate">วันที่ใบกำกับภาษี</label>
          <input id="docdate" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
        </div>
        <div>
          <label>สาขา</label>
          <input value="สำนักงานใหญ่ (00000)" readOnly />
        </div>
        <div>
          <label>เลขที่</label>
          <input value="ออกให้เมื่อลงบัญชี" readOnly />
        </div>
      </div>

      <div className="lines">
        {lines.map((l, i) => (
          <div className="line-row" key={i}>
            <div>
              {i === 0 && <label>รายการสินค้าหรือบริการ</label>}
              <input value={l.description} placeholder="เช่น ชุดควบคุมมอเตอร์ MC-450"
                     onChange={(e) => setLine(i, { description: e.target.value })} />
            </div>
            <div>
              {i === 0 && <label>จำนวน</label>}
              <input className="num" value={l.quantity} inputMode="decimal"
                     onChange={(e) => setLine(i, { quantity: e.target.value })} />
            </div>
            <div>
              {i === 0 && <label>ราคา/หน่วย</label>}
              <input className="num" value={l.unitPrice} inputMode="decimal" placeholder="0.00"
                     onChange={(e) => setLine(i, { unitPrice: e.target.value })} />
            </div>
            <div>
              {i === 0 && <label>บัญชีรายได้</label>}
              <select value={l.revenueSubType} onChange={(e) => setLine(i, { revenueSubType: e.target.value })}>
                <option value="sales_revenue">รายได้จากการขาย</option>
                <option value="service_revenue">รายได้ค่าบริการ</option>
                <option value="rental_revenue">รายได้ค่าเช่า</option>
              </select>
            </div>
            <div>
              {i === 0 && <label>จำนวนเงิน</label>}
              <input className="num" readOnly
                     value={baht(Number(l.quantity || 0) * Number(l.unitPrice || 0))} />
            </div>
            <div>
              {i === 0 && <label>&nbsp;</label>}
              <button className="icon-btn" title="ลบบรรทัด" disabled={lines.length === 1}
                      onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>×</button>
            </div>
          </div>
        ))}
        <button className="btn" onClick={() => setLines((ls) => [...ls, { ...EMPTY }])}>
          + เพิ่มบรรทัด
        </button>
      </div>

      <div className="totals">
        <span>ฐานภาษี <b>{baht(preview.base)}</b></span>
        <span>ภาษีมูลค่าเพิ่ม 7% <b>{baht(preview.vat)}</b></span>
        <span>รวมทั้งสิ้น <b>{baht(preview.total)}</b></span>
      </div>

      <div className="card-f" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ flex: 1 }}>
          ตัวเลขข้างบนเป็นการแสดงผลล่วงหน้าเท่านั้น ยอดที่ใช้จริงคำนวณและปัดเศษที่เซิร์ฟเวอร์
        </span>
        <button className="btn" disabled={busy} onClick={() => submit(false)}>บันทึกฉบับร่าง</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => submit(true)}>
          {busy ? 'กำลังดำเนินการ…' : 'ออกเลขและลงบัญชี'}
        </button>
      </div>
    </div>
  );
}
