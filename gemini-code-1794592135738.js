/**
 * LOGSMIS - กรมทหารพรานที่ 46
 * Config.gs: ค่าคงที่ โครงสร้างฐานข้อมูล และกฎตรวจสอบทางบัญชี
 */

const APP_CONFIG = Object.freeze({
  SYSTEM_NAME: 'LOGSMIS กรมทหารพรานที่ 46',
  VERSION: '4.0.0-ENTERPRISE',
  UNIT_NAME: 'กรมทหารพรานที่ ๔๖',
  DEFAULT_ORDER_REF: 'คำสั่ง กรม ทพ.๔๖ ที่ ๑๑๕/๒๕๖๙ ลง ๒๗ ก.ย. ๒๕๖๙',
  SESSION_TTL_SEC: 14400, // 4 ชั่วโมง
  CACHE_TTL_SEC: 300, // 5 นาที
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_TTL_SEC: 900, // ล็อก 15 นาทีเมื่อกรอก PIN ผิดเกินกำหนด
  LOCK_TIMEOUT_MS: 15000,
  IDEMPOTENCY_TTL_SEC: 86400 // 24 ชั่วโมง
});

const SHEETS = Object.freeze({
  UNITS: 'DB_UNITS',
  ITEMS: 'DB_ITEMS',
  UNIT_BALANCES: 'DB_UNIT_BALANCES',
  ASSET_SERIALS: 'DB_ASSET_SERIALS',
  USERS: 'DB_USERS',
  REQUISITIONS: 'DB_REQUISITIONS',
  REPAIRS: 'DB_REPAIRS',
  DISPOSALS: 'DB_DISPOSALS',
  TX_LEDGER: 'DB_TX_LEDGER',
  AUDIT_LEDGER: 'DB_AUDIT_LEDGER',
  SETTINGS: 'DB_SETTINGS'
});

const ROLES = Object.freeze({
  APPROVER: 'APPROVER',
  INSPECTOR: 'INSPECTOR',
  OPERATOR: 'OPERATOR',
  SYSTEM_ADMIN: 'SYSTEM_ADMIN'
});

const FORM_TYPES = Object.freeze({
  LEDGER_CARD_SUPPORT: 'ทบ.400-003',
  LEDGER_CARD_UNIT: 'ทบ.400-005',
  REQ_ISSUE_RETURN: 'ทบ.400-006',
  INVENTORY_SURVEY: 'ทบ.400-011',
  INVENTORY_RECONCILE: 'ทบ.400-012',
  STATUS_REPORT_UNIT: 'ทบ.400-016',
  STATUS_REPORT_SUPPORT: 'ทบ.400-017',
  DISPOSAL_REQUEST: 'ทบ.400-065',
  CONSUMABLE_CARD: 'ทบ.400-068'
});

const DOC_STATUS = Object.freeze({
  PENDING_INSPECTION: 'PENDING_INSPECTION',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  IN_REPAIR: 'IN_REPAIR',
  REPAIR_COMPLETED: 'REPAIR_COMPLETED',
  PENDING_BOARD: 'PENDING_BOARD',
  DISPOSED: 'DISPOSED'
});

const ERROR_CODES = Object.freeze({
  UNAUTHORIZED: 'ERR_UNAUTHORIZED',
  FORBIDDEN: 'ERR_FORBIDDEN',
  VALIDATION: 'ERR_VALIDATION',
  CONCURRENCY: 'ERR_CONCURRENCY_CONFLICT',
  BUSY: 'ERR_SYSTEM_BUSY',
  INSUFFICIENT_STOCK: 'ERR_INSUFFICIENT_STOCK',
  INVARIANT_VIOLATION: 'ERR_ACCOUNTING_INVARIANT',
  NOT_FOUND: 'ERR_NOT_FOUND',
  DUPLICATE: 'ERR_DUPLICATE_REQUEST',
  INTERNAL: 'ERR_INTERNAL_SERVER'
});

const TABLE_SCHEMAS = Object.freeze({
  DB_UNITS: [
    'id', 'unit_code', 'unit_name', 'legacy_sheet_name', 'unit_type',
    'commander_name', 'status', 'rev', 'created_at', 'updated_at'
  ],
  DB_ITEMS: [
    'id', 'seq_no', 'supply_line', 'category', 'item_name', 'nsn', 'unit',
    'authorized_qty', 'issued_qty', 'received_qty', 'in_repair_qty',
    'pending_disposal_qty', 'unserviceable_qty', 'serviceable_qty',
    'depot_reserve_qty', 'allow_over_authorized', 'is_serialized',
    'status', 'rev', 'updated_at'
  ],
  DB_UNIT_BALANCES: [
    'id', 'unit_id', 'unit_code', 'unit_name', 'item_id', 'item_name',
    'authorized_qty', 'issued_qty', 'serviceable_qty', 'in_repair_qty',
    'pending_disposal_qty', 'last_audit_date', 'rev', 'updated_at'
  ],
  DB_ASSET_SERIALS: [
    'id', 'item_id', 'item_name', 'unit_id', 'unit_name', 'serial_no',
    'condition_status', 'assigned_personnel', 'remark', 'rev', 'updated_at'
  ],
  DB_USERS: [
    'id', 'rank_name', 'position', 'role', 'supply_line',
    'can_receive_sp', 'pin_hash', 'must_change_pin', 'status',
    'rev', 'created_at', 'updated_at'
  ],
  DB_REQUISITIONS: [
    'id', 'doc_no', 'form_type', 'req_type', 'dept_id', 'dept_code',
    'dept_name', 'dept_type', 'assigned_personnel_id', 'serial_number',
    'item_id', 'item_name', 'qty_requested', 'tx_direction', 'reason',
    'operator_id', 'operator_name', 'inspector_id', 'inspector_name',
    'approver_id', 'approver_name', 'reject_reason', 'status',
    'rev', 'created_at', 'updated_at'
  ],
  DB_REPAIRS: [
    'id', 'repair_no', 'form_type', 'dept_id', 'dept_name', 'item_id',
    'item_name', 'nsn', 'qty_sent', 'qty_returned', 'defect_symptom',
    'assigned_personnel_id', 'serial_number', 'operator_id', 'operator_name',
    'approver_name', 'status', 'rev', 'created_at', 'updated_at'
  ],
  DB_DISPOSALS: [
    'id', 'disposal_no', 'form_type', 'dept_id', 'dept_name', 'item_id',
    'item_name', 'nsn', 'qty_disposal', 'source_location', 'disposal_reason',
    'committee_ref', 'operator_id', 'operator_name', 'approver_id',
    'approver_name', 'status', 'rev', 'created_at', 'updated_at'
  ],
  DB_TX_LEDGER: [
    'tx_id', 'idempotency_key', 'request_id', 'timestamp', 'tx_type',
    'form_type', 'ref_doc_id', 'ref_doc_no', 'unit_id', 'unit_name',
    'item_id', 'item_name', 'delta_qty', 'before_depot_qty', 'after_depot_qty',
    'before_issued_qty', 'after_issued_qty', 'actor_id', 'actor_name', 'remark'
  ],
  DB_AUDIT_LEDGER: [
    'id', 'request_id', 'timestamp', 'actor', 'action', 'target_id', 'prev_val', 'new_val'
  ],
  DB_SETTINGS: [
    'id', 'key', 'value', 'description', 'rev', 'updated_at'
  ]
});

const UNITS_SEED = [
  { id: 'DPT-HQ', unit_code: 'HQ', unit_name: 'ฝ่ายอำนวยการ บก.กรม ทพ.๔๖ (ฝอ.๑-๕)', legacy_sheet_name: 'บก.กรม (ฝอ.1-5)', unit_type: 'HQ_STAFF' },
  { id: 'DPT-FEM', unit_code: 'FEM', unit_name: 'หมวดทหารพรานหญิง (ชป.๑-๔)', legacy_sheet_name: 'มว.ทพ.หญิง (ชป.1-4)', unit_type: 'SPECIAL_PLATOON' },
  { id: 'DPT-OP4601', unit_code: 'OP4601', unit_name: 'กองร้อยทหารพรานที่ 4601 (ร้อย.ทพ.4601)', legacy_sheet_name: 'ร้อย.4601', unit_type: 'LINE_UNIT' },
  { id: 'DPT-OP4602', unit_code: 'OP4602', unit_name: 'กองร้อยทหารพรานที่ 4602 (ร้อย.ทพ.4602)', legacy_sheet_name: 'ร้อย.4602', unit_type: 'LINE_UNIT' },
  { id: 'DPT-OP4603', unit_code: 'OP4603', unit_name: 'กองร้อยทหารพรานที่ 4603 (ร้อย.ทพ.4603)', legacy_sheet_name: 'ร้อย.4603', unit_type: 'LINE_UNIT' },
  { id: 'DPT-OP4604', unit_code: 'OP4604', unit_name: 'กองร้อยทหารพรานที่ 4604 (ร้อย.ทพ.4604)', legacy_sheet_name: 'ร้อย.4604', unit_type: 'LINE_UNIT' },
  { id: 'DPT-OP4605', unit_code: 'OP4605', unit_name: 'กองร้อยทหารพรานที่ 4605 (ร้อย.ทพ.4605)', legacy_sheet_name: 'ร้อย.4605', unit_type: 'LINE_UNIT' },
  { id: 'DPT-OP4606', unit_code: 'OP4606', unit_name: 'กองร้อยทหารพรานที่ 4606 (ร้อย.ทพ.4606)', legacy_sheet_name: 'ร้อย.4606', unit_type: 'LINE_UNIT' },
  { id: 'DPT-OP4607', unit_code: 'OP4607', unit_name: 'กองร้อยทหารพรานที่ 4607 (ร้อย.ทพ.4607)', legacy_sheet_name: 'ร้อย.4607', unit_type: 'LINE_UNIT' },
  { id: 'DPT-OP4608', unit_code: 'OP4608', unit_name: 'กองร้อยทหารพรานที่ 4608 (ร้อย.ทพ.4608)', legacy_sheet_name: 'ร้อย.4608', unit_type: 'LINE_UNIT' },
  { id: 'DPT-OP4609', unit_code: 'OP4609', unit_name: 'กองร้อยทหารพรานที่ 4609 (ร้อย.ทพ.4609)', legacy_sheet_name: 'ร้อย.4609', unit_type: 'LINE_UNIT' },
  { id: 'DPT-OP4610', unit_code: 'OP4610', unit_name: 'กองร้อยทหารพรานที่ 4610 (ร้อย.ทพ.4610)', legacy_sheet_name: 'ร้อย.4610', unit_type: 'LINE_UNIT' },
  { id: 'DPT-OP4611', unit_code: 'OP4611', unit_name: 'กองร้อยทหารพรานที่ 4611 (ร้อย.ทพ.4611)', legacy_sheet_name: 'ร้อย.4611', unit_type: 'LINE_UNIT' },
  { id: 'DPT-OP4612', unit_code: 'OP4612', unit_name: 'กองร้อยทหารพรานที่ 4612 (ร้อย.ทพ.4612)', legacy_sheet_name: 'ร้อย.4612', unit_type: 'LINE_UNIT' },
  { id: 'DPT-OP4613', unit_code: 'OP4613', unit_name: 'กองร้อยทหารพรานที่ 4613 (ร้อย.ทพ.4613)', legacy_sheet_name: 'ร้อย.4613', unit_type: 'LINE_UNIT' },
  { id: 'DPT-OP4614', unit_code: 'OP4614', unit_name: 'กองร้อยทหารพรานที่ 4614 (ร้อย.ทพ.4614)', legacy_sheet_name: 'ร้อย.4614', unit_type: 'LINE_UNIT' },
  { id: 'DPT-OP4615', unit_code: 'OP4615', unit_name: 'กองร้อยทหารพรานที่ 4615 (ร้อย.ทพ.4615)', legacy_sheet_name: 'ร้อย.4615', unit_type: 'LINE_UNIT' },
  { id: 'DPT-OP4616', unit_code: 'OP4616', unit_name: 'กองร้อยทหารพรานที่ 4616 (ร้อย.ทพ.4616)', legacy_sheet_name: 'ร้อย.4616', unit_type: 'LINE_UNIT' }
];

const USERS_SEED = [
  { id: 'USR-001', rank_name: 'พ.อ. นพดล พรหมมาก', position: 'ผบ.กรม ทพ.๔๖ (ผู้อนุมัติใบเบิก/ใบซ่อม/ใบจำหน่าย)', role: 'APPROVER', supply_line: 'ทุกสายงาน (ผบ.หน่วย)', can_receive_sp: 'NO' },
  { id: 'USR-002', rank_name: 'พ.ต. ประสิทธิ์ คชกูล', position: 'ฝอ.๕ กรม ทพ.๔๖ ทำการแทน น.ฝกบ.ฯ (ผู้ตรวจสอบ/รับ สป.ส่วนรวม)', role: 'INSPECTOR', supply_line: 'สป.ส่วนรวมทุกสาย', can_receive_sp: 'YES (3.1)' },
  { id: 'USR-003', rank_name: 'ร.อ. ธงชัย สิงห์กวาง', position: 'น.ส่งกำลังบำรุง กรม ทพ.๔๖ (กำกับดูแล สป.ยุทธวิธี)', role: 'INSPECTOR', supply_line: 'สป.ยุทธวิธี', can_receive_sp: 'YES (3.2)' },
  { id: 'USR-004', rank_name: 'จ.ส.อ. จีระวัฒน์ พรหมคีรี', position: 'จนท.รับผิดชอบ สป.สาย ยุทธโยธา', role: 'OPERATOR', supply_line: 'สาย ยย.', can_receive_sp: 'YES (3.3)' },
  { id: 'USR-005', rank_name: 'จ.ส.อ. อนันต์ ลิบัง', position: 'จนท.รับผิดชอบ สป.สาย ทหารช่าง', role: 'OPERATOR', supply_line: 'สาย ช.', can_receive_sp: 'YES (3.4)' },
  { id: 'USR-006', rank_name: 'จ.ส.อ. พรหมจักร จั่วนาน', position: 'จนท.รับผิดชอบ สป.สาย สรรพาวุธ', role: 'OPERATOR', supply_line: 'สาย สพ.', can_receive_sp: 'YES (3.5)' },
  { id: 'USR-007', rank_name: 'จ.ส.อ. ปรีชา แก่นปัดชา', position: 'จนท.รับผิดชอบ สป.สาย การขนส่ง', role: 'OPERATOR', supply_line: 'สาย ขส.', can_receive_sp: 'YES (3.6)' },
  { id: 'USR-008', rank_name: 'จ.ส.อ. อภิวัฒน์ แซ่ว่อง', position: 'จนท.รับผิดชอบ สป.สาย กส., สก. และ สป.๓', role: 'OPERATOR', supply_line: 'สาย กส., สก., สป.๓', can_receive_sp: 'YES (3.7)' },
  { id: 'USR-009', rank_name: 'จ.ส.อ. สุพจน์ ปิปผะโร', position: 'จนท.รับผิดชอบ สิ่งอุปกรณ์ประเภท ๕', role: 'OPERATOR', supply_line: 'สป.๕ (กระสุน/วัตถุระเบิด)', can_receive_sp: 'YES (3.8)' },
  { id: 'USR-010', rank_name: 'จ.ส.อ. พงศ์เทพ ดำแก้ว', position: 'จนท.รับผิดชอบ สป.สาย สื่อสาร', role: 'OPERATOR', supply_line: 'สาย ส.', can_receive_sp: 'YES (3.9)' },
  { id: 'USR-011', rank_name: 'ส.ท. ชัยณรงค์ พรมพุฒ', position: 'จนท.รับผิดชอบ สป.สาย พลาธิการ และ สาย แพทย์', role: 'OPERATOR', supply_line: 'สาย พธ. และ สาย พ.', can_receive_sp: 'YES (3.10)' }
];

const ITEMS_SEED = [
  { id: 'ITM-001', seq_no: 1, supply_line: 'สาย พธ.', category: '1. หมวดเครื่องสนาม', item_name: 'กระติกน้ำครบชุด (สีดำ)', nsn: '(แบบใหม่)', unit: 'ชุด', authorized_qty: 1488, issued_qty: 1275, received_qty: 1844, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 1844, depot_reserve_qty: 569, allow_over_authorized: true, is_serialized: false },
  { id: 'ITM-002', seq_no: 2, supply_line: 'สาย พธ.', category: '1. หมวดเครื่องสนาม', item_name: 'กระเป๋าอเนกประสงค์ (สีดำ)', nsn: '8415-35-234-0365', unit: 'ใบ', authorized_qty: 1488, issued_qty: 1206, received_qty: 1600, in_repair_qty: 4, pending_disposal_qty: 10, unserviceable_qty: 14, serviceable_qty: 1586, depot_reserve_qty: 394, allow_over_authorized: true, is_serialized: false },
  { id: 'ITM-003', seq_no: 3, supply_line: 'สาย พธ.', category: '1. หมวดเครื่องสนาม', item_name: 'กระเป๋าใส่ซองกระสุน (สีดำ)', nsn: '8415-35-234-0366', unit: 'ใบ', authorized_qty: 1488, issued_qty: 1549, received_qty: 2568, in_repair_qty: 6, pending_disposal_qty: 14, unserviceable_qty: 20, serviceable_qty: 2548, depot_reserve_qty: 1019, allow_over_authorized: true, is_serialized: false },
  { id: 'ITM-004', seq_no: 4, supply_line: 'สาย พธ.', category: '1. หมวดเครื่องสนาม', item_name: 'กระโจมบุคคล (สีดำ)', nsn: '8415-35-234-0368', unit: 'ชุด', authorized_qty: 1488, issued_qty: 514, received_qty: 780, in_repair_qty: 0, pending_disposal_qty: 2, unserviceable_qty: 2, serviceable_qty: 778, depot_reserve_qty: 266, allow_over_authorized: false, is_serialized: false },
  { id: 'ITM-005', seq_no: 5, supply_line: 'สาย พธ.', category: '1. หมวดเครื่องสนาม', item_name: 'ถุงผ้าใบสนาม (สีดำ)', nsn: '8415-35-234-0367', unit: 'ใบ', authorized_qty: 1488, issued_qty: 221, received_qty: 221, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 221, depot_reserve_qty: 0, allow_over_authorized: false, is_serialized: false },
  { id: 'ITM-006', seq_no: 6, supply_line: 'สาย พธ.', category: '1. หมวดเครื่องสนาม', item_name: 'พลั่วสนามครบชุด (สีดำ)', nsn: '8415-35-234-0371', unit: 'ชุด', authorized_qty: 1488, issued_qty: 850, received_qty: 850, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 850, depot_reserve_qty: 0, allow_over_authorized: false, is_serialized: false },
  { id: 'ITM-007', seq_no: 7, supply_line: 'สาย พธ.', category: '1. หมวดเครื่องสนาม', item_name: 'สายโยงเข็มขัดสนาม (สีดำ)', nsn: '8415-35-234-0372', unit: 'เส้น', authorized_qty: 1488, issued_qty: 1481, received_qty: 1481, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 1481, depot_reserve_qty: 0, allow_over_authorized: false, is_serialized: false },
  { id: 'ITM-008', seq_no: 8, supply_line: 'สาย พธ.', category: '1. หมวดเครื่องสนาม', item_name: 'หม้อข้าวสนามครบชุด (สีดำ)', nsn: '8415-35-234-0373', unit: 'ชุด', authorized_qty: 1488, issued_qty: 1676, received_qty: 2176, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 2176, depot_reserve_qty: 500, allow_over_authorized: true, is_serialized: false },
  { id: 'ITM-009', seq_no: 9, supply_line: 'สาย พธ.', category: '1. หมวดเครื่องสนาม', item_name: 'เข็มขัดสนาม (สีดำ)', nsn: '8415-35-234-0370', unit: 'เส้น', authorized_qty: 1488, issued_qty: 1452, received_qty: 2150, in_repair_qty: 18, pending_disposal_qty: 38, unserviceable_qty: 56, serviceable_qty: 2094, depot_reserve_qty: 698, allow_over_authorized: true, is_serialized: false },
  { id: 'ITM-010', seq_no: 10, supply_line: 'สาย พธ.', category: '1. หมวดเครื่องสนาม', item_name: 'เป้สนามขนาดเล็ก (สีดำ)', nsn: '8415-35-234-0363', unit: 'ใบ', authorized_qty: 1488, issued_qty: 277, received_qty: 900, in_repair_qty: 0, pending_disposal_qty: 2, unserviceable_qty: 2, serviceable_qty: 898, depot_reserve_qty: 623, allow_over_authorized: false, is_serialized: false },
  { id: 'ITM-011', seq_no: 11, supply_line: 'สาย พธ.', category: '1. หมวดเครื่องสนาม', item_name: 'เป้หลังครบชุด', nsn: '8415-Q-62-P-0773', unit: 'ชุด', authorized_qty: 1488, issued_qty: 1368, received_qty: 1960, in_repair_qty: 94, pending_disposal_qty: 190, unserviceable_qty: 284, serviceable_qty: 1676, depot_reserve_qty: 592, allow_over_authorized: true, is_serialized: false },
  { id: 'ITM-012', seq_no: 12, supply_line: 'สาย พธ.', category: '1. หมวดเครื่องสนาม', item_name: 'เสื้อกั๊กบรรจุซองกระสุน', nsn: '-', unit: 'ตัว', authorized_qty: 1488, issued_qty: 1128, received_qty: 1128, in_repair_qty: 14, pending_disposal_qty: 30, unserviceable_qty: 44, serviceable_qty: 1084, depot_reserve_qty: 0, allow_over_authorized: false, is_serialized: false },
  { id: 'ITM-013', seq_no: 13, supply_line: 'สาย พธ.', category: '1. หมวดเครื่องสนาม', item_name: 'เสื้อคลุมกันฝน (ชนิดไม่มีแขน / สีดำ)', nsn: '8415-35-234-0344', unit: 'ตัว', authorized_qty: 1488, issued_qty: 919, received_qty: 2150, in_repair_qty: 37, pending_disposal_qty: 75, unserviceable_qty: 112, serviceable_qty: 2038, depot_reserve_qty: 1231, allow_over_authorized: true, is_serialized: false },
  { id: 'ITM-014', seq_no: 14, supply_line: 'สาย พธ.', category: '2. หมวด อส. / อาคารสถานที่', item_name: 'กระดานดำมีขาตั้งหรือพลิกได้', nsn: '-', unit: 'ชุด', authorized_qty: 34, issued_qty: 0, received_qty: 0, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 0, depot_reserve_qty: 0, allow_over_authorized: false, is_serialized: false },
  { id: 'ITM-015', seq_no: 15, supply_line: 'สาย พธ.', category: '2. หมวด อส. / อาคารสถานที่', item_name: 'กระเป๋าเอกสารบรรจุเงิน', nsn: '-', unit: 'ใบ', authorized_qty: 1, issued_qty: 0, received_qty: 0, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 0, depot_reserve_qty: 0, allow_over_authorized: false, is_serialized: false },
  { id: 'ITM-016', seq_no: 16, supply_line: 'สาย พธ.', category: '2. หมวด อส. / อาคารสถานที่', item_name: 'ชุดรับแขก', nsn: '-', unit: 'ชุด', authorized_qty: 1, issued_qty: 0, received_qty: 0, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 0, depot_reserve_qty: 0, allow_over_authorized: false, is_serialized: false },
  { id: 'ITM-017', seq_no: 17, supply_line: 'สาย พธ.', category: '2. หมวด อส. / อาคารสถานที่', item_name: 'ชุดเครื่องนอน และเครื่องประกอบห้องนายทหารเวร', nsn: '-', unit: 'ชุด', authorized_qty: 1, issued_qty: 0, received_qty: 0, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 0, depot_reserve_qty: 0, allow_over_authorized: false, is_serialized: false },
  { id: 'ITM-018', seq_no: 18, supply_line: 'สาย พธ.', category: '2. หมวด อส. / อาคารสถานที่', item_name: 'ชุดโต๊ะหมู่บูชา', nsn: '-', unit: 'ชุด', authorized_qty: 1, issued_qty: 0, received_qty: 0, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 0, depot_reserve_qty: 0, allow_over_authorized: false, is_serialized: false },
  { id: 'ITM-019', seq_no: 19, supply_line: 'สาย พธ.', category: '2. หมวด อส. / อาคารสถานที่', item_name: 'ตู้เหล็กเก็บเอกสารแบบประตู', nsn: '7110-35-235-5280', unit: 'ตู้', authorized_qty: 3, issued_qty: 1, received_qty: 1, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 1, depot_reserve_qty: 0, allow_over_authorized: false, is_serialized: false },
  { id: 'ITM-020', seq_no: 20, supply_line: 'สาย พธ.', category: '2. หมวด อส. / อาคารสถานที่', item_name: 'ตู้เหล็กเก็บเอกสารแบบลิ้นชัก (4 ลิ้นชัก)', nsn: '-', unit: 'ตู้', authorized_qty: 23, issued_qty: 1, received_qty: 1, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 1, depot_reserve_qty: 0, allow_over_authorized: false, is_serialized: false },
  { id: 'ITM-021', seq_no: 21, supply_line: 'สาย พธ.', category: '2. หมวด อส. / อาคารสถานที่', item_name: 'พานกะไหล่ทอง', nsn: '-', unit: 'อัน', authorized_qty: 1, issued_qty: 0, received_qty: 0, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 0, depot_reserve_qty: 0, allow_over_authorized: false, is_serialized: false },
  { id: 'ITM-022', seq_no: 22, supply_line: 'สาย พธ.', category: '2. หมวด อส. / อาคารสถานที่', item_name: 'หีบใส่เงิน', nsn: '-', unit: 'หีบ', authorized_qty: 1, issued_qty: 0, received_qty: 0, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 0, depot_reserve_qty: 0, allow_over_authorized: false, is_serialized: false },
  { id: 'ITM-023', seq_no: 23, supply_line: 'สาย พธ.', category: '2. หมวด อส. / อาคารสถานที่', item_name: 'เครื่องคำนวณเลข', nsn: '-', unit: 'เครื่อง', authorized_qty: 1, issued_qty: 0, received_qty: 0, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 0, depot_reserve_qty: 0, allow_over_authorized: false, is_serialized: true },
  { id: 'ITM-024', seq_no: 24, supply_line: 'สาย พธ.', category: '2. หมวด อส. / อาคารสถานที่', item_name: 'เครื่องถ่ายเอกสาร', nsn: '-', unit: 'เครื่อง', authorized_qty: 1, issued_qty: 0, received_qty: 0, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 0, depot_reserve_qty: 0, allow_over_authorized: false, is_serialized: true },
  { id: 'ITM-025', seq_no: 25, supply_line: 'สาย พธ.', category: '2. หมวด อส. / อาคารสถานที่', item_name: 'เครื่องพิมพ์ดีดตั้งโต๊ะแบบธรรมดา (ไทยแคร่ยาว)', nsn: '-', unit: 'เครื่อง', authorized_qty: 4, issued_qty: 4, received_qty: 4, in_repair_qty: 0, pending_disposal_qty: 4, unserviceable_qty: 4, serviceable_qty: 0, depot_reserve_qty: 0, allow_over_authorized: false, is_serialized: true },
  { id: 'ITM-026', seq_no: 26, supply_line: 'สาย พธ.', category: '2. หมวด อส. / อาคารสถานที่', item_name: 'โต๊ะประจำแผนกพร้อมเก้าอี้', nsn: '7110-35-238-5529', unit: 'ชุด', authorized_qty: 45, issued_qty: 11, received_qty: 11, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 11, depot_reserve_qty: 0, allow_over_authorized: false, is_serialized: false },
  { id: 'ITM-027', seq_no: 27, supply_line: 'สาย พธ.', category: '2. หมวด อส. / อาคารสถานที่', item_name: 'โต๊ะพิมพ์ดีดมาตรฐานพร้อมเก้าอี้', nsn: '7110-35-238-5530', unit: 'ชุด', authorized_qty: 4, issued_qty: 4, received_qty: 4, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 4, depot_reserve_qty: 0, allow_over_authorized: false, is_serialized: false },
  { id: 'ITM-028', seq_no: 28, supply_line: 'สาย พธ.', category: '2. หมวด อส. / อาคารสถานที่', item_name: 'โต๊ะหัวหน้ากองพร้อมเก้าอี้', nsn: '7110-35-238-5530', unit: 'ชุด', authorized_qty: 1, issued_qty: 1, received_qty: 1, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 1, depot_reserve_qty: 0, allow_over_authorized: false, is_serialized: false },
  { id: 'ITM-029', seq_no: 29, supply_line: 'สาย พธ.', category: '2. หมวด อส. / อาคารสถานที่', item_name: 'โต๊ะหัวหน้าแผนกพร้อมเก้าอี้', nsn: '7110-35-238-5529', unit: 'ชุด', authorized_qty: 1, issued_qty: 1, received_qty: 1, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 1, depot_reserve_qty: 0, allow_over_authorized: false, is_serialized: false },
  { id: 'ITM-030', seq_no: 30, supply_line: 'สาย พธ.', category: '2. หมวด อส. / อาคารสถานที่', item_name: 'โต๊ะเสมียนพร้อมเก้าอี้', nsn: '7110-35-238-5530', unit: 'ชุด', authorized_qty: 126, issued_qty: 8, received_qty: 8, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 8, depot_reserve_qty: 0, allow_over_authorized: false, is_serialized: false },
  { id: 'ITM-031', seq_no: 31, supply_line: 'สาย พธ.', category: '3. หมวด อจย.', item_name: 'ตะเกียงเจ้าพายุ', nsn: '-', unit: 'ดวง', authorized_qty: 56, issued_qty: 0, received_qty: 0, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 0, depot_reserve_qty: 0, allow_over_authorized: false, is_serialized: false },
  { id: 'ITM-032', seq_no: 32, supply_line: 'สาย พธ.', category: '3. หมวด อจย.', item_name: 'ถังน้ำมันขนาด 20 ลิตร', nsn: '5430-77-246-1131', unit: 'ถัง', authorized_qty: 2, issued_qty: 3, received_qty: 3, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 3, depot_reserve_qty: 0, allow_over_authorized: true, is_serialized: false },
  { id: 'ITM-033', seq_no: 33, supply_line: 'สาย พธ.', category: '3. หมวด อจย.', item_name: 'เครื่องพิมพ์ดีดแบบกระเป๋าหิ้ว (ภาษาไทย)', nsn: '7430-35-237-5091', unit: 'เครื่อง', authorized_qty: 89, issued_qty: 48, received_qty: 48, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 48, depot_reserve_qty: 0, allow_over_authorized: true, is_serialized: true },
  { id: 'ITM-034', seq_no: 34, supply_line: 'สาย พธ.', category: '3. หมวด อจย.', item_name: 'เครื่องสูบถ่ายน้ำมัน ขนาด 20 ลิตร/นาที', nsn: '-', unit: 'เครื่อง', authorized_qty: 2, issued_qty: 19, received_qty: 19, in_repair_qty: 0, pending_disposal_qty: 0, unserviceable_qty: 0, serviceable_qty: 19, depot_reserve_qty: 0, allow_over_authorized: true, is_serialized: true }
];

/**
 * ตรวจสอบสมดุลบัญชีคุมสิ่งอุปกรณ์ 3 สมการหลัก (Accounting Invariants)
 * @param {Object} item
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateAccountingInvariants(item) {
  const errors = [];
  const recv = Number(item.received_qty || 0);
  const iss = Number(item.issued_qty || 0);
  const res = Number(item.depot_reserve_qty || 0);
  const serv = Number(item.serviceable_qty || 0);
  const unserv = Number(item.unserviceable_qty || 0);
  const rep = Number(item.in_repair_qty || 0);
  const disp = Number(item.pending_disposal_qty || 0);

  if (recv < 0 || iss < 0 || res < 0 || serv < 0 || unserv < 0 || rep < 0 || disp < 0) {
    errors.push('พบค่าจำนวนสิ่งอุปกรณ์ติดลบในรายการ ' + (item.id || 'UNKNOWN'));
  }
  if (recv !== iss + res) {
    errors.push(`ยอดรับทั้งสิ้น (${recv}) ไม่เท่ากับ ยอดจ่าย (${iss}) + คงคลัง (${res})`);
  }
  if (recv !== serv + unserv) {
    errors.push(`ยอดรับทั้งสิ้น (${recv}) ไม่เท่ากับ ใช้การได้ (${serv}) + ใช้การไม่ได้ (${unserv})`);
  }
  if (unserv !== rep + disp) {
    errors.push(`ยอดใช้การไม่ได้ (${unserv}) ไม่เท่ากับ ระหว่างซ่อม (${rep}) + รอจำหน่าย (${disp})`);
  }

  return { valid: errors.length === 0, errors: errors };
}

if (typeof module !== 'undefined') {
  module.exports = {
    APP_CONFIG, SHEETS, ROLES, FORM_TYPES, DOC_STATUS, ERROR_CODES,
    TABLE_SCHEMAS, UNITS_SEED, USERS_SEED, ITEMS_SEED, validateAccountingInvariants
  };
}