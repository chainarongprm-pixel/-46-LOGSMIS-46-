/**
 * LOGSMIS - กรมทหารพรานที่ 46
 * ReportAndNotification.gs: 19-Unit Matrix, Official Thai Army PDF Forms & Alerts
 */

/**
 * สร้างข้อมูลตารางกระทบยอด 19 หน่วย (รวมทั้งกรม + 18 หน่วยขึ้นตรง) แบบ Real-time
 */
function buildReconciliationMatrix(sessionToken) {
  requireSession(sessionToken, []);
  const units = repoGetAll(SHEETS.UNITS);
  const items = repoGetAll(SHEETS.ITEMS);
  const balances = repoGetAll(SHEETS.UNIT_BALANCES);

  const balanceMap = {};
  balances.forEach(function (b) {
    balanceMap[`${b.item_id}__${b.unit_id}`] = Number(b.issued_qty || 0);
  });

  const matrixRows = items.map(function (item) {
    const unitQuantities = {};
    let sumUnits = 0;

    units.forEach(function (u) {
      const q = balanceMap[`${item.id}__${u.id}`] || 0;
      unitQuantities[u.id] = q;
      sumUnits += q;
    });

    const invCheck = validateAccountingInvariants(item);

    return {
      item_id: item.id,
      seq_no: item.seq_no,
      category: item.category,
      item_name: item.item_name,
      nsn: item.nsn,
      unit: item.unit,
      authorized_qty: Number(item.authorized_qty || 0),
      received_qty: Number(item.received_qty || 0),
      issued_qty: Number(item.issued_qty || 0),
      depot_reserve_qty: Number(item.depot_reserve_qty || 0),
      serviceable_qty: Number(item.serviceable_qty || 0),
      in_repair_qty: Number(item.in_repair_qty || 0),
      pending_disposal_qty: Number(item.pending_disposal_qty || 0),
      unallocated_diff: Number(item.issued_qty || 0) - sumUnits,
      invariant_valid: invCheck.valid,
      unit_quantities: unitQuantities
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    units: units,
    rows: matrixRows
  };
}

/**
 * ส่งออกชีตสรุปสถานภาพ 19 หน่วยลง Google Sheets ตามคำสั่งผู้ใช้ (On-Demand Export)
 */
function exportMatrixSheetOnDemand(sessionToken, requestId) {
  const actor = requireSession(sessionToken, [ROLES.INSPECTOR, ROLES.APPROVER, ROLES.SYSTEM_ADMIN]);
  const matrix = buildReconciliationMatrix(sessionToken);
  const ss = getMainSpreadsheet();
  const exportName = 'RPT_สถานภาพ_19หน่วย_ล่าสุด';

  let sheet = ss.getSheetByName(exportName);
  if (sheet) {
    sheet.clear();
  } else {
    sheet = ss.insertSheet(exportName);
  }

  const headers = [
    'ลำดับ', 'หมวด', 'รายการสิ่งอุปกรณ์', 'หมายเลข สป. (NSN)', 'หน่วยนับ',
    'อัตราอนุมัติ', 'รับทั้งสิ้น', 'จ่ายประจำหน่วย', 'คงคลังหน่วย',
    'ใช้การได้', 'ระหว่างซ่อม', 'รอจำหน่าย', 'ส่วนต่างยังไม่ระบุหน่วย'
  ].concat(matrix.units.map(function (u) { return u.legacy_sheet_name || u.unit_code; }));

  const rows = [headers];
  matrix.rows.forEach(function (r) {
    const base = [
      r.seq_no, r.category, r.item_name, r.nsn, r.unit,
      r.authorized_qty, r.received_qty, r.issued_qty, r.depot_reserve_qty,
      r.serviceable_qty, r.in_repair_qty, r.pending_disposal_qty, r.unallocated_diff
    ];
    const perUnit = matrix.units.map(function (u) { return r.unit_quantities[u.id] || 0; });
    rows.push(base.concat(perUnit));
  });

  sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(3);

  writeAuditLog(requestId, `${actor.id} (${actor.rank_name})`, 'EXPORT_19_UNIT_MATRIX', exportName, {}, { rows: matrix.rows.length });
  return { sheetName: exportName, exportedAt: matrix.generatedAt };
}

/**
 * สร้างแบบพิมพ์ทางทหาร (ทบ.400-006 / ทบ.400-065 / ทบ.400-016) เป็น PDF บันทึกลง Google Drive
 */
function generateOfficialFormPdf(sessionToken, formCode, docId, requestId) {
  const actor = requireSession(sessionToken, []);
  const props = PropertiesService.getScriptProperties();
  const orderRef = props.getProperty('ORDER_REF') || APP_CONFIG.DEFAULT_ORDER_REF;
  const unitName = props.getProperty('UNIT_NAME') || APP_CONFIG.UNIT_NAME;

  let title = 'ใบเบิก / ใบส่งคืนสิ่งอุปกรณ์ (แบบพิมพ์ ทบ.๔๐๐-๐๐๖)';
  let docNo = 'DOC-' + Utilities.getUuid().split('-')[0].toUpperCase();
  let targetUnit = unitName;
  let rowsHtml = '';
  let signBlockHtml = '';

  if (formCode === '400-006') {
    const req = repoGetAll(SHEETS.REQUISITIONS).find(function (r) { return r.id === docId; });
    if (!req) throw createAppError(ERROR_CODES.NOT_FOUND, `ไม่พบใบเบิก ${docId}`);
    docNo = req.doc_no;
    targetUnit = req.dept_name;
    rowsHtml = `
      <tr>
        <td style="text-align:center;">1</td>
        <td>${req.item_id}</td>
        <td>${req.item_name} (S/N: ${req.serial_number || '-'})</td>
        <td style="text-align:center;">${req.qty_requested}</td>
        <td>${req.reason}</td>
      </tr>`;
    signBlockHtml = `
      <table class="sign-table">
        <tr>
          <td><strong>ผู้เบิก/ผู้ส่งคืน:</strong><br>${req.operator_name || '-'}<br>สถานะ: ลงนามอิเล็กทรอนิกส์แล้ว</td>
          <td><strong>ผู้ตรวจสอบ (ฝอ.๕):</strong><br>${req.inspector_name || 'รอตรวจสอบ'}<br>สถานะ: ${req.inspector_name ? 'ตรวจสอบแล้ว' : '-'}</td>
          <td><strong>ผู้อนุมัติ (ผบ.กรม ทพ.๔๖):</strong><br>${req.approver_name || 'รออนุมัติ'}<br>สถานะ: ${req.status}</td>
        </tr>
      </table>`;
  } else if (formCode === '400-065') {
    const dsp = repoGetAll(SHEETS.DISPOSALS).find(function (d) { return d.id === docId; });
    if (!dsp) throw createAppError(ERROR_CODES.NOT_FOUND, `ไม่พบใบเสนอจำหน่าย ${docId}`);
    title = 'ใบเสนอจำหน่ายสิ่งอุปกรณ์ (แบบพิมพ์ ทบ.๔๐๐-๐๖๕)';
    docNo = dsp.disposal_no;
    targetUnit = dsp.dept_name;
    rowsHtml = `
      <tr>
        <td style="text-align:center;">1</td>
        <td>${dsp.nsn || dsp.item_id}</td>
        <td>${dsp.item_name}</td>
        <td style="text-align:center;">${dsp.qty_disposal}</td>
        <td>${dsp.disposal_reason} (อ้างอิง: ${dsp.committee_ref})</td>
      </tr>`;
    signBlockHtml = `
      <table class="sign-table">
        <tr>
          <td><strong>เจ้าหน้าที่เสนอเรื่อง:</strong><br>${dsp.operator_name}</td>
          <td><strong>ผู้อนุมัติจำหน่าย:</strong><br>${dsp.approver_name || 'รออนุมัติ'}</td>
        </tr>
      </table>`;
  } else if (formCode === '400-016') {
    title = 'ใบรายงานสถานภาพสิ่งอุปกรณ์ประจำหน่วย (แบบพิมพ์ ทบ.๔๐๐-๐๑๖)';
    docNo = 'RPT-400-016-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd');
    const items = repoGetAll(SHEETS.ITEMS);
    rowsHtml = items.map(function (it, idx) {
      return `
        <tr>
          <td style="text-align:center;">${idx + 1}</td>
          <td>${it.nsn}</td>
          <td>${it.item_name}</td>
          <td style="text-align:center;">${it.authorized_qty} / ${it.received_qty} / ${it.issued_qty} / ${it.depot_reserve_qty}</td>
          <td>ใช้การได้ ${it.serviceable_qty} | ซ่อม ${it.in_repair_qty} | รอจำหน่าย ${it.pending_disposal_qty}</td>
        </tr>`;
    }).join('');
    signBlockHtml = `
      <table class="sign-table">
        <tr>
          <td><strong>ผู้จัดทำรายงาน:</strong><br>${actor.rank_name}</td>
          <td><strong>รับรองความถูกต้อง:</strong><br>ระบบสารสนเทศ LOGSMIS กรม ทพ.๔๖</td>
        </tr>
      </table>`;
  } else {
    throw createAppError(ERROR_CODES.VALIDATION, 'รหัสแบบพิมพ์ไม่รองรับ (รองรับ 400-006, 400-065, 400-016)');
  }

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: 'Sarabun', sans-serif; font-size: 13px; color: #111; padding: 24px; }
  h2 { text-align: center; margin: 0 0 6px 0; font-size: 18px; }
  .sub { text-align: center; font-size: 12px; color: #444; margin-bottom: 16px; }
  .meta { width: 100%; margin-bottom: 12px; }
  table.grid { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  table.grid th, table.grid td { border: 1px solid #333; padding: 6px 8px; }
  table.grid th { background: #f1f5f9; }
  table.sign-table { width: 100%; border-collapse: collapse; margin-top: 24px; }
  table.sign-table td { border: 1px solid #666; padding: 12px; text-align: center; vertical-align: top; }
  .footer { margin-top: 16px; font-size: 11px; color: #555; border-top: 1px dashed #999; padding-top: 8px; }
</style>
</head>
<body>
  <h2>${title}</h2>
  <div class="sub">${unitName} | เลขที่เอกสาร: ${docNo}</div>
  <table class="meta">
    <tr>
      <td><strong>หน่วยเบิก/รับผิดชอบ:</strong> ${targetUnit}</td>
      <td style="text-align:right;"><strong>วันที่ออกเอกสาร:</strong> ${Utilities.formatDate(new Date(), 'Asia/Bangkok', 'dd/MM/yyyy HH:mm')} น.</td>
    </tr>
  </table>
  <table class="grid">
    <thead>
      <tr>
        <th style="width:45px;">ลำดับ</th>
        <th style="width:130px;">หมายเลข สป.</th>
        <th>รายการสิ่งอุปกรณ์</th>
        <th style="width:140px;">จำนวน</th>
        <th>หมายเหตุ / สภาพ</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  ${signBlockHtml}
  <div class="footer">
    เอกสารอิเล็กทรอนิกส์นี้อ้างอิงอำนาจลงนามตาม: ${orderRef} | Request ID: ${requestId || '-'}
  </div>
</body>
</html>`;

  const blob = Utilities.newBlob(html, 'text/html', `${docNo}.html`).getAs('application/pdf');
  blob.setName(`${docNo}.pdf`);

  const folderId = props.getProperty('DOCUMENT_FOLDER_ID');
  const folder = folderId ? DriveApp.getFolderById(folderId) : getOrCreateSystemFolder('LOGSMIS_DOCUMENTS_46');
  const file = folder.createFile(blob);

  writeAuditLog(requestId, `${actor.id} (${actor.rank_name})`, 'GENERATE_PDF_FORM', docNo, {}, { fileId: file.getId(), formCode: formCode });

  return {
    fileId: file.getId(),
    fileName: file.getName(),
    fileUrl: file.getUrl()
  };
}

/**
 * ส่งแจ้งเตือนไปยัง Telegram Bot API และ LINE Messaging API (พร้อม Exponential Backoff)
 */
function dispatchNotification(title, message) {
  const props = PropertiesService.getScriptProperties();
  const tgToken = props.getProperty('TELEGRAM_BOT_TOKEN');
  const tgChatId = props.getProperty('TELEGRAM_CHAT_ID');
  const lineToken = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  const lineTarget = props.getProperty('LINE_TARGET_GROUP_ID');

  const fullText = `🛡️ [LOGSMIS กรม ทพ.๔๖] ${title}\n${message}`;

  if (tgToken && tgChatId) {
    fetchWithRetry(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: tgChatId, text: fullText }),
      muteHttpExceptions: true
    });
  }

  if (lineToken && lineTarget) {
    fetchWithRetry('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + lineToken },
      payload: JSON.stringify({
        to: lineTarget,
        messages: [{ type: 'text', text: fullText }]
      }),
      muteHttpExceptions: true
    });
  }
}

/**
 * เรียก HTTP ภายนอกพร้อม Exponential Backoff + Jitter สูงสุด 3 ครั้ง
 */
function fetchWithRetry(url, options) {
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const resp = UrlFetchApp.fetch(url, options);
      const code = resp.getResponseCode();
      if (code >= 200 && code < 300) return resp;
      if (code >= 400 && code < 500 && code !== 429) return resp;
    } catch (e) {
      if (attempt === maxRetries - 1) {
        console.warn('Notification fetch failed after retries: ' + e.message);
      }
    }
    const backoffMs = Math.pow(2, attempt) * 400 + Math.floor(Math.random() * 200);
    Utilities.sleep(backoffMs);
  }
  return null;
}

/**
 * ค้นหาหรือสร้างโฟลเดอร์ใน Google Drive
 */
function getOrCreateSystemFolder(folderName) {
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return DriveApp.createFolder(folderName);
}