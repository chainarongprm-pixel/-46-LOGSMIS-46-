/**
 * LOGSMIS - กรมทหารพรานที่ 46
 * Repository.gs: Batch Data Access Layer & Caching
 */

const MEMORY_CACHE_ = {};

/**
 * เปิด Spreadsheet หลักของระบบ
 */
function getMainSpreadsheet() {
  const propId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (propId) {
    return SpreadsheetApp.openById(propId);
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw createAppError(ERROR_CODES.INTERNAL, 'ไม่พบ Spreadsheet หลัก กรุณาตั้งค่า SPREADSHEET_ID ใน Script Properties');
  }
  return active;
}

/**
 * ดึงข้อมูลทั้งหมดจากชีตในรูปแบบ Array of Objects (Batch Read)
 */
function repoGetAll(sheetName, bypassCache) {
  if (!bypassCache && MEMORY_CACHE_[sheetName]) {
    return MEMORY_CACHE_[sheetName];
  }

  const ss = getMainSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    return [];
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    MEMORY_CACHE_[sheetName] = [];
    return [];
  }

  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(function (h) { return String(h).trim(); });
  const records = [];

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (row.every(function (cell) { return cell === '' || cell === null; })) {
      continue;
    }
    const obj = { _rowIndex: r + 1 };
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (key) {
        obj[key] = row[c];
      }
    }
    records.push(obj);
  }

  MEMORY_CACHE_[sheetName] = records;
  return records;
}

/**
 * ล้าง Cache ของชีตเมื่อมีการเขียนข้อมูล
 */
function repoInvalidateCache(sheetName) {
  if (sheetName) {
    delete MEMORY_CACHE_[sheetName];
  } else {
    Object.keys(MEMORY_CACHE_).forEach(function (k) { delete MEMORY_CACHE_[k]; });
  }
}

/**
 * เพิ่มข้อมูลหลายแถวพร้อมกัน (Batch Append)
 */
function repoAppendRecords(sheetName, records) {
  if (!records || records.length === 0) return;

  const ss = getMainSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw createAppError(ERROR_CODES.INTERNAL, `ไม่พบตารางข้อมูล ${sheetName}`);
  }

  const headers = TABLE_SCHEMAS[sheetName] || sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rows = records.map(function (rec) {
    return headers.map(function (col) {
      return rec[col] !== undefined && rec[col] !== null ? rec[col] : '';
    });
  });

  const startRow = Math.max(sheet.getLastRow() + 1, 2);
  sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
  repoInvalidateCache(sheetName);
}

/**
 * อัปเดตข้อมูลตาม Primary Key (id) แบบระบุแถว
 */
function repoUpdateRecord(sheetName, idValue, patchObj) {
  const ss = getMainSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw createAppError(ERROR_CODES.INTERNAL, `ไม่พบตารางข้อมูล ${sheetName}`);
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) {
    throw createAppError(ERROR_CODES.NOT_FOUND, `ไม่พบข้อมูลรหัส ${idValue} ใน ${sheetName}`);
  }

  const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = data[0].map(function (h) { return String(h).trim(); });
  const idColIdx = headers.indexOf('id');
  if (idColIdx === -1) {
    throw createAppError(ERROR_CODES.INTERNAL, `ตาราง ${sheetName} ไม่มีคอลัมน์ id`);
  }

  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idColIdx]) === String(idValue)) {
      const updatedRow = data[r].slice();
      Object.keys(patchObj).forEach(function (key) {
        const colIdx = headers.indexOf(key);
        if (colIdx !== -1) {
          updatedRow[colIdx] = patchObj[key];
        }
      });
      sheet.getRange(r + 1, 1, 1, headers.length).setValues([updatedRow]);
      repoInvalidateCache(sheetName);
      return true;
    }
  }

  throw createAppError(ERROR_CODES.NOT_FOUND, `ไม่พบรหัส ${idValue} ใน ${sheetName}`);
}

/**
 * บันทึก Audit Trail แบบ Append-Only
 */
function writeAuditLog(requestId, actor, action, targetId, prevObj, newObj) {
  try {
    const auditRecord = {
      id: 'AUD-' + Utilities.getUuid().split('-')[0].toUpperCase(),
      request_id: requestId || 'SYS-' + Utilities.getUuid().split('-')[0],
      timestamp: new Date().toISOString(),
      actor: sanitizeInput(actor, 120),
      action: sanitizeInput(action, 80),
      target_id: sanitizeInput(targetId, 80),
      prev_val: JSON.stringify(prevObj || {}),
      new_val: JSON.stringify(newObj || {})
    };
    repoAppendRecords(SHEETS.AUDIT_LEDGER, [auditRecord]);
  } catch (e) {
    console.error(JSON.stringify({
      severity: 'ERROR',
      message: 'Failed to write audit log',
      error: e.message
    }));
  }
}

/**
 * สร้างเลขที่เอกสารราชการอัตโนมัติตามปีงบประมาณ พ.ศ.
 */
function generateOfficialDocNo(prefix, sheetName, docColName) {
  const now = new Date();
  const thaiYear = now.getFullYear() + 543;
  const rows = repoGetAll(sheetName, true);
  const yearPattern = `-${thaiYear}-`;
  let maxSeq = 0;

  rows.forEach(function (r) {
    const docNo = String(r[docColName] || '');
    if (docNo.indexOf(yearPattern) !== -1) {
      const parts = docNo.split('-');
      const seq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
  });

  const nextSeq = String(maxSeq + 1).padStart(3, '0');
  return `${prefix}-${thaiYear}-${nextSeq}`;
}