/**
 * LOGSMIS - กรมทหารพรานที่ 46
 * Security.gs: Authentication, PIN Hashing, RBAC/ABAC, Sanitization & Audit
 */

/**
 * สร้างค่าแฮช SHA-256 สำหรับรหัส PIN (รองรับทั้ง GAS Runtime และ Node.js Test)
 */
function computePinHash(userId, rawPin, salt) {
  const cleanUserId = String(userId || '').trim();
  const cleanPin = String(rawPin || '').trim();
  const cleanSalt = String(salt || '').trim();
  if (!cleanSalt) {
    throw new Error('ไม่พบ HASH_SALT ในระบบความปลอดภัย กรุณารัน setupSystem()');
  }
  const material = `${cleanSalt}:${cleanUserId}:${cleanPin}`;

  if (typeof Utilities !== 'undefined' && Utilities.computeDigest) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, material, Utilities.Charset.UTF_8);
    return bytes.map(function (b) {
      const v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    }).join('');
  }

  const crypto = require('crypto');
  return crypto.createHash('sha256').update(material, 'utf8').digest('hex');
}

/**
 * เปรียบเทียบ String แบบ Constant-time ลดความเสี่ยง Timing Attack
 */
function constantTimeEquals(a, b) {
  const strA = String(a || '');
  const strB = String(b || '');
  if (strA.length !== strB.length) return false;
  let diff = 0;
  for (let i = 0; i < strA.length; i++) {
    diff |= strA.charCodeAt(i) ^ strB.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * ดึงค่า Salt จาก Script Properties
 */
function getSecuritySalt() {
  const props = PropertiesService.getScriptProperties();
  let salt = props.getProperty('HASH_SALT');
  if (!salt) {
    salt = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('HASH_SALT', salt);
  }
  return salt;
}

/**
 * ทำความสะอาดข้อความและป้องกัน Formula Injection บน Google Sheets
 */
function sanitizeInput(val, maxLen) {
  if (val === null || val === undefined) return '';
  let str = String(val).replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (maxLen && str.length > maxLen) {
    str = str.substring(0, maxLen);
  }
  if (/^[=+\-@]/.test(str)) {
    str = "'" + str;
  }
  return str;
}

/**
 * ตรวจสอบสิทธิ์การเข้าถึงสายงาน (Supply-Line ABAC)
 */
function canAccessSupplyLine(user, targetSupplyLine) {
  if (!user || user.status !== 'ACTIVE') return false;
  if (user.role === ROLES.APPROVER || user.role === ROLES.SYSTEM_ADMIN) return true;
  if (user.role === ROLES.INSPECTOR) return true; // ฝอ.5 และ น.ส่งกำลังบำรุง ตรวจได้ทุกสาย

  const userLine = String(user.supply_line || '');
  const target = String(targetSupplyLine || '');
  if (!target) return true;

  // รองรับกรณีเจ้าหน้าที่รับผิดชอบหลายสาย เช่น "สาย พธ. และ สาย พ."
  const normalizedTarget = target.replace('สาย ', '').trim();
  return userLine.indexOf(normalizedTarget) !== -1 || userLine.indexOf(target) !== -1;
}

/**
 * ตรวจสอบสิทธิ์ในการตรวจรับ สป. เข้าคลัง (can_receive_sp = YES (3.x))
 */
function canReceiveSupply(user, targetSupplyLine) {
  if (!user || user.status !== 'ACTIVE') return false;
  const flag = String(user.can_receive_sp || '').toUpperCase();
  if (!flag.startsWith('YES')) return false;
  return canAccessSupplyLine(user, targetSupplyLine);
}

/**
 * เข้าสู่ระบบด้วย User ID และ PIN 6 หลัก พร้อมป้องกัน Brute-force
 */
function authenticateUser(userId, rawPin, requestId) {
  const cleanUserId = sanitizeInput(userId, 32);
  const cleanPin = String(rawPin || '').trim();

  if (!cleanUserId || !/^\d{6}$/.test(cleanPin)) {
    throw createAppError(ERROR_CODES.VALIDATION, 'กรุณาระบุรหัสผู้ใช้งานและรหัส PIN ตัวเลข 6 หลัก');
  }

  const cache = CacheService.getScriptCache();
  const lockKey = 'LOGIN_LOCK_' + cleanUserId;
  const attemptKey = 'LOGIN_FAIL_' + cleanUserId;

  if (cache.get(lockKey)) {
    writeAuditLog(requestId, cleanUserId, 'LOGIN_BLOCKED_LOCKOUT', cleanUserId, {}, { reason: 'TOO_MANY_ATTEMPTS' });
    throw createAppError(ERROR_CODES.FORBIDDEN, 'บัญชีถูกระงับชั่วคราว 15 นาที เนื่องจากกรอก PIN ผิดเกิน 5 ครั้ง');
  }

  const users = repoGetAll(SHEETS.USERS);
  const user = users.find(function (u) { return u.id === cleanUserId; });
  if (!user || user.status !== 'ACTIVE') {
    throw createAppError(ERROR_CODES.UNAUTHORIZED, 'ไม่พบบัญชีผู้ใช้งานหรือบัญชีถูกระงับสิทธิ์');
  }

  const salt = getSecuritySalt();
  const expectedHash = String(user.pin_hash || '');
  const actualHash = computePinHash(cleanUserId, cleanPin, salt);

  if (!expectedHash || !constantTimeEquals(expectedHash, actualHash)) {
    const fails = Number(cache.get(attemptKey) || 0) + 1;
    cache.put(attemptKey, String(fails), APP_CONFIG.LOCKOUT_TTL_SEC);
    if (fails >= APP_CONFIG.MAX_LOGIN_ATTEMPTS) {
      cache.put(lockKey, '1', APP_CONFIG.LOCKOUT_TTL_SEC);
    }
    writeAuditLog(requestId, `${user.id} (${user.rank_name})`, 'LOGIN_FAILED', user.id, {}, { attempts: fails });
    throw createAppError(ERROR_CODES.UNAUTHORIZED, `รหัส PIN ไม่ถูกต้อง (ผิดครั้งที่ ${fails}/${APP_CONFIG.MAX_LOGIN_ATTEMPTS})`);
  }

  cache.remove(attemptKey);
  cache.remove(lockKey);

  const sessionToken = Utilities.getUuid();
  const sessionPayload = {
    userId: user.id,
    rankName: user.rank_name,
    position: user.position,
    role: user.role,
    supplyLine: user.supply_line,
    canReceiveSp: user.can_receive_sp,
    issuedAt: new Date().toISOString()
  };

  cache.put('SESSION_' + sessionToken, JSON.stringify(sessionPayload), APP_CONFIG.SESSION_TTL_SEC);
  writeAuditLog(requestId, `${user.id} (${user.rank_name})`, 'LOGIN_SUCCESS', user.id, {}, { role: user.role });

  return {
    sessionToken: sessionToken,
    mustChangePin: String(user.must_change_pin) === 'true' || user.must_change_pin === true,
    user: sessionPayload
  };
}

/**
 * ตรวจสอบ Session และโหลดข้อมูลสิทธิ์ล่าสุดจาก DB_USERS
 */
function requireSession(sessionToken, allowedRoles) {
  const token = String(sessionToken || '').trim();
  if (!token) {
    throw createAppError(ERROR_CODES.UNAUTHORIZED, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }

  const cache = CacheService.getScriptCache();
  const rawSession = cache.get('SESSION_' + token);
  if (!rawSession) {
    throw createAppError(ERROR_CODES.UNAUTHORIZED, 'เซสชันหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่');
  }

  const session = JSON.parse(rawSession);
  const users = repoGetAll(SHEETS.USERS);
  const freshUser = users.find(function (u) { return u.id === session.userId; });

  if (!freshUser || freshUser.status !== 'ACTIVE') {
    cache.remove('SESSION_' + token);
    throw createAppError(ERROR_CODES.UNAUTHORIZED, 'บัญชีผู้ใช้งานถูกระงับสิทธิ์');
  }

  if (Array.isArray(allowedRoles) && allowedRoles.length > 0 && allowedRoles.indexOf(freshUser.role) === -1) {
    throw createAppError(ERROR_CODES.FORBIDDEN, `สิทธิ์ระดับ ${freshUser.role} ไม่ได้รับอนุญาตให้ดำเนินการในขั้นตอนนี้`);
  }

  // ต่ออายุ Session อัตโนมัติเมื่อมีการใช้งาน
  cache.put('SESSION_' + token, rawSession, APP_CONFIG.SESSION_TTL_SEC);
  return freshUser;
}

/**
 * เปลี่ยนรหัส PIN ส่วนตัวของผู้ใช้งาน
 */
function changeUserPin(sessionToken, oldPin, newPin, requestId) {
  const user = requireSession(sessionToken, []);
  const cleanOld = String(oldPin || '').trim();
  const cleanNew = String(newPin || '').trim();

  if (!/^\d{6}$/.test(cleanNew)) {
    throw createAppError(ERROR_CODES.VALIDATION, 'รหัส PIN ใหม่ต้องเป็นตัวเลข 6 หลักเท่านั้น');
  }
  if (/^(\d)\1{5}$/.test(cleanNew) || cleanNew === '123456' || cleanNew === '460000') {
    throw createAppError(ERROR_CODES.VALIDATION, 'รหัส PIN ใหม่คาดเดาง่ายเกินไป กรุณาตั้งรหัสอื่น');
  }

  const salt = getSecuritySalt();
  const oldHash = computePinHash(user.id, cleanOld, salt);
  if (!constantTimeEquals(user.pin_hash, oldHash)) {
    throw createAppError(ERROR_CODES.UNAUTHORIZED, 'รหัส PIN เดิมไม่ถูกต้อง');
  }

  const newHash = computePinHash(user.id, cleanNew, salt);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(APP_CONFIG.LOCK_TIMEOUT_MS)) {
    throw createAppError(ERROR_CODES.BUSY, 'ระบบกำลังประมวลผล กรุณาลองใหม่อีกครั้ง');
  }

  try {
    const now = new Date().toISOString();
    repoUpdateRecord(SHEETS.USERS, user.id, {
      pin_hash: newHash,
      must_change_pin: false,
      rev: Number(user.rev || 1) + 1,
      updated_at: now
    });
    writeAuditLog(requestId, `${user.id} (${user.rank_name})`, 'CHANGE_PIN', user.id, {}, { status: 'PIN_UPDATED' });
    return { updated: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * สร้าง Error Object มาตรฐาน
 */
function createAppError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

if (typeof module !== 'undefined') {
  module.exports = { computePinHash, constantTimeEquals, sanitizeInput, canAccessSupplyLine, canReceiveSupply };
}