import { describe, it, expect } from 'vitest';
const {
  ITEMS_SEED, USERS_SEED, ROLES, validateAccountingInvariants
} = require('../src/Config.gs');
const {
  computePinHash, constantTimeEquals, sanitizeInput, canAccessSupplyLine, canReceiveSupply
} = require('../src/Security.gs');

describe('LOGSMIS กรมทหารพรานที่ 46 — Accounting Invariants & Security Suite', () => {
  it('รายการสิ่งอุปกรณ์ตั้งต้นทั้ง 34 รายการต้องผ่านสมการสมดุลบัญชีครบทุกข้อ', () => {
    expect(ITEMS_SEED).toHaveLength(34);
    ITEMS_SEED.forEach((item) => {
      const res = validateAccountingInvariants(item);
      expect(res.valid, `Item ${item.id} failed: ${res.errors.join(', ')}`).toBe(true);
    });
  });

  it('ต้องตรวจจับความผิดปกติได้ทันทีเมื่อยอดรับไม่เท่ากับยอดจ่ายบวกยอดคงคลัง', () => {
    const brokenItem = { ...ITEMS_SEED[0], depot_reserve_qty: 9999 };
    const res = validateAccountingInvariants(brokenItem);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it('การแฮชรหัส PIN ด้วย SHA-256 + Salt ต้องให้ผลลัพธ์ตรงกันและไม่เปิดเผยรหัสเดิม', () => {
    const salt = 'test-salt-rta-46';
    const hash1 = computePinHash('USR-001', '468912', salt);
    const hash2 = computePinHash('USR-001', '468912', salt);
    const wrongHash = computePinHash('USR-001', '460001', salt);

    expect(hash1).toHaveLength(64);
    expect(constantTimeEquals(hash1, hash2)).toBe(true);
    expect(constantTimeEquals(hash1, wrongHash)).toBe(false);
  });

  it('ระบบ ABAC ต้องจำกัดสิทธิ์เจ้าหน้าที่ตามสายงานที่รับผิดชอบอย่างเคร่งครัด', () => {
    const ammoOfficer = { ...USERS_SEED.find(u => u.id === 'USR-009'), status: 'ACTIVE' }; // สป.5
    const qmOfficer = { ...USERS_SEED.find(u => u.id === 'USR-011'), status: 'ACTIVE' };   // สาย พธ. และ สาย พ.
    const commander = { ...USERS_SEED.find(u => u.id === 'USR-001'), status: 'ACTIVE' };   // ผบ.กรม

    expect(canAccessSupplyLine(qmOfficer, 'สาย พธ.')).toBe(true);
    expect(canAccessSupplyLine(ammoOfficer, 'สาย พธ.')).toBe(false);
    expect(canAccessSupplyLine(commander, 'สาย พธ.')).toBe(true);

    expect(canReceiveSupply(qmOfficer, 'สาย พธ.')).toBe(true);
    expect(canReceiveSupply(commander, 'สาย พธ.')).toBe(false); // ผบ.กรม can_receive_sp = NO
  });

  it('sanitizeInput ต้องป้องกัน Formula Injection บน Google Sheets', () => {
    expect(sanitizeInput('=IMPORTXML("http://evil")', 100).startsWith("'=")).toBe(true);
    expect(sanitizeInput('+SUM(A1:A10)', 100).startsWith("'+")).toBe(true);
    expect(sanitizeInput('เบิกใช้ราชการสนาม', 100)).toBe('เบิกใช้ราชการสนาม');
  });
});