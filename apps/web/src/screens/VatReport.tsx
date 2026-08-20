import { useEffect, useState } from 'react';
import { api, baht } from '../api';

export function VatReport({ period }: { period: string }) {
  const [data, setData] = useState<any | null>(null);
  const [p, setP] = useState(period);

  useEffect(() => { api.vatReport(p).then(setData).catch(() => setData(null)); }, [p]);
  if (!data) return <div className="empty">กำลังโหลด…</div>;

  return (
    <div className="card">
      <div className="card-h">
        <h2>รายงานภาษีขาย</h2>
        <input type="month" value={p} onChange={(e) => setP(e.target.value)} style={{ width: 150 }} />
        <span className="dim" style={{ fontSize: 12 }}>รูปแบบตามประกาศอธิบดีกรมสรรพากร</span>
      </div>
      {data.rows.length === 0 ? (
        <div className="empty">ไม่มีรายการภาษีขายในเดือนภาษีนี้</div>
      ) : (
        <div className="scroll">
          <table>
            <thead><tr>
              <th>ลำดับ</th><th>วัน/เดือน/ปี</th><th>เลขที่ใบกำกับ</th><th>ชื่อผู้ซื้อ</th>
              <th>เลขผู้เสียภาษี</th><th>สาขา</th><th className="r">มูลค่าสินค้า</th><th className="r">ภาษีมูลค่าเพิ่ม</th>
            </tr></thead>
            <tbody>
              {data.rows.map((r: any) => (
                <tr key={r.doc_no}>
                  <td className="num">{r.seq}</td>
                  <td>{r.doc_date_th}</td>
                  <td className="mono">{r.doc_no}</td>
                  <td>{r.partner_name}</td>
                  <td className="mono">{r.partner_tax_id ?? '—'}</td>
                  <td className="mono">{r.partner_branch ?? '—'}</td>
                  <td className="num">{baht(r.base_amount)}</td>
                  <td className="num">{baht(r.tax_amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td colSpan={6}>รวม {data.rows.length} ฉบับ</td>
              <td className="num">{data.totals.baseFormatted}</td>
              <td className="num">{data.totals.taxFormatted}</td>
            </tr></tfoot>
          </table>
        </div>
      )}
      <div className="card-f"
           style={{ color: data.reconciliation.matched ? 'var(--pos-600)' : 'var(--neg-600)' }}>
        {data.reconciliation.note}
      </div>
    </div>
  );
}
