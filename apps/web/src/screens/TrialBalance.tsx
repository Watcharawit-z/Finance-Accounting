import { useEffect, useState } from 'react';
import { api, baht } from '../api';

export function TrialBalance() {
  const [data, setData] = useState<any | null>(null);
  const [from, setFrom] = useState('2026-01-01');
  const [to, setTo] = useState('2026-12-31');

  useEffect(() => { api.trialBalance(from, to).then(setData).catch(() => setData(null)); }, [from, to]);
  if (!data) return <div className="empty">กำลังโหลด…</div>;

  return (
    <div className="card">
      <div className="card-h">
        <h2>งบทดลอง</h2>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
        <span className="dim">ถึง</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
      </div>
      <div className="scroll">
        <table>
          <thead><tr>
            <th>รหัส</th><th>ชื่อบัญชี</th><th>ประเภท</th>
            <th className="r">ยกมา</th><th className="r">เดบิต</th><th className="r">เครดิต</th><th className="r">คงเหลือ</th>
          </tr></thead>
          <tbody>
            {data.rows.map((r: any) => (
              <tr key={r.code}>
                <td className="mono">{r.code}</td>
                <td>{r.name}</td>
                <td className="dim">{r.subType}</td>
                <td className="num">{baht(r.opening)}</td>
                <td className="num">{baht(r.debit)}</td>
                <td className="num">{baht(r.credit)}</td>
                <td className="num">{baht(r.closing)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr>
            <td colSpan={4}>รวมทั้งสิ้น {data.rows.length} บัญชี</td>
            <td className="num">{data.totals.debitFormatted}</td>
            <td className="num">{data.totals.creditFormatted}</td>
            <td className="num">{data.totals.balanced ? '0.00' : '—'}</td>
          </tr></tfoot>
        </table>
      </div>
      <div className="card-f" style={{ color: data.totals.balanced ? 'var(--pos-600)' : 'var(--neg-600)' }}>
        {data.totals.balanced
          ? 'เดบิตรวมเท่ากับเครดิตรวม — ฐานข้อมูลบังคับกฎนี้ด้วย trigger ไม่ใช่แค่ตรวจตอนแสดงผล'
          : 'เดบิตไม่เท่ากับเครดิต — ต้องหาสาเหตุทันที'}
      </div>
    </div>
  );
}
