/**
 * LOGSMIS - กรมทหารพรานที่ 46
 * MigrationAndSetup.gs: Idempotent Database Bootstrap, Secret Migration & Daily Backup
 */

/**
 * ฟังก์ชันหลักสำหรับติดตั้งและอัปเกรดฐานข้อมูล (รันซ้ำได้อย่างปลอดภัย)
 */
function setupSystem() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('ไม่สามารถล็อกระบบเพื่อรัน setupSystem ได้ กรุณาลองใหม่');
  }

  try {
    const ss = getMainSpreadsheet();
    const props = PropertiesService.getScriptProperties();
    const now = new Date().toISOString();

    if (!props.getProperty('SPREADSHEET_ID')) {
      props.setProperty('SPREADSHEET_ID', ss.getId());
    }
    if (!props.getProperty('APP_ENV')) {
      props.setProperty('APP_ENV', 'PRODUCTION');
    }

    const salt = getSecuritySalt();

    // 1. สร้างชีตมาตรฐานให้ครบตาม Schema
    Object.keys(TABLE_SCHEMAS).forEach(function (sheetName) {
      ensureSheetWithHeaders(ss, sheetName, TABLE_SCHEMAS[sheetName]);
    });

    // 2. ย้าย Secret จาก DB_SETTINGS ไปเก็บใน ScriptProperties และลบ Plaintext ออกจากชีต
    migrateSecretsFromSettingsSheet(ss, props, now);

    // 3. อัปเกรด DB_USERS: เข้ารหัส pincode เดิมเป็น pin_hash (SHA-256 + Salt)
    migrateAndSeedUsers(ss, salt, now);

    // 4. เติมข้อมูลหน่วย 18 หน่วย (DB_UNITS)
    seedUnitsIfEmpty(now);

    // 5. เติมรายการสิ่งอุปกรณ์ 34 รายการ (DB_ITEMS) และตรวจสอบสมดุลบัญชี
    seedItemsIfEmpty(now);

    // 6. ดึงยอดถือครองรายหน่วยจากชีตเดิมทั้ง 18 ชีต (ถ้ามี) เข้าสู่ DB_UNIT_BALANCES
    migrateUnitBalancesFromLegacyTabs(ss, now);

    // 7. ตั้งค่า Trigger สำรองข้อมูลรายวันเวลา 23:00 น.
    ensureDailyBackupTrigger();

    repoInvalidateCache();
    writeAuditLog('BOOT-' + Utilities.getUuid().split('-')[0], 'SYSTEM_SETUP', 'UPGRADE_ENTERPRISE_V4', 'ALL_TABLES', {}, {
      status: 'SUCCESS',
      env: props.getProperty('APP_ENV')
    });

    SpreadsheetApp.flush();
    return { status: 'OK', message: 'ติดตั้งและอัปเกรดฐานข้อมูล LOGSMIS ระดับ Production เรียบร้อยแล้ว' };
  } finally {
    lock.releaseLock();
  }
}

/**
 * สร้างชีตหากยังไม่มี และเพิ่มคอลัมน์ที่ขาดหายโดยไม่ลบข้อมูลเดิม
 */
function ensureSheetWithHeaders(ss, sheetName, requiredHeaders) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    sheet.getRange(1, 1, 1, requiredHeaders.length).setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    return;
  }

  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    return;
  }

  const existingHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  const missingHeaders = requiredHeaders.filter(function (h) { return existingHeaders.indexOf(h) === -1; });

  if (missingHeaders.length > 0) {
    sheet.getRange(1, lastCol + 1, 1, missingHeaders.length).setValues([missingHeaders]);
    sheet.getRange(1, lastCol + 1, 1, missingHeaders.length).setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
  }
}

/**
 * ย้าย Secret จาก DB_SETTINGS ไปเก็บใน PropertiesService
 */
function migrateSecretsFromSettingsSheet(ss, props, now) {
  const sheet = ss.getSheetByName(SHEETS.SETTINGS);
  if (!sheet || sheet.getLastRow() < 2) return;

  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(function (h) { return String(h).trim(); });
  const keyIdx = headers.indexOf('key');
  const valIdx = headers.indexOf('value');
  if (keyIdx === -1 || valIdx === -1) return;

  const secretKeys = ['MASTER_ADMIN_PIN', 'LINE_NOTIFY_TOKEN', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'LINE_CHANNEL_ACCESS_TOKEN'];

  for (let r = 1; r < data.length; r++) {
    const k = String(data[r][keyIdx] || '').trim();
    const v = String(data[r][valIdx] || '').trim();

    if (k === 'UNIT_NAME' && v) props.setProperty('UNIT_NAME', v);
    if (k === 'ORDER_REF' && v) props.setProperty('ORDER_REF', v);

    if (secretKeys.indexOf(k) !== -1 && v && v !== '-' && v !== '[MOVED_TO_SCRIPT_PROPERTIES]') {
      props.setProperty(k, v);
      sheet.getRange(r + 1, valIdx + 1).setValue('[MOVED_TO_SCRIPT_PROPERTIES]');
    }
  }
}

/**
 * เข้ารหัส PIN เดิมใน DB_USERS เป็น SHA-256 + Salt และลบรหัส Plaintext
 */
function migrateAndSeedUsers(ss, salt, now) {
  const sheet = ss.getSheetByName(SHEETS.USERS);
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    const seeded = USERS_SEED.map(function (u, idx) {
      const initialPin = '4600' + String(idx + 1).padStart(2, '0');
      return Object.assign({}, u, {
        pin_hash: computePinHash(u.id, initialPin, salt),
        must_change_pin: true,
        status: 'ACTIVE',
        rev: 1,
        created_at: now,
        updated_at: now
      });
    });
    repoAppendRecords(SHEETS.USERS, seeded);
    return;
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(function (h) { return String(h).trim(); });
  const idIdx = headers.indexOf('id');
  const legacyPinIdx = headers.indexOf('pincode');
  const hashIdx = headers.indexOf('pin_hash');
  const mustChangeIdx = headers.indexOf('must_change_pin');

  for (let r = 1; r < data.length; r++) {
    const userId = String(data[r][idIdx] || '').trim();
    if (!userId) continue;

    const existingHash = hashIdx !== -1 ? String(data[r][hashIdx] || '').trim() : '';
    const legacyPin = legacyPinIdx !== -1 ? String(data[r][legacyPinIdx] || '').trim() : '';

    if (!existingHash && legacyPin && legacyPin !== '[REDACTED]') {
      const hashed = computePinHash(userId, legacyPin, salt);
      if (hashIdx !== -1) sheet.getRange(r + 1, hashIdx + 1).setValue(hashed);
      if (mustChangeIdx !== -1) sheet.getRange(r + 1, mustChangeIdx + 1).setValue(true);
      if (legacyPinIdx !== -1) sheet.getRange(r + 1, legacyPinIdx + 1).setValue('[REDACTED]');
    }
  }
}

/**
 * เติมข้อมูลหน่วยขึ้นตรง 18 หน่วย
 */
function seedUnitsIfEmpty(now) {
  const existing = repoGetAll(SHEETS.UNITS, true);
  if (existing.length > 0) return;

  const records = UNITS_SEED.map(function (u) {
    return Object.assign({}, u, {
      commander_name: '-',
      status: 'ACTIVE',
      rev: 1,
      created_at: now,
      updated_at: now
    });
  });
  repoAppendRecords(SHEETS.UNITS, records);
}

/**
 * เติมรายการสิ่งอุปกรณ์ 34 รายการพร้อมตรวจสมดุลบัญชี
 */
function seedItemsIfEmpty(now) {
  const existing = repoGetAll(SHEETS.ITEMS, true);
  if (existing.length > 0) return;

  const records = ITEMS_SEED.map(function (it) {
    const check = validateAccountingInvariants(it);
    if (!check.valid) {
      throw new Error(`ข้อมูลตั้งต้น ${it.id} ผิดสมดุลบัญชี: ${check.errors.join(', ')}`);
    }
    return Object.assign({}, it, {
      status: 'ACTIVE',
      rev: 1,
      updated_at: now
    });
  });
  repoAppendRecords(SHEETS.ITEMS, records);
}

/**
 * อ่านยอดจากชีตแยกของ 18 หน่วยเดิม (ถ้ามี) เพื่อโอนเข้าตาราง DB_UNIT_BALANCES
 */
function migrateUnitBalancesFromLegacyTabs(ss, now) {
  const existingBalances = repoGetAll(SHEETS.UNIT_BALANCES, true);
  if (existingBalances.length > 0) return;

  const items = repoGetAll(SHEETS.ITEMS, true);
  const itemById = {};
  const itemByName = {};
  items.forEach(function (it) {
    itemById[it.id] = it;
    itemByName[String(it.item_name).trim()] = it;
  });

  const newBalances = [];

  UNITS_SEED.forEach(function (unit) {
    const legacySheet = ss.getSheetByName(unit.legacy_sheet_name);
    if (!legacySheet || legacySheet.getLastRow() < 2) return;

    const values = legacySheet.getDataRange().getValues();
    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      let matchedItem = null;
      let qty = 0;

      for (let c = 0; c < row.length; c++) {
        const cellStr = String(row[c] || '').trim();
        if (itemById[cellStr]) matchedItem = itemById[cellStr];
        else if (itemByName[cellStr]) matchedItem = itemByName[cellStr];
      }

      if (matchedItem) {
        // ค้นหาตัวเลขยอดถือครองในแถวนั้น
        for (let c = row.length - 1; c >= 0; c--) {
          if (typeof row[c] === 'number' && row[c] >= 0) {
            qty = row[c];
            break;
          }
        }
        newBalances.push({
          id: 'BAL-' + Utilities.getUuid().split('-')[0].toUpperCase(),
          unit_id: unit.id,
          unit_code: unit.unit_code,
          unit_name: unit.unit_name,
          item_id: matchedItem.id,
          item_name: matchedItem.item_name,
          authorized_qty: 0,
          issued_qty: qty,
          serviceable_qty: qty,
          in_repair_qty: 0,
          pending_disposal_qty: 0,
          last_audit_date: '',
          rev: 1,
          updated_at: now
        });
      }
    }
  });

  if (newBalances.length > 0) {
    repoAppendRecords(SHEETS.UNIT_BALANCES, newBalances);
  }
}

/**
 * สำรองฐานข้อมูล Spreadsheet รายวันไปยัง Google Drive (เก็บย้อนหลัง 30 ไฟล์)
 */
function createDailyBackupSnapshot() {
  const ss = getMainSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty('BACKUP_FOLDER_ID');
  const folder = folderId ? DriveApp.getFolderById(folderId) : getOrCreateSystemFolder('LOGSMIS_BACKUPS_46');

  const stamp = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd_HHmm');
  const backupName = `BACKUP_LOGSMIS_46_${stamp}`;
  const file = DriveApp.getFileById(ss.getId()).makeCopy(backupName, folder);

  // ลบไฟล์สำรองที่เก่าเกิน 30 ชุด
  const files = folder.getFiles();
  const list = [];
  while (files.hasNext()) {
    const f = files.next();
    if (f.getName().indexOf('BACKUP_LOGSMIS_46_') === 0) {
      list.push(f);
    }
  }
  list.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  for (let i = 30; i < list.length; i++) {
    list[i].setTrashed(true);
  }

  writeAuditLog('BACKUP-' + stamp, 'DAILY_CRON', 'CREATE_BACKUP_SNAPSHOT', file.getId(), {}, { name: backupName });
}

/**
 * ติดตั้ง Time-driven Trigger สำหรับสำรองข้อมูลอัตโนมัติ (ไม่สร้างซ้ำ)
 */
function ensureDailyBackupTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  const exists = triggers.some(function (t) {
    return t.getHandlerFunction() === 'createDailyBackupSnapshot';
  });
  if (!exists) {
    ScriptApp.newTrigger('createDailyBackupSnapshot')
      .timeBased()
      .everyDays(1)
      .atHour(23)
      .create();
  }
}