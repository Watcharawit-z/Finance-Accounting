import { useEffect, useState } from 'react';
import { api } from './api';
import { InvoiceList } from './screens/InvoiceList';
import { NewInvoice } from './screens/NewInvoice';
import { TrialBalance } from './screens/TrialBalance';
import { VatReport } from './screens/VatReport';
import { Reconciliation } from './screens/Reconciliation';
import { Journals } from './screens/Journals';

const TABS = [
  { id: 'invoices', label: 'ใบกำกับภาษี' },
  { id: 'new', label: 'สร้างใบกำกับภาษี' },
  { id: 'journals', label: 'สมุดรายวัน' },
  { id: 'tb', label: 'งบทดลอง' },
  { id: 'vat', label: 'รายงานภาษีขาย' },
  { id: 'recon', label: 'ตรวจยอดคุม' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function App() {
  const [tab, setTab] = useState<TabId>('invoices');
  const [company, setCompany] = useState<any>(null);
  const [refresh, setRefresh] = useState(0);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    api.company().then(setCompany).catch(() => setOffline(true));
  }, []);

  const period = '2026-07';

  return (
    <>
      <header className="topbar">
        <span className="brand"><i>F</i>Financii</span>
        {company && (
          <span className="company">
            <b>{company.legal_name_th}</b>
            <span className="dim"> · เลขผู้เสียภาษี {company.tax_id}</span>
          </span>
        )}
        <span className="spacer" />
        <span className="pill">งวด {period}</span>
        <span className="pill">{company?.accounting_standard ?? '—'}</span>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} className="tab" role="tab"
                  aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        {offline && (
          <div className="alert error">
            <b>ติดต่อ API ไม่ได้</b>
            เริ่มเซิร์ฟเวอร์ด้วย <span className="mono">npm run dev</span> ใน apps/api
            และตรวจว่าฐานข้อมูลพร้อมใช้งานแล้ว (db/reset_dev.sh)
          </div>
        )}
        {!offline && tab === 'invoices' && <InvoiceList key={refresh} period={period} />}
        {!offline && tab === 'new' && (
          <NewInvoice onIssued={() => { setRefresh((r) => r + 1); setTab('invoices'); }} />
        )}
        {!offline && tab === 'journals' && <Journals key={refresh} period={period} />}
        {!offline && tab === 'tb' && <TrialBalance key={refresh} />}
        {!offline && tab === 'vat' && <VatReport key={refresh} period={period} />}
        {!offline && tab === 'recon' && <Reconciliation key={refresh} />}
      </main>
    </>
  );
}
