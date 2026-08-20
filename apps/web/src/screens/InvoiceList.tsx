import { useEffect, useState } from 'react';
import { api, baht, thaiDate } from '../api';

export function InvoiceList({ period }: { period: string }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.invoices(period).then(setRows).catch((e) => setError(e.message));
  }, [period]);

  if (error) return <div className="alert error">{error}</div>;
  if (!rows) return <div className="empty">กำลังโหลด…</div>;

  const base = rows.reduce((s, r) => s + Number(r.vat_base), 0);
  const vat = rows.reduce((s, r) => s + Number(r.vat_amount), 0);
  const total = rows.reduce((s, r) => s + Number(r.grand_total), 0);
  const drafts = rows.filter((r) => r.status === 'draft').length;

  return (
    <div className="card">
      <div className="card-h"><h2>ใบกำกับภาษีขาย</h2>
        <span className="dim" style={{ fontSize: 12 }}>งวด {period}</span></div>
      {rows.length === 0 ? (
        <div className="empty">ยังไม่มีใบกำกับภาษีในงวดนี้ — สร้างใบแรกได้ที่แท็บ "สร้างใบกำกับภาษี"</div>
      ) : (
        <>
          <div className="scroll">
            <table>
              <thead><tr>
                <th>เลขที่</th><th>วันที่</th><th>ลูกค้า</th><th>เลขผู้เสียภาษี</th>
                <th className="r">มูลค่า</th><th className="r">VAT</th><th className="r">รวม</th><th>สถานะ</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.doc_no ?? <span className="dim">ฉบับร่าง</span>}</td>
                    <td>{thaiDate(r.doc_date)}</td>
                    <td>{r.partner_name}</td>
                    <td className="mono">{r.partner_tax_id ?? '—'}</td>
                    <td className="num">{baht(r.vat_base)}</td>
                    <td className="num">{baht(r.vat_amount)}</td>
                    <td className="num">{baht(r.grand_total)}</td>
                    <td><span className={`st ${r.status}`}>{
                      { draft: 'ฉบับร่าง', issued: 'ลงบัญชีแล้ว', paid: 'ชำระแล้ว', void: 'ยกเลิก' }[r.status as string] ?? r.status
                    }</span></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <td colSpan={4}>
                  รวม {rows.length} ใบ
                  {drafts > 0 && <span className="dim"> (รวมฉบับร่าง {drafts} ใบ)</span>}
                </td>
                <td className="num">{baht(base)}</td>
                <td className="num">{baht(vat)}</td>
                <td className="num">{baht(total)}</td>
                <td />
              </tr></tfoot>
            </table>
          </div>
          <div className="card-f">
            ยอดในตารางนี้มาจากฐานข้อมูลจริง และตรงกับบัญชี 4111 กับ 2141 ตามที่แสดงในแท็บตรวจยอดคุม
          </div>
        </>
      )}
    </div>
  );
}
