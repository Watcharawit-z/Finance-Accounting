import { useEffect, useState } from 'react';
import { api } from '../api';

export function Reconciliation() {
  const [data, setData] = useState<any | null>(null);
  const [asOf, setAsOf] = useState('2026-12-31');

  useEffect(() => { api.reconciliation(asOf).then(setData).catch(() => setData(null)); }, [asOf]);
  if (!data) return <div className="empty">กำลังโหลด…</div>;

  return (
    <div className="card">
      <div className="card-h">
        <h2>ตรวจยอดคุมกับบัญชีย่อย</h2>
        <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={{ width: 150 }} />
      </div>
      <div className="scroll">
        <table>
          <thead><tr>
            <th>รายการตรวจสอบ</th><th className="r">ยอดคุม</th><th className="r">ยอดย่อย</th><th>ผล</th>
          </tr></thead>
          <tbody>
            {data.checks.map((c: any) => (
              <tr key={c.code}>
                <td>{c.label}<div className="dim mono" style={{ fontSize: 11 }}>{c.code}</div></td>
                <td className="num">{c.control}</td>
                <td className="num">{c.subledger}</td>
                <td><span className={`st ${c.ok ? 'paid' : 'void'}`}>{c.ok ? 'ตรงกัน' : 'ไม่ตรง'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card-f" style={{ color: data.allPassed ? 'var(--pos-600)' : 'var(--neg-600)' }}>
        {data.allPassed
          ? 'ผ่านทุกข้อ — งานนี้ต้องรันอัตโนมัติทุกคืนบนระบบจริง และแจ้งเตือนทันทีเมื่อไม่ตรง'
          : 'มีข้อที่ไม่ตรง ต้องหาสาเหตุก่อนปิดงวด'}
      </div>
    </div>
  );
}
