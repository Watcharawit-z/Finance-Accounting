import { useEffect, useState } from 'react';
import { api, baht, thaiDate } from '../api';

const TYPE_TH: Record<string, string> = {
  general: 'ทั่วไป', sales: 'ขาย', purchase: 'ซื้อ', receipt: 'รับเงิน', payment: 'จ่ายเงิน',
  adjustment: 'ปรับปรุง', opening: 'ยอดยกมา', closing: 'ปิดบัญชี', payroll: 'เงินเดือน',
  inventory: 'สินค้า', asset: 'ทรัพย์สิน',
};

export function Journals({ period }: { period: string }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [detail, setDetail] = useState<any | null>(null);

  useEffect(() => { api.journalEntries(period).then(setRows).catch(() => setRows([])); }, [period]);
  if (!rows) return <div className="empty">กำลังโหลด…</div>;

  return (
    <>
      <div className="card">
        <div className="card-h"><h2>สมุดรายวัน</h2>
          <span className="dim" style={{ fontSize: 12 }}>งวด {period}</span></div>
        {rows.length === 0 ? <div className="empty">ยังไม่มีรายการบัญชีในงวดนี้</div> : (
          <div className="scroll">
            <table>
              <thead><tr>
                <th>เลขที่</th><th>วันที่</th><th>ประเภท</th><th>คำอธิบาย</th>
                <th className="r">เดบิต</th><th className="r">เครดิต</th><th>สถานะ</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ cursor: 'pointer' }}
                      onClick={() => api.journalEntry(r.id).then(setDetail)}>
                    <td className="mono">{r.entry_no}</td>
                    <td>{thaiDate(r.posting_date)}</td>
                    <td>{TYPE_TH[r.journal_type] ?? r.journal_type}</td>
                    <td>{r.description}</td>
                    <td className="num">{baht(r.total_debit)}</td>
                    <td className="num">{baht(r.total_credit)}</td>
                    <td><span className={`st ${r.status === 'posted' ? 'paid' : 'void'}`}>
                      {r.status === 'posted' ? 'ลงบัญชีแล้ว' : 'กลับรายการ'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="card-f">คลิกที่แถวเพื่อดูคู่บัญชี — รายการที่ลงบัญชีแล้วแก้ไม่ได้ ทำได้แค่กลับรายการ</div>
      </div>

      {detail && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-h">
            <h2>คู่บัญชีของ {detail.entry_no}</h2>
            <span className="dim" style={{ fontSize: 12 }}>{detail.description}</span>
            <span className="spacer" />
            <button className="btn" onClick={() => setDetail(null)}>ปิด</button>
          </div>
          <div className="scroll">
            <table>
              <thead><tr><th>#</th><th>รหัส</th><th>ชื่อบัญชี</th>
                <th className="r">เดบิต</th><th className="r">เครดิต</th><th>หมายเหตุ</th></tr></thead>
              <tbody>
                {detail.lines.map((l: any) => (
                  <tr key={l.line_no}>
                    <td className="num">{l.line_no}</td>
                    <td className="mono">{l.code}</td>
                    <td>{l.name_th}</td>
                    <td className="num">{Number(l.debit) ? baht(l.debit) : '—'}</td>
                    <td className="num">{Number(l.credit) ? baht(l.credit) : '—'}</td>
                    <td className="dim">{l.memo ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
