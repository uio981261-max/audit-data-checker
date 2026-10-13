import { decimalParts, result } from './utils.js';

const MINIMUM_AMOUNTS = 300;

/** First significant digits of usable, nonzero absolute amounts. */
export function checkBenford(rows) {
  const counts = Array(10).fill(0);
  let usableCount = 0;
  for (const row of rows) {
    const amount = decimalParts(row.amount);
    if (amount === null || amount.integer === 0n) continue;
    // Decimal scale does not affect the first significant digit; text retains
    // its first digit even when Number conversion would round 999… to 1000….
    const digit = Number((amount.integer < 0n ? -amount.integer : amount.integer).toString()[0]);
    counts[digit] += 1;
    usableCount += 1;
  }
  const distribution = Array.from({ length: 9 }, (_, index) => {
    const digit = index + 1;
    return { digit, count: counts[digit], observed: usableCount ? counts[digit] / usableCount : 0, expected: Math.log10(1 + 1 / digit) };
  });
  const skipped = usableCount < MINIMUM_AMOUNTS;
  return result('benford', [], {
    usableCount, excludedCount: rows.length - usableCount, minimumAmounts: MINIMUM_AMOUNTS, skipped, distribution,
    message: skipped ? `ยังไม่แสดงกราฟ: มีจำนวนเงินที่ใช้ได้ ${usableCount} รายการ น้อยกว่า ${MINIMUM_AMOUNTS} รายการ` : `เปรียบเทียบเลขหลักแรกจากจำนวนเงิน ${usableCount} รายการ`,
    note: 'ความแตกต่างจากค่าคาดหมายเป็นเพียงตัวชี้ให้สอบถามเพิ่มเติม ไม่ใช่หลักฐานยืนยันข้อผิดพลาดของรายการ วิธีนี้เหมาะกับจำนวนเงินที่เกิดตามธรรมชาติและมีช่วงขนาดหลากหลาย',
  });
}
