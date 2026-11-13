/**
 * LOGSMIS - กรมทหารพรานที่ 46
 * Main.gs: Web App Entrypoint, Health Check & Unified API Router
 */

/**
 * แสดงผลหน้า Web App หรือคืนค่าสถานะ Liveness Health Check
 */
function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};

  if (params.health === '1') {
    const healthPayload = {
      status: 'UP',
      service: APP_CONFIG.SYSTEM_NAME,
      version: APP_CONFIG.VERSION,
      timestamp: new Date().toISOString()
    };
    return ContentService
      .createTextOutput(JSON.stringify(healthPayload))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const template = HtmlService.createTemplateFromFile('Index');
  template.systemTitle = APP_CONFIG.SYSTEM_NAME;
  template.unitName = APP_CONFIG.UNIT_NAME;
  template.orderRef = PropertiesService.getScriptProperties().getProperty('ORDER_REF') || APP_CONFIG.DEFAULT_ORDER_REF;

  return template
    .evaluate()
    .setTitle('LOGSMIS | บัญชีคุมสิ่งอุปกรณ์ กรมทหารพรานที่ 46')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * ประตูรับคำสั่งกลางจาก Frontend (google.script.run.apiDispatch)
 * @param {Object} envelope - { requestId, idempotencyKey, action, sessionToken, payload }
 */
function apiDispatch(envelope) {
  const startMs = Date.now();
  const req = envelope || {};
  const requestId = sanitizeInput(req.requestId || ('REQ-' + Utilities.getUuid().split('-')[0]), 64);
  const action = sanitizeInput(req.action, 64);
  const sessionToken = req.sessionToken || '';
  const idempotencyKey = sanitizeInput(req.idempotencyKey || '', 80);
  const payload = req.payload || {};

  try {
    let data = null;

    switch (action) {
      case 'auth.directory':
        data = getLoginUserDirectory();
        break;
      case 'auth.login':
        data = authenticateUser(payload.user_id, payload.pin, requestId);
        break;
      case 'auth.changePin':
        data = changeUserPin(sessionToken, payload.old_pin, payload.new_pin, requestId);
        break;
      case 'dashboard.bootstrap':
        data = getDashboardBootstrap(sessionToken);
        break;
      case 'requisition.create':
        data = createRequisition(sessionToken, payload, requestId);
        break;
      case 'requisition.inspect':
        data = inspectRequisition(sessionToken, payload, requestId);
        break;
      case 'requisition.approve':
        data = approveRequisition(sessionToken, payload, requestId, idempotencyKey);
        break;
      case 'supply.receive':
        data = receiveSupplyIntoDepot(sessionToken, payload, requestId);
        break;
      case 'repair.manage':
        data = manageRepairOrder(sessionToken, payload, requestId);
        break;
      case 'disposal.manage':
        data = manageDisposalOrder(sessionToken, payload, requestId);
        break;
      case 'audit.sixMonth':
        data = recordSixMonthInventoryAudit(sessionToken, payload, requestId);
        break;
      case 'report.matrix':
        data = buildReconciliationMatrix(sessionToken);
        break;
      case 'report.exportSheet':
        data = exportMatrixSheetOnDemand(sessionToken, requestId);
        break;
      case 'report.pdf':
        data = generateOfficialFormPdf(sessionToken, payload.form_code, payload.doc_id, requestId);
        break;
      case 'admin.updateNotificationTokens':
        data = updateNotificationSecrets(sessionToken, payload, requestId);
        break;
      default:
        throw createAppError(ERROR_CODES.VALIDATION, `ไม่พบคำสั่ง API: ${action}`);
    }

    logStructured('INFO', requestId, action, 'SUCCESS', Date.now() - startMs, '');
    return {
      ok: true,
      requestId: requestId,
      timestamp: new Date().toISOString(),
      data: data,
      error: null
    };
  } catch (err) {
    const code = err.code || ERROR_CODES.INTERNAL;
    const msg = err.message || 'เกิดข้อผิดพลาดภายในระบบ';
    logStructured('ERROR', requestId, action, code, Date.now() - startMs, msg);
    return {
      ok: false,
      requestId: requestId,
      timestamp: new Date().toISOString(),
      data: null,
      error: {
        code: code,
        message: msg
      }
    };
  }
}

/**
 * รายชื่อกำลังพลผู้มีสิทธิ์เข้าใช้งานสำหรับหน้า Login (ไม่ส่ง pin_hash ออกไป)
 */
function getLoginUserDirectory() {
  const users = repoGetAll(SHEETS.USERS);
  return users
    .filter(function (u) { return u.status === 'ACTIVE'; })
    .map(function (u) {
      return {
        id: u.id,
        rank_name: u.rank_name,
        position: u.position,
        role: u.role,
        supply_line: u.supply_line
      };
    });
}

/**
 * โหลดข้อมูลชุดเริ่มต้นสำหรับหน้าจอ Dashboard หลัก
 */
function getDashboardBootstrap(sessionToken) {
  const user = requireSession(sessionToken, []);
  const items = repoGetAll(SHEETS.ITEMS);
  const units = repoGetAll(SHEETS.UNITS);
  const requisitions = repoGetAll(SHEETS.REQUISITIONS);
  const repairs = repoGetAll(SHEETS.REPAIRS);
  const disposals = repoGetAll(SHEETS.DISPOSALS);
  const txLedger = repoGetAll(SHEETS.TX_LEDGER).slice(-50).reverse();
  const auditLedger = repoGetAll(SHEETS.AUDIT_LEDGER).slice(-50).reverse();

  return {
    currentUser: {
      id: user.id,
      rank_name: user.rank_name,
      position: user.position,
      role: user.role,
      supply_line: user.supply_line,
      can_receive_sp: user.can_receive_sp
    },
    orderRef: PropertiesService.getScriptProperties().getProperty('ORDER_REF') || APP_CONFIG.DEFAULT_ORDER_REF,
    units: units,
    items: items,
    requisitions: requisitions.slice().reverse(),
    repairs: repairs.slice().reverse(),
    disposals: disposals.slice().reverse(),
    txLedger: txLedger,
    auditLedger: auditLedger
  };
}

/**
 * บันทึก Token แจ้งเตือน Telegram / LINE ลง PropertiesService (เฉพาะ APPROVER / SYSTEM_ADMIN)
 */
function updateNotificationSecrets(sessionToken, payload, requestId) {
  const actor = requireSession(sessionToken, [ROLES.APPROVER, ROLES.SYSTEM_ADMIN]);
  const props = PropertiesService.getScriptProperties();

  if (payload.telegram_bot_token !== undefined) {
    props.setProperty('TELEGRAM_BOT_TOKEN', String(payload.telegram_bot_token).trim());
  }
  if (payload.telegram_chat_id !== undefined) {
    props.setProperty('TELEGRAM_CHAT_ID', String(payload.telegram_chat_id).trim());
  }
  if (payload.line_channel_access_token !== undefined) {
    props.setProperty('LINE_CHANNEL_ACCESS_TOKEN', String(payload.line_channel_access_token).trim());
  }
  if (payload.line_target_group_id !== undefined) {
    props.setProperty('LINE_TARGET_GROUP_ID', String(payload.line_target_group_id).trim());
  }

  writeAuditLog(requestId, `${actor.id} (${actor.rank_name})`, 'UPDATE_NOTIFICATION_SECRETS', 'SCRIPT_PROPERTIES', {}, { updated: true });
  return { saved: true };
}

/**
 * บันทึก Structured Log สำหรับ Cloud Logging / Error Reporting
 */
function logStructured(severity, requestId, operation, status, durationMs, detail) {
  const entry = {
    severity: severity,
    requestId: requestId,
    operation: operation,
    status: status,
    durationMs: durationMs,
    detail: detail
  };
  if (severity === 'ERROR') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}