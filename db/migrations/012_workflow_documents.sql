-- =====================================================================
-- 012 — APPROVAL WORKFLOW, DOCUMENT INBOX, NOTIFICATIONS
-- =====================================================================
SET search_path TO duly, public;

CREATE TABLE approval_flow (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES company(id),
  code         text NOT NULL,
  name_th      text NOT NULL,
  doc_type     text NOT NULL,
  condition_json jsonb NOT NULL DEFAULT '{}',  -- {"amount_gte":100000,"department":"IT"}
  priority     smallint NOT NULL DEFAULT 100,
  is_active    boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, code)
);

CREATE TABLE approval_step (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id        uuid NOT NULL REFERENCES approval_flow(id) ON DELETE CASCADE,
  step_no        smallint NOT NULL,
  name_th        text NOT NULL,
  approver_kind  text NOT NULL,     -- user|role|department_manager|dynamic
  approver_user_id uuid REFERENCES app_user(id),
  approver_role_id uuid REFERENCES role(id),
  min_approvals  smallint NOT NULL DEFAULT 1,
  can_skip_if_same_user boolean NOT NULL DEFAULT true,
  sla_hours      smallint,
  UNIQUE (flow_id, step_no)
);

CREATE TABLE approval_request (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES company(id),
  flow_id       uuid REFERENCES approval_flow(id),
  doc_type      text NOT NULL,
  doc_id        uuid NOT NULL,
  doc_no        text,
  amount        numeric(19,4),
  requested_by  uuid NOT NULL REFERENCES app_user(id),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  current_step  smallint NOT NULL DEFAULT 1,
  state         approval_state NOT NULL DEFAULT 'pending',
  completed_at  timestamptz,
  UNIQUE (doc_type, doc_id)
);
CREATE INDEX ON approval_request (company_id, state, requested_at);

CREATE TABLE approval_action (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   uuid NOT NULL REFERENCES approval_request(id) ON DELETE CASCADE,
  step_no      smallint NOT NULL,
  actor_id     uuid NOT NULL REFERENCES app_user(id),
  action       approval_state NOT NULL,
  comment      text,
  acted_at     timestamptz NOT NULL DEFAULT now(),
  acted_via    text NOT NULL DEFAULT 'web'   -- web|email|line|api
);

-- กล่องรับเอกสาร (ส่งบิลเข้าอีเมลเฉพาะของบริษัท)
CREATE TABLE document_inbox (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  received_at    timestamptz NOT NULL DEFAULT now(),
  source         text NOT NULL,     -- email|upload|api|line
  sender         text,
  subject        text,
  attachment_id  uuid REFERENCES attachment(id),
  ocr_status     text NOT NULL DEFAULT 'pending',  -- pending|done|failed|skipped
  extracted_json jsonb,             -- ผลอ่านเอกสาร (เฟส AI)
  suggested_doc_type text,
  status         text NOT NULL DEFAULT 'new',      -- new|assigned|converted|ignored
  converted_doc_type text,
  converted_doc_id   uuid,
  assignee_id    uuid REFERENCES app_user(id)
);
CREATE INDEX ON document_inbox (company_id, status, received_at DESC);

CREATE TABLE notification (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES company(id),
  user_id      uuid NOT NULL REFERENCES app_user(id),
  kind         text NOT NULL,      -- approval|due_date|tax_deadline|anomaly|system
  title        text NOT NULL,
  body         text,
  link_url     text,
  severity     text NOT NULL DEFAULT 'info',  -- info|warning|critical
  channels     text[] NOT NULL DEFAULT '{in_app}',
  sent_at      timestamptz,
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON notification (user_id, read_at, created_at DESC);

CREATE TABLE webhook_endpoint (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES company(id),
  url          text NOT NULL,
  secret       text NOT NULL,
  events       text[] NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhook_delivery (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id  uuid NOT NULL REFERENCES webhook_endpoint(id) ON DELETE CASCADE,
  event        text NOT NULL,
  payload      jsonb NOT NULL,
  attempt      smallint NOT NULL DEFAULT 0,
  status_code  smallint,
  response_body text,
  delivered_at timestamptz,
  next_retry_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- งานทั่วไปในระบบ (ปิดงวด ตรวจสอบ ฯลฯ)
CREATE TABLE work_task (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES company(id),
  category     text NOT NULL,     -- period_close|tax|reconciliation|audit|custom
  title        text NOT NULL,
  description  text,
  period_code  text,
  due_date     date,
  assignee_id  uuid REFERENCES app_user(id),
  status       text NOT NULL DEFAULT 'pending',
  completed_at timestamptz,
  completed_by uuid REFERENCES app_user(id),
  blocking_close boolean NOT NULL DEFAULT false
);
CREATE INDEX ON work_task (company_id, period_code, status);

-- คำขอใช้สิทธิของเจ้าของข้อมูล (PDPA)
CREATE TABLE dsr_request (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  subject_type   text NOT NULL,     -- customer|employee|vendor_contact
  subject_ref    text NOT NULL,
  request_kind   text NOT NULL,     -- access|copy|rectify|erase|object|restrict|portability
  received_at    timestamptz NOT NULL DEFAULT now(),
  due_date       date NOT NULL,
  status         text NOT NULL DEFAULT 'open',   -- open|fulfilled|rejected
  decision       text,
  legal_basis    text,              -- เหตุผลที่ปฏิเสธ เช่น หน้าที่ตามกฎหมายเก็บ 5 ปี
  handled_by     uuid REFERENCES app_user(id),
  completed_at   timestamptz,
  export_key     text
);
