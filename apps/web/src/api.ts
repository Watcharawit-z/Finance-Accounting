/** ชั้นเรียก API — header บริษัทต้องแนบไปทุกคำขอ */
const DEMO = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  companyId: '22222222-2222-2222-2222-222222222222',
  branchId: '33333333-3333-3333-3333-333333333333',
  userId: '44444444-4444-4444-4444-444444444444',
  customerId: '88888888-8888-8888-8888-888888888888',
};
export { DEMO };

export interface ApiError {
  code: string;
  message: string;
  hint?: string;
  field?: string;
  request_id?: string;
}

export class ApiCallError extends Error {
  constructor(readonly detail: ApiError) {
    super(detail.message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': DEMO.tenantId,
      'X-Company-Id': DEMO.companyId,
      'X-User-Id': DEMO.userId,
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiCallError(body?.error ?? { code: 'NETWORK', message: 'ติดต่อเซิร์ฟเวอร์ไม่ได้' });
  }
  return body as T;
}

export const api = {
  company: () => call<any>('/company'),
  partners: () => call<any[]>('/partners?kind=customer'),
  invoices: (period?: string) => call<any[]>(`/sales-invoices${period ? `?period=${period}` : ''}`),
  createInvoice: (body: unknown) =>
    call<any>('/sales-invoices', { method: 'POST', body: JSON.stringify(body) }),
  issueInvoice: (id: string) => call<any>(`/sales-invoices/${id}/issue`, { method: 'POST' }),
  trialBalance: (from: string, to: string) =>
    call<any>(`/reports/trial-balance?from=${from}&to=${to}`),
  vatReport: (period: string) => call<any>(`/reports/vat?kind=vat_output&period=${period}`),
  reconciliation: (asOf: string) => call<any>(`/reports/reconciliation?as_of=${asOf}`),
  journalEntries: (period?: string) => call<any[]>(`/journal-entries${period ? `?period=${period}` : ''}`),
  journalEntry: (id: string) => call<any>(`/journal-entries/${id}`),
};

/** จัดรูปแบบตัวเลขเงิน — ติดลบใช้วงเล็บตามแบบรายงานการเงิน */
export function baht(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  const s = Math.abs(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${s})` : s;
}

/** แปลง ค.ศ. เป็น พ.ศ. สำหรับแสดงผล */
export function thaiDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
}
