/**
 * LOGSMIS - กรมทหารพรานที่ 46
 * TransactionEngine.gs: Core Logistics Workflows with Concurrency & Accounting Control
 */

/**
 * ตรวจสอบ Idempotency Key ป้องกันการกดบันทึกหรืออนุมัติซ้ำ
 */
function checkAndStoreIdempotency(idempotencyKey, resultObj) {
  if (!idempotencyKey) return null;
  const cache = CacheService.getScriptCache();
  const key = 'IDEMP_' + idempotencyKey;
  if (resultObj === undefined) {
    const cached = cache.get(key);
    return cached ? JSON.parse(cached) : null;
  }
  cache.put(key, JSON.stringify(resultObj), APP_CONFIG.IDEMPOTENCY_TTL_SEC);
  return resultObj;
}

/**
 * 1. สร้างใบเบิก / ใบส่งคืน / ใบเบิกเพิ่มเติมหน่วยเหนือ (ทบ.400-006)
 */
function createRequisition(sessionToken, payload, requestId) {
  const actor = requireSession(sessionToken, [ROLES.OPERATOR, ROLES.INSPECTOR]);
  const itemId = sanitizeInput(payload.item_id, 32);
  const deptId = sanitizeInput(payload.dept_id, 32);
  const txDirection = sanitizeInput(payload.tx_direction, 20); // ISSUE | HQ_REQUEST | RETURN
  const qty = Number(payload.qty_requested || 0);
  const reason = sanitizeInput(payload.reason, 300);
  const serialNumber = sanitizeInput(payload.serial_number || '-', 80);
  const assignedPersonnel = sanitizeInput(payload.assigned_personnel_id || '-', 80);

  if (!itemId || !deptId || !Number.isInteger(qty) || qty <= 0) {
    throw createAppError(ERROR_CODES.VALIDATION, 'ข้อมูลรายการ สป., หน่วยรับ หรือจำนวนที่ขอเบิกไม่ถูกต้อง');
  }
  if (['ISSUE', 'HQ_REQUEST', 'RETURN'].indexOf(txDirection) === -1) {
    throw createAppError(ERROR_CODES.VALIDATION, 'ประเภทธุรกรรมต้องเป็น ISSUE, HQ_REQUEST หรือ RETURN');
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(APP_CONFIG.LOCK_TIMEOUT_MS)) {
    throw createAppError(ERROR_CODES.BUSY, 'ระบบกำลังประมวลผลคำขออื่น กรุณารอสักครู่');
  }

  try {
    repoInvalidateCache();
    const items = repoGetAll(SHEETS.ITEMS, true);
    const units = repoGetAll(SHEETS.UNITS, true);
    const item = items.find(function (i) { return i.id === itemId; });
    const unit = units.find(function (u) { return u.id === deptId; });

    if (!item) throw createAppError(ERROR_CODES.NOT_FOUND, `ไม่พบรหัสสิ่งอุปกรณ์ ${itemId}`);
    if (!unit) throw createAppError(ERROR_CODES.NOT_FOUND, `ไม่พบรหัสหน่วย ${deptId}`);

    if (!canAccessSupplyLine(actor, item.supply_line)) {
      throw createAppError(ERROR_CODES.FORBIDDEN, `คุณไม่มีสิทธิ์สร้างเอกสารใน ${item.supply_line}`);
    }

    // ตรวจสอบยอดคงคลังก่อนสร้างใบเบิกจ่ายจากคลังหน่วย
    if (txDirection === 'ISSUE' && Number(item.depot_reserve_qty) < qty) {
      throw createAppError(
        ERROR_CODES.INSUFFICIENT_STOCK,
        `ยอดคงเหลือในคลังหน่วยไม่เพียงพอ (คงเหลือ ${item.depot_reserve_qty} ${item.unit}) หากต้องการเบิกเพิ่มเติมจากหน่วยเหนือ กรุณาเลือกประเภท "เบิกเพิ่มเติมจากหน่วยเหนือ (HQ_REQUEST)"`
      );
    }

    if (txDirection === 'RETURN') {
      const balances = repoGetAll(SHEETS.UNIT_BALANCES, true);
      const unitBal = balances.find(function (b) { return b.unit_id === deptId && b.item_id === itemId; });
      const heldQty = unitBal ? Number(unitBal.serviceable_qty || 0) : 0;
      if (heldQty < qty) {
        throw createAppError(ERROR_CODES.INSUFFICIENT_STOCK, `หน่วย ${unit.unit_name} มียอดใช้การได้สำหรับส่งคืนเพียง ${heldQty} ${item.unit}`);
      }
    }

    const now = new Date().toISOString();
    const reqId = 'REQ-' + Utilities.getUuid().split('-')[0].toUpperCase();
    const docNo = generateOfficialDocNo('REQ-46-006', SHEETS.REQUISITIONS, 'doc_no');

    // หากผู้สร้างเป็น INSPECTOR (เช่น ฝอ.5) ข้ามไปรอ ผบ.กรม อนุมัติทันที
    const initialStatus = actor.role === ROLES.INSPECTOR
      ? DOC_STATUS.PENDING_APPROVAL
      : DOC_STATUS.PENDING_INSPECTION;

    const record = {
      id: reqId,
      doc_no: docNo,
      form_type: '400-006',
      req_type: txDirection === 'HQ_REQUEST' ? 'SUPPLEMENT' : (txDirection === 'RETURN' ? 'RETURN' : 'ISSUE'),
      dept_id: unit.id,
      dept_code: unit.unit_code,
      dept_name: unit.unit_name,
      dept_type: unit.unit_type,
      assigned_personnel_id: assignedPersonnel,
      serial_number: serialNumber,
      item_id: item.id,
      item_name: item.item_name,
      qty_requested: qty,
      tx_direction: txDirection,
      reason: reason || 'เบิกใช้ในราชการสนาม/ประจำหน่วย',
      operator_id: actor.id,
      operator_name: actor.rank_name,
      inspector_id: actor.role === ROLES.INSPECTOR ? actor.id : '',
      inspector_name: actor.role === ROLES.INSPECTOR ? actor.rank_name : '',
      approver_id: '',
      approver_name: '',
      reject_reason: '',
      status: initialStatus,
      rev: 1,
      created_at: now,
      updated_at: now
    };

    repoAppendRecords(SHEETS.REQUISITIONS, [record]);
    writeAuditLog(requestId, `${actor.id} (${actor.rank_name})`, 'CREATE_REQUISITION', reqId, {}, record);
    SpreadsheetApp.flush();

    dispatchNotification(
      'ใบเบิก/ส่งคืน สป. ใหม่ (ทบ.400-006)',
      `เลขที่: ${docNo}\nหน่วย: ${unit.unit_name}\nรายการ: ${item.item_name} จำนวน ${qty} ${item.unit}\nผู้ดำเนินการ: ${actor.rank_name}`
    );

    return record;
  } finally {
    lock.releaseLock();
  }
}

/**
 * 2. ขั้นตอนตรวจสอบใบเบิกโดย ฝอ.5 / น.ส่งกำลังบำรุง (INSPECTOR)
 */
function inspectRequisition(sessionToken, payload, requestId) {
  const actor = requireSession(sessionToken, [ROLES.INSPECTOR]);
  const reqId = sanitizeInput(payload.req_id, 32);
  const expectedRev = Number(payload.expected_rev || 0);
  const decision = sanitizeInput(payload.decision, 20); // INSPECTED | REJECTED
  const remark = sanitizeInput(payload.remark, 250);

  if (!reqId || ['INSPECTED', 'REJECTED'].indexOf(decision) === -1) {
    throw createAppError(ERROR_CODES.VALIDATION, 'ข้อมูลการตรวจสอบเอกสารไม่ถูกต้อง');
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(APP_CONFIG.LOCK_TIMEOUT_MS)) {
    throw createAppError(ERROR_CODES.BUSY, 'ระบบกำลังประมวลผล กรุณาลองใหม่');
  }

  try {
    repoInvalidateCache();
    const reqs = repoGetAll(SHEETS.REQUISITIONS, true);
    const req = reqs.find(function (r) { return r.id === reqId; });
    if (!req) throw createAppError(ERROR_CODES.NOT_FOUND, `ไม่พบใบเบิกเลขที่ ${reqId}`);

    if (Number(req.rev) !== expectedRev) {
      throw createAppError(ERROR_CODES.CONCURRENCY, 'เอกสารมีการเปลี่ยนแปลงโดยผู้ใช้อื่น กรุณารีเฟรชหน้าจอ');
    }
    if (req.status !== DOC_STATUS.PENDING_INSPECTION) {
      throw createAppError(ERROR_CODES.VALIDATION, `ไม่สามารถตรวจสอบเอกสารในสถานะ ${req.status} ได้`);
    }

    const now = new Date().toISOString();
    const nextStatus = decision === 'INSPECTED' ? DOC_STATUS.PENDING_APPROVAL : DOC_STATUS.REJECTED;
    const patch = {
      inspector_id: actor.id,
      inspector_name: actor.rank_name,
      status: nextStatus,
      reject_reason: decision === 'REJECTED' ? (remark || 'ไม่ผ่านการตรวจสอบจาก ฝอ.๕') : '',
      rev: expectedRev + 1,
      updated_at: now
    };

    repoUpdateRecord(SHEETS.REQUISITIONS, reqId, patch);
    writeAuditLog(requestId, `${actor.id} (${actor.rank_name})`, 'INSPECT_REQUISITION', reqId, { status: req.status }, patch);
    SpreadsheetApp.flush();

    return { id: reqId, status: nextStatus, rev: patch.rev };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 3. ขั้นตอนอนุมัติและตัดยอดบัญชีโดย ผบ.กรม ทพ.46 (APPROVER)
 */
function approveRequisition(sessionToken, payload, requestId, idempotencyKey) {
  const actor = requireSession(sessionToken, [ROLES.APPROVER]);
  const cachedRes = checkAndStoreIdempotency(idempotencyKey);
  if (cachedRes) return cachedRes;

  const reqId = sanitizeInput(payload.req_id, 32);
  const expectedRev = Number(payload.expected_rev || 0);
  const decision = sanitizeInput(payload.decision, 20); // APPROVED | REJECTED
  const remark = sanitizeInput(payload.remark, 250);

  if (!reqId || ['APPROVED', 'REJECTED'].indexOf(decision) === -1) {
    throw createAppError(ERROR_CODES.VALIDATION, 'คำสั่งอนุมัติไม่ถูกต้อง');
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(APP_CONFIG.LOCK_TIMEOUT_MS)) {
    throw createAppError(ERROR_CODES.BUSY, 'ระบบกำลังประมวลผลธุรกรรมอื่น กรุณาลองใหม่');
  }

  try {
    repoInvalidateCache();
    const reqs = repoGetAll(SHEETS.REQUISITIONS, true);
    const req = reqs.find(function (r) { return r.id === reqId; });
    if (!req) throw createAppError(ERROR_CODES.NOT_FOUND, `ไม่พบใบเบิกเลขที่ ${reqId}`);

    if (req.operator_id === actor.id) {
      throw createAppError(ERROR_CODES.FORBIDDEN, 'ตามหลักการควบคุมภายใน ผู้อนุมัติต้องไม่เป็นบุคคลเดียวกับผู้สร้างใบเบิก');
    }
    if (Number(req.rev) !== expectedRev) {
      throw createAppError(ERROR_CODES.CONCURRENCY, 'เอกสารมีการแก้ไขแล้ว กรุณาโหลดข้อมูลล่าสุด');
    }
    if (req.status !== DOC_STATUS.PENDING_APPROVAL) {
      throw createAppError(ERROR_CODES.VALIDATION, `เอกสารไม่อยู่ในสถานะรออนุมัติ (สถานะปัจจุบัน: ${req.status})`);
    }

    const now = new Date().toISOString();

    if (decision === 'REJECTED') {
      const rejectPatch = {
        approver_id: actor.id,
        approver_name: actor.rank_name,
        status: DOC_STATUS.REJECTED,
        reject_reason: remark || 'ไม่อนุมัติ',
        rev: expectedRev + 1,
        updated_at: now
      };
      repoUpdateRecord(SHEETS.REQUISITIONS, reqId, rejectPatch);
      writeAuditLog(requestId, `${actor.id} (${actor.rank_name})`, 'REJECT_REQUISITION', reqId, { status: req.status }, rejectPatch);
      SpreadsheetApp.flush();
      const resObj = { id: reqId, status: DOC_STATUS.REJECTED, rev: rejectPatch.rev };
      return checkAndStoreIdempotency(idempotencyKey, resObj);
    }

    // กรณีอนุมัติ (APPROVED) -> ปรับปรุงยอดคงคลังและยอดประจำหน่วย
    const items = repoGetAll(SHEETS.ITEMS, true);
    const item = items.find(function (i) { return i.id === req.item_id; });
    if (!item) throw createAppError(ERROR_CODES.NOT_FOUND, `ไม่พบรายการ สป. ${req.item_id}`);

    const qty = Number(req.qty_requested);
    const beforeDepot = Number(item.depot_reserve_qty);
    const beforeIssued = Number(item.issued_qty);
    let afterDepot = beforeDepot;
    let afterIssued = beforeIssued;

    if (req.tx_direction === 'ISSUE') {
      if (beforeDepot < qty) {
        throw createAppError(ERROR_CODES.INSUFFICIENT_STOCK, `ยอดคงคลังไม่เพียงพอ (เหลือ ${beforeDepot} ${item.unit}) ไม่สามารถอนุมัติจ่ายได้`);
      }
      afterDepot = beforeDepot - qty;
      afterIssued = beforeIssued + qty;
    } else if (req.tx_direction === 'RETURN') {
      if (beforeIssued < qty) {
        throw createAppError(ERROR_CODES.INSUFFICIENT_STOCK, `ยอดจ่ายประจำหน่วยน้อยกว่าจำนวนส่งคืน (${beforeIssued} < ${qty})`);
      }
      afterDepot = beforeDepot + qty;
      afterIssued = beforeIssued - qty;
    } else if (req.tx_direction === 'HQ_REQUEST') {
      // เบิกเพิ่มเติมจากหน่วยเหนือ: อนุมัติเอกสารเพื่อส่งเบิกหน่วยเหนือ ยอดคลังจะเพิ่มเมื่อตรวจรับของจริง
      afterDepot = beforeDepot;
      afterIssued = beforeIssued;
    }

    const updatedItemCheck = Object.assign({}, item, {
      depot_reserve_qty: afterDepot,
      issued_qty: afterIssued
    });
    const invCheck = validateAccountingInvariants(updatedItemCheck);
    if (!invCheck.valid) {
      throw createAppError(ERROR_CODES.INVARIANT_VIOLATION, invCheck.errors.join('; '));
    }

    // อัปเดตยอดคงเหลือรายหน่วย (DB_UNIT_BALANCES) สำหรับ ISSUE และ RETURN
    if (req.tx_direction === 'ISSUE' || req.tx_direction === 'RETURN') {
      const deltaUnit = req.tx_direction === 'ISSUE' ? qty : -qty;
      upsertUnitBalanceDelta(req.dept_id, req.dept_code, req.dept_name, item.id, item.item_name, deltaUnit, deltaUnit, 0, 0, now);

      repoUpdateRecord(SHEETS.ITEMS, item.id, {
        depot_reserve_qty: afterDepot,
        issued_qty: afterIssued,
        rev: Number(item.rev || 1) + 1,
        updated_at: now
      });
    }

    const approvePatch = {
      approver_id: actor.id,
      approver_name: actor.rank_name,
      status: DOC_STATUS.APPROVED,
      rev: expectedRev + 1,
      updated_at: now
    };
    repoUpdateRecord(SHEETS.REQUISITIONS, reqId, approvePatch);

    repoAppendRecords(SHEETS.TX_LEDGER, [{
      tx_id: 'TX-' + Utilities.getUuid().split('-')[0].toUpperCase(),
      idempotency_key: idempotencyKey || '',
      request_id: requestId || '',
      timestamp: now,
      tx_type: 'REQUISITION_' + req.tx_direction,
      form_type: req.form_type,
      ref_doc_id: req.id,
      ref_doc_no: req.doc_no,
      unit_id: req.dept_id,
      unit_name: req.dept_name,
      item_id: item.id,
      item_name: item.item_name,
      delta_qty: req.tx_direction === 'RETURN' ? -qty : qty,
      before_depot_qty: beforeDepot,
      after_depot_qty: afterDepot,
      before_issued_qty: beforeIssued,
      after_issued_qty: afterIssued,
      actor_id: actor.id,
      actor_name: actor.rank_name,
      remark: remark || req.reason
    }]);

    writeAuditLog(requestId, `${actor.id} (${actor.rank_name})`, 'APPROVE_REQUISITION', reqId, { depot: beforeDepot, issued: beforeIssued }, { depot: afterDepot, issued: afterIssued });
    SpreadsheetApp.flush();

    dispatchNotification(
      'อนุมัติใบเบิก/ส่งคืน สป. แล้ว',
      `เลขที่: ${req.doc_no}\nหน่วย: ${req.dept_name}\nรายการ: ${item.item_name} (${qty} ${item.unit})\nผู้อนุมัติ: ${actor.rank_name}`
    );

    const resObj = { id: reqId, status: DOC_STATUS.APPROVED, rev: approvePatch.rev, afterDepot: afterDepot, afterIssued: afterIssued };
    return checkAndStoreIdempotency(idempotencyKey, resObj);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 4. บันทึกรับสิ่งอุปกรณ์เข้าคลังหน่วยจากหน่วยสนับสนุน (ตามสิทธิ์ can_receive_sp 3.1 - 3.10)
 */
function receiveSupplyIntoDepot(sessionToken, payload, requestId) {
  const actor = requireSession(sessionToken, [ROLES.OPERATOR, ROLES.INSPECTOR]);
  const itemId = sanitizeInput(payload.item_id, 32);
  const qty = Number(payload.qty_received || 0);
  const refVoucher = sanitizeInput(payload.ref_voucher, 120);
  const specialOrderRef = sanitizeInput(payload.special_order_ref, 150);

  if (!itemId || !Number.isInteger(qty) || qty <= 0 || !refVoucher) {
    throw createAppError(ERROR_CODES.VALIDATION, 'กรุณาระบุรายการ สป. จำนวนที่ตรวจรับ และเลขที่หลักฐานใบส่งของ');
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(APP_CONFIG.LOCK_TIMEOUT_MS)) {
    throw createAppError(ERROR_CODES.BUSY, 'ระบบกำลังประมวลผล กรุณาลองใหม่');
  }

  try {
    repoInvalidateCache();
    const items = repoGetAll(SHEETS.ITEMS, true);
    const item = items.find(function (i) { return i.id === itemId; });
    if (!item) throw createAppError(ERROR_CODES.NOT_FOUND, `ไม่พบรายการ สป. ${itemId}`);

    if (!canReceiveSupply(actor, item.supply_line)) {
      throw createAppError(ERROR_CODES.FORBIDDEN, `คุณไม่มีสิทธิ์ตรวจรับ สป. ใน ${item.supply_line} (สิทธิ์: ${actor.can_receive_sp})`);
    }

    const beforeRecv = Number(item.received_qty);
    const beforeDepot = Number(item.depot_reserve_qty);
    const beforeServ = Number(item.serviceable_qty);
    const authQty = Number(item.authorized_qty);

    const afterRecv = beforeRecv + qty;
    const afterDepot = beforeDepot + qty;
    const afterServ = beforeServ + qty;

    if (afterRecv > authQty && !item.allow_over_authorized && !specialOrderRef) {
      throw createAppError(
        ERROR_CODES.VALIDATION,
        `การรับครั้งนี้ทำให้ยอดรับรวม (${afterRecv}) เกินอัตราอนุมัติ (${authQty}) กรุณาระบุเลขที่คำสั่งอนุมัติรับเกินอัตรา`
      );
    }

    const updatedCheck = Object.assign({}, item, {
      received_qty: afterRecv,
      depot_reserve_qty: afterDepot,
      serviceable_qty: afterServ
    });
    const invCheck = validateAccountingInvariants(updatedCheck);
    if (!invCheck.valid) {
      throw createAppError(ERROR_CODES.INVARIANT_VIOLATION, invCheck.errors.join('; '));
    }

    const now = new Date().toISOString();
    repoUpdateRecord(SHEETS.ITEMS, item.id, {
      received_qty: afterRecv,
      depot_reserve_qty: afterDepot,
      serviceable_qty: afterServ,
      allow_over_authorized: afterRecv > authQty ? true : item.allow_over_authorized,
      rev: Number(item.rev || 1) + 1,
      updated_at: now
    });

    repoAppendRecords(SHEETS.TX_LEDGER, [{
      tx_id: 'TX-' + Utilities.getUuid().split('-')[0].toUpperCase(),
      idempotency_key: '',
      request_id: requestId || '',
      timestamp: now,
      tx_type: 'DEPOT_RECEIPT',
      form_type: FORM_TYPES.LEDGER_CARD_UNIT,
      ref_doc_id: refVoucher,
      ref_doc_no: refVoucher,
      unit_id: 'DPT-HQ',
      unit_name: 'คลัง พธ. กรม ทพ.๔๖',
      item_id: item.id,
      item_name: item.item_name,
      delta_qty: qty,
      before_depot_qty: beforeDepot,
      after_depot_qty: afterDepot,
      before_issued_qty: Number(item.issued_qty),
      after_issued_qty: Number(item.issued_qty),
      actor_id: actor.id,
      actor_name: actor.rank_name,
      remark: specialOrderRef ? `รับเกินอัตราตาม: ${specialOrderRef}` : `ตรวจรับตามหลักฐาน: ${refVoucher}`
    }]);

    writeAuditLog(requestId, `${actor.id} (${actor.rank_name})`, 'RECEIVE_SUPPLY', item.id, { received_qty: beforeRecv }, { received_qty: afterRecv, refVoucher: refVoucher });
    SpreadsheetApp.flush();

    return { itemId: item.id, afterReceived: afterRecv, afterDepot: afterDepot };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 5. ส่งซ่อมบำรุงและรับคืนจากการซ่อม (DB_REPAIRS)
 */
function manageRepairOrder(sessionToken, payload, requestId) {
  const actor = requireSession(sessionToken, [ROLES.OPERATOR, ROLES.INSPECTOR, ROLES.APPROVER]);
  const mode = sanitizeInput(payload.mode, 20); // SEND_REPAIR | RETURN_REPAIR

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(APP_CONFIG.LOCK_TIMEOUT_MS)) {
    throw createAppError(ERROR_CODES.BUSY, 'ระบบกำลังประมวลผล กรุณาลองใหม่');
  }

  try {
    repoInvalidateCache();
    const items = repoGetAll(SHEETS.ITEMS, true);
    const units = repoGetAll(SHEETS.UNITS, true);
    const now = new Date().toISOString();

    if (mode === 'SEND_REPAIR') {
      const deptId = sanitizeInput(payload.dept_id, 32);
      const itemId = sanitizeInput(payload.item_id, 32);
      const qty = Number(payload.qty_sent || 0);
      const symptom = sanitizeInput(payload.defect_symptom, 300);
      const serialNo = sanitizeInput(payload.serial_number || '-', 80);

      if (!deptId || !itemId || !Number.isInteger(qty) || qty <= 0 || !symptom) {
        throw createAppError(ERROR_CODES.VALIDATION, 'กรุณาระบุหน่วย รายการ สป. จำนวน และอาการชำรุดให้ครบถ้วน');
      }

      const item = items.find(function (i) { return i.id === itemId; });
      const unit = units.find(function (u) { return u.id === deptId; });
      if (!item || !unit) throw createAppError(ERROR_CODES.NOT_FOUND, 'ไม่พบข้อมูลรายการ สป. หรือหน่วย');
      if (!canAccessSupplyLine(actor, item.supply_line)) {
        throw createAppError(ERROR_CODES.FORBIDDEN, 'คุณไม่มีสิทธิ์ทำรายการในสายงานนี้');
      }
      if (Number(item.serviceable_qty) < qty) {
        throw createAppError(ERROR_CODES.INSUFFICIENT_STOCK, `ยอดใช้การได้คงเหลือไม่เพียงพอสำหรับส่งซ่อม (${item.serviceable_qty} ${item.unit})`);
      }

      const afterServ = Number(item.serviceable_qty) - qty;
      const afterRepair = Number(item.in_repair_qty) + qty;
      const afterUnserv = Number(item.unserviceable_qty) + qty;

      const invCheck = validateAccountingInvariants(Object.assign({}, item, {
        serviceable_qty: afterServ,
        in_repair_qty: afterRepair,
        unserviceable_qty: afterUnserv
      }));
      if (!invCheck.valid) throw createAppError(ERROR_CODES.INVARIANT_VIOLATION, invCheck.errors.join('; '));

      const repairId = 'REP-' + Utilities.getUuid().split('-')[0].toUpperCase();
      const repairNo = generateOfficialDocNo('REP-46', SHEETS.REPAIRS, 'repair_no');

      repoAppendRecords(SHEETS.REPAIRS, [{
        id: repairId,
        repair_no: repairNo,
        form_type: '400-006',
        dept_id: unit.id,
        dept_name: unit.unit_name,
        item_id: item.id,
        item_name: item.item_name,
        nsn: item.nsn,
        qty_sent: qty,
        qty_returned: 0,
        defect_symptom: symptom,
        assigned_personnel_id: '-',
        serial_number: serialNo,
        operator_id: actor.id,
        operator_name: actor.rank_name,
        approver_name: '',
        status: DOC_STATUS.IN_REPAIR,
        rev: 1,
        created_at: now,
        updated_at: now
      }]);

      repoUpdateRecord(SHEETS.ITEMS, item.id, {
        serviceable_qty: afterServ,
        in_repair_qty: afterRepair,
        unserviceable_qty: afterUnserv,
        rev: Number(item.rev || 1) + 1,
        updated_at: now
      });

      upsertUnitBalanceDelta(unit.id, unit.unit_code, unit.unit_name, item.id, item.item_name, 0, -qty, qty, 0, now);
      writeAuditLog(requestId, `${actor.id} (${actor.rank_name})`, 'SEND_REPAIR', repairId, {}, { repairNo: repairNo, qty: qty });
      SpreadsheetApp.flush();

      return { id: repairId, repairNo: repairNo, status: DOC_STATUS.IN_REPAIR };
    }

    if (mode === 'RETURN_REPAIR') {
      const repairId = sanitizeInput(payload.repair_id, 32);
      const qtyReturn = Number(payload.qty_returned || 0);
      const repairs = repoGetAll(SHEETS.REPAIRS, true);
      const rep = repairs.find(function (r) { return r.id === repairId; });
      if (!rep) throw createAppError(ERROR_CODES.NOT_FOUND, `ไม่พบใบส่งซ่อม ${repairId}`);

      const remaining = Number(rep.qty_sent) - Number(rep.qty_returned || 0);
      if (!Number.isInteger(qtyReturn) || qtyReturn <= 0 || qtyReturn > remaining) {
        throw createAppError(ERROR_CODES.VALIDATION, `จำนวนรับคืนจากการซ่อมต้องอยู่ระหว่าง 1 ถึง ${remaining}`);
      }

      const item = items.find(function (i) { return i.id === rep.item_id; });
      const afterServ = Number(item.serviceable_qty) + qtyReturn;
      const afterRepair = Number(item.in_repair_qty) - qtyReturn;
      const afterUnserv = Number(item.unserviceable_qty) - qtyReturn;

      const invCheck = validateAccountingInvariants(Object.assign({}, item, {
        serviceable_qty: afterServ,
        in_repair_qty: afterRepair,
        unserviceable_qty: afterUnserv
      }));
      if (!invCheck.valid) throw createAppError(ERROR_CODES.INVARIANT_VIOLATION, invCheck.errors.join('; '));

      const totalReturned = Number(rep.qty_returned || 0) + qtyReturn;
      const nextStatus = totalReturned >= Number(rep.qty_sent) ? DOC_STATUS.REPAIR_COMPLETED : DOC_STATUS.IN_REPAIR;

      repoUpdateRecord(SHEETS.REPAIRS, rep.id, {
        qty_returned: totalReturned,
        status: nextStatus,
        rev: Number(rep.rev || 1) + 1,
        updated_at: now
      });

      repoUpdateRecord(SHEETS.ITEMS, item.id, {
        serviceable_qty: afterServ,
        in_repair_qty: afterRepair,
        unserviceable_qty: afterUnserv,
        rev: Number(item.rev || 1) + 1,
        updated_at: now
      });

      upsertUnitBalanceDelta(rep.dept_id, '', rep.dept_name, item.id, item.item_name, 0, qtyReturn, -qtyReturn, 0, now);
      writeAuditLog(requestId, `${actor.id} (${actor.rank_name})`, 'RETURN_REPAIR', rep.id, {}, { qtyReturned: qtyReturn, status: nextStatus });
      SpreadsheetApp.flush();

      return { id: rep.id, status: nextStatus, totalReturned: totalReturned };
    }

    throw createAppError(ERROR_CODES.VALIDATION, 'โหมดการจัดการซ่อมบำรุงไม่ถูกต้อง');
  } finally {
    lock.releaseLock();
  }
}

/**
 * 6. เสนอจำหน่ายและอนุมัติตัดยอดจำหน่าย (แบบพิมพ์ ทบ.400-065)
 */
function manageDisposalOrder(sessionToken, payload, requestId) {
  const mode = sanitizeInput(payload.mode, 25); // REQUEST_DISPOSAL | APPROVE_DISPOSAL
  const actor = mode === 'APPROVE_DISPOSAL'
    ? requireSession(sessionToken, [ROLES.APPROVER])
    : requireSession(sessionToken, [ROLES.OPERATOR, ROLES.INSPECTOR]);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(APP_CONFIG.LOCK_TIMEOUT_MS)) {
    throw createAppError(ERROR_CODES.BUSY, 'ระบบกำลังประมวลผล กรุณาลองใหม่');
  }

  try {
    repoInvalidateCache();
    const items = repoGetAll(SHEETS.ITEMS, true);
    const units = repoGetAll(SHEETS.UNITS, true);
    const now = new Date().toISOString();

    if (mode === 'REQUEST_DISPOSAL') {
      const deptId = sanitizeInput(payload.dept_id, 32);
      const itemId = sanitizeInput(payload.item_id, 32);
      const qty = Number(payload.qty_disposal || 0);
      const reason = sanitizeInput(payload.disposal_reason, 300);
      const committeeRef = sanitizeInput(payload.committee_ref, 180);

      if (!deptId || !itemId || !Number.isInteger(qty) || qty <= 0 || !reason || !committeeRef) {
        throw createAppError(ERROR_CODES.VALIDATION, 'กรุณาระบุข้อมูลหน่วย รายการ จำนวน เหตุผล และคำสั่งตั้งคณะกรรมการสอบสวน');
      }

      const item = items.find(function (i) { return i.id === itemId; });
      const unit = units.find(function (u) { return u.id === deptId; });
      if (!item || !unit) throw createAppError(ERROR_CODES.NOT_FOUND, 'ไม่พบรายการ สป. หรือหน่วย');
      if (Number(item.serviceable_qty) < qty) {
        throw createAppError(ERROR_CODES.INSUFFICIENT_STOCK, `ยอดใช้การได้คงเหลือไม่เพียงพอสำหรับตั้งเรื่องจำหน่าย (${item.serviceable_qty})`);
      }

      const afterServ = Number(item.serviceable_qty) - qty;
      const afterPendingDisp = Number(item.pending_disposal_qty) + qty;
      const afterUnserv = Number(item.unserviceable_qty) + qty;

      const invCheck = validateAccountingInvariants(Object.assign({}, item, {
        serviceable_qty: afterServ,
        pending_disposal_qty: afterPendingDisp,
        unserviceable_qty: afterUnserv
      }));
      if (!invCheck.valid) throw createAppError(ERROR_CODES.INVARIANT_VIOLATION, invCheck.errors.join('; '));

      const dspId = 'DSP-' + Utilities.getUuid().split('-')[0].toUpperCase();
      const dspNo = generateOfficialDocNo('DSP-46-065', SHEETS.DISPOSALS, 'disposal_no');

      repoAppendRecords(SHEETS.DISPOSALS, [{
        id: dspId,
        disposal_no: dspNo,
        form_type: '400-065',
        dept_id: unit.id,
        dept_name: unit.unit_name,
        item_id: item.id,
        item_name: item.item_name,
        nsn: item.nsn,
        qty_disposal: qty,
        source_location: 'UNIT',
        disposal_reason: reason,
        committee_ref: committeeRef,
        operator_id: actor.id,
        operator_name: actor.rank_name,
        approver_id: '',
        approver_name: '',
        status: DOC_STATUS.PENDING_BOARD,
        rev: 1,
        created_at: now,
        updated_at: now
      }]);

      repoUpdateRecord(SHEETS.ITEMS, item.id, {
        serviceable_qty: afterServ,
        pending_disposal_qty: afterPendingDisp,
        unserviceable_qty: afterUnserv,
        rev: Number(item.rev || 1) + 1,
        updated_at: now
      });

      upsertUnitBalanceDelta(unit.id, unit.unit_code, unit.unit_name, item.id, item.item_name, 0, -qty, 0, qty, now);
      writeAuditLog(requestId, `${actor.id} (${actor.rank_name})`, 'REQUEST_DISPOSAL', dspId, {}, { disposalNo: dspNo, qty: qty });
      SpreadsheetApp.flush();

      return { id: dspId, disposalNo: dspNo, status: DOC_STATUS.PENDING_BOARD };
    }

    if (mode === 'APPROVE_DISPOSAL') {
      const dspId = sanitizeInput(payload.disposal_id, 32);
      const disposals = repoGetAll(SHEETS.DISPOSALS, true);
      const dsp = disposals.find(function (d) { return d.id === dspId; });
      if (!dsp) throw createAppError(ERROR_CODES.NOT_FOUND, `ไม่พบใบเสนอจำหน่าย ${dspId}`);
      if (dsp.status !== DOC_STATUS.PENDING_BOARD) {
        throw createAppError(ERROR_CODES.VALIDATION, `เอกสารไม่อยู่ในสถานะรออนุมัติจำหน่าย (${dsp.status})`);
      }

      const item = items.find(function (i) { return i.id === dsp.item_id; });
      const qty = Number(dsp.qty_disposal);

      const afterPendingDisp = Number(item.pending_disposal_qty) - qty;
      const afterUnserv = Number(item.unserviceable_qty) - qty;
      const afterRecv = Number(item.received_qty) - qty;
      const afterIssued = Number(item.issued_qty) >= qty ? Number(item.issued_qty) - qty : Number(item.issued_qty);
      const afterDepot = Number(item.issued_qty) >= qty ? Number(item.depot_reserve_qty) : Number(item.depot_reserve_qty) - qty;

      const invCheck = validateAccountingInvariants(Object.assign({}, item, {
        received_qty: afterRecv,
        issued_qty: afterIssued,
        depot_reserve_qty: afterDepot,
        unserviceable_qty: afterUnserv,
        pending_disposal_qty: afterPendingDisp
      }));
      if (!invCheck.valid) throw createAppError(ERROR_CODES.INVARIANT_VIOLATION, invCheck.errors.join('; '));

      repoUpdateRecord(SHEETS.DISPOSALS, dsp.id, {
        approver_id: actor.id,
        approver_name: actor.rank_name,
        status: DOC_STATUS.DISPOSED,
        rev: Number(dsp.rev || 1) + 1,
        updated_at: now
      });

      repoUpdateRecord(SHEETS.ITEMS, item.id, {
        received_qty: afterRecv,
        issued_qty: afterIssued,
        depot_reserve_qty: afterDepot,
        unserviceable_qty: afterUnserv,
        pending_disposal_qty: afterPendingDisp,
        rev: Number(item.rev || 1) + 1,
        updated_at: now
      });

      upsertUnitBalanceDelta(dsp.dept_id, '', dsp.dept_name, item.id, item.item_name, -qty, 0, 0, -qty, now);

      repoAppendRecords(SHEETS.TX_LEDGER, [{
        tx_id: 'TX-' + Utilities.getUuid().split('-')[0].toUpperCase(),
        idempotency_key: '',
        request_id: requestId || '',
        timestamp: now,
        tx_type: 'DISPOSAL_APPROVED',
        form_type: FORM_TYPES.DISPOSAL_REQUEST,
        ref_doc_id: dsp.id,
        ref_doc_no: dsp.disposal_no,
        unit_id: dsp.dept_id,
        unit_name: dsp.dept_name,
        item_id: item.id,
        item_name: item.item_name,
        delta_qty: -qty,
        before_depot_qty: Number(item.depot_reserve_qty),
        after_depot_qty: afterDepot,
        before_issued_qty: Number(item.issued_qty),
        after_issued_qty: afterIssued,
        actor_id: actor.id,
        actor_name: actor.rank_name,
        remark: `อนุมัติตัดยอดจำหน่ายตาม ${dsp.committee_ref}`
      }]);

      writeAuditLog(requestId, `${actor.id} (${actor.rank_name})`, 'APPROVE_DISPOSAL', dsp.id, { received_qty: item.received_qty }, { received_qty: afterRecv });
      SpreadsheetApp.flush();

      return { id: dsp.id, status: DOC_STATUS.DISPOSED };
    }

    throw createAppError(ERROR_CODES.VALIDATION, 'โหมดการจำหน่ายไม่ถูกต้อง');
  } finally {
    lock.releaseLock();
  }
}

/**
 * 7. บันทึกผลการตรวจสอบยอดสิ่งอุปกรณ์ประจำ 6 เดือน / เปลี่ยนตัวผู้รับผิดชอบ (ทบ.400-011 / 400-012)
 */
function recordSixMonthInventoryAudit(sessionToken, payload, requestId) {
  const actor = requireSession(sessionToken, [ROLES.OPERATOR, ROLES.INSPECTOR, ROLES.APPROVER]);
  const unitId = sanitizeInput(payload.unit_id, 32);
  const auditItems = Array.isArray(payload.items) ? payload.items : [];
  const auditNote = sanitizeInput(payload.audit_note, 300);

  if (!unitId || auditItems.length === 0) {
    throw createAppError(ERROR_CODES.VALIDATION, 'กรุณาระบุหน่วยและรายการผลการตรวจนับ');
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(APP_CONFIG.LOCK_TIMEOUT_MS)) {
    throw createAppError(ERROR_CODES.BUSY, 'ระบบกำลังประมวลผล กรุณาลองใหม่');
  }

  try {
    repoInvalidateCache();
    const balances = repoGetAll(SHEETS.UNIT_BALANCES, true);
    const now = new Date().toISOString();
    const discrepancies = [];

    auditItems.forEach(function (entry) {
      const itemId = sanitizeInput(entry.item_id, 32);
      const physicalCount = Number(entry.physical_qty || 0);
      const bal = balances.find(function (b) { return b.unit_id === unitId && b.item_id === itemId; });
      const bookQty = bal ? Number(bal.issued_qty || 0) : 0;

      if (physicalCount !== bookQty) {
        discrepancies.push({
          item_id: itemId,
          book_qty: bookQty,
          physical_qty: physicalCount,
          diff: physicalCount - bookQty
        });
      }

      if (bal) {
        repoUpdateRecord(SHEETS.UNIT_BALANCES, bal.id, {
          last_audit_date: now,
          rev: Number(bal.rev || 1) + 1,
          updated_at: now
        });
      }
    });

    writeAuditLog(requestId, `${actor.id} (${actor.rank_name})`, 'SIX_MONTH_INVENTORY_AUDIT', unitId, {}, {
      checkedItems: auditItems.length,
      discrepanciesCount: discrepancies.length,
      discrepancies: discrepancies,
      note: auditNote
    });
    SpreadsheetApp.flush();

    return {
      unitId: unitId,
      checkedCount: auditItems.length,
      discrepancies: discrepancies,
      status: discrepancies.length === 0 ? 'MATCHED' : 'DISCREPANCY_FOUND'
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Helper: ปรับปรุงยอดถือครองรายหน่วยใน DB_UNIT_BALANCES
 */
function upsertUnitBalanceDelta(unitId, unitCode, unitName, itemId, itemName, deltaIssued, deltaServ, deltaRepair, deltaDisp, timestamp) {
  const balances = repoGetAll(SHEETS.UNIT_BALANCES, true);
  const existing = balances.find(function (b) {
    return b.unit_id === unitId && b.item_id === itemId;
  });

  if (existing) {
    repoUpdateRecord(SHEETS.UNIT_BALANCES, existing.id, {
      issued_qty: Math.max(0, Number(existing.issued_qty || 0) + deltaIssued),
      serviceable_qty: Math.max(0, Number(existing.serviceable_qty || 0) + deltaServ),
      in_repair_qty: Math.max(0, Number(existing.in_repair_qty || 0) + deltaRepair),
      pending_disposal_qty: Math.max(0, Number(existing.pending_disposal_qty || 0) + deltaDisp),
      rev: Number(existing.rev || 1) + 1,
      updated_at: timestamp
    });
  } else {
    repoAppendRecords(SHEETS.UNIT_BALANCES, [{
      id: 'BAL-' + Utilities.getUuid().split('-')[0].toUpperCase(),
      unit_id: unitId,
      unit_code: unitCode || unitId.replace('DPT-', ''),
      unit_name: unitName,
      item_id: itemId,
      item_name: itemName,
      authorized_qty: 0,
      issued_qty: Math.max(0, deltaIssued),
      serviceable_qty: Math.max(0, deltaServ),
      in_repair_qty: Math.max(0, deltaRepair),
      pending_disposal_qty: Math.max(0, deltaDisp),
      last_audit_date: '',
      rev: 1,
      updated_at: timestamp
    }]);
  }
}