# ผลตรวจที่รันจริง

รันใน workspace วันที่ 2026-10-12 ด้วย Node.js v24.19.0 ไม่มีการติดตั้งหรือดาวน์โหลด dependency เพิ่ม

Node.js 22.22.0 ทดสอบโดยผู้รีวิว ซึ่งยืนยันผลของ `node --test tests/*.test.js`: 59 tests / 54 pass / 0 fail / 5 skipped ผู้พัฒนาไม่ได้รัน Node.js 22.22.0 ใน workspace นี้ และไม่มีผลทดสอบ Node.js 22.8.0 จึงตั้งขั้นต่ำ `engines` เป็น `>=22.22.0`

## ไฟล์ที่สร้างแล้ว

- `data/sample.csv`: UTF-8 BOM, 2,000 รายการสมมติ + หัวตาราง, 243,838 bytes
- `data/sample.xlsx`: 2,000 รายการสมมติ + หัวตาราง, 68,148 bytes
- `data/EXPECTED.md`: แผนปลูกและ JSON คงที่ที่ integration test อ่านโดยตรง
- `data/EXPECTED.json`: ค่าคงที่ชุดเดียวกัน ซึ่งทดสอบว่าตรงกับ Markdown ทุกค่า

## คำสั่งและผลลัพธ์

`npm run generate-sample` สำเร็จ (exit 0): seed `0x000A0D17`, จำนวนแถว 2,000, ยอดรวม 90,853,457.80 บาท ใช้ตัวสร้าง OOXML สำหรับ fixture ที่อาศัย Node built-ins เพราะ bundle SheetJS ยังไม่มี ดู output เต็มใน `GENERATE-SAMPLE-OUTPUT.txt`

รันตัวสร้างซ้ำแล้ว SHA-256 ของทั้งสองไฟล์ตรงกัน:

```text
819a9e504304bab84301e3ec087d6e10e3cdf1632273a8aae6acbc53f29ef0fd  data/sample.csv
ff2216a5bbbb182d3d85a1cbc3210dd6a41817f3afc1129bb542c124b1c36ce5  data/sample.xlsx
```

รัน `npm test` ซ้ำหลังแก้ script เป็น `node --test tests/*.test.js` โดยใช้ process isolation ปกติ คำสั่งคืน exit 0 แต่ sandbox ปฏิเสธ child process แบบ pipe ด้วย `EPERM` จึงรายงานเพียงไฟล์ทดสอบ 7 ไฟล์ ผลนี้ไม่ยืนยันว่ารัน assertion ครบ:

```text
tests 7
pass 7
fail 0
skipped 0
```

ตรวจ assertion เพิ่มด้วย plain Node โดย import ไฟล์ทดสอบเดิมทั้ง 7 ไฟล์จากโมดูลชั่วคราวนอก repository ไม่มีการแก้ test หรือเพิ่มตัวเลือก isolation ใน package script ผลที่รันจริง (exit 0):

```text
tests 59
pass 54
fail 0
cancelled 0
skipped 5
todo 0
```

ดูชื่อทุกกรณีและเหตุผลการข้ามใน `TEST-OUTPUT.txt` ชุดที่รันครอบคลุมการตรวจทั้ง 8 ประเภท อินพุตว่าง ค่าเซลล์ว่าง เลขไทย ปีสองหลัก จำนวนเงินติดลบ เลขซ้ำทั้งหมด อักขระซ่อน และขอบเขตการคำนวณ รวม integration บนไฟล์ XLSX/CSV จริง โดยเทียบจำนวนและเลขแถวกับ `EXPECTED.md` ทุกค่า

ผลชุด XLSX ตรงกับแผน: 12 กลุ่มเลขซ้ำ/24 แถว, 7 ช่องว่าง, 15 วันสุดสัปดาห์, 20 จำนวนเงินกลม (10 แถวหาร 10,000 ลงตัว), 9 จำนวนเงินชนิดข้อความ, 6 วันที่ พ.ศ. เป็นส่วนน้อย ข้อสังเกต hygiene รวม 12 แถวเพราะอักขระในเลขเอกสารอีก 3 แถว CSV ไม่มีชนิดเซลล์ จึงพบจำนวนเงินแบบข้อความ 2,000 แถวตามนโยบายอ่านค่าเป็นข้อความของเว็บ

ตรวจแยกด้วย openpyxl 3.1.5 ที่ติดตั้งอยู่แล้ว, Python CSV และ Decimal ด้วย `python3 /tmp/validate-audit-fixtures.py` (exit 0) ยืนยัน XLSX เปิดอ่านได้ มี 1,991 เซลล์จำนวนเงิน numeric และ 9 text, ไม่มีสูตร และทั้งสองไฟล์มีค่าเดียวกันพร้อมอักขระเดิม จำนวนและยอดรวมตรงกับแผน สคริปต์นี้ใช้เฉพาะการตรวจใน session ไม่ใช่ dependency ของโครงการ

## การทดสอบที่ข้ามและสิ่งที่ยังไม่ยืนยัน

ข้าม 5 กรณีเพราะไม่มี `vendor/xlsx.full.min.js` จริง:

1. XLSX import preserves physical row numbers, raw numeric/text cells and the 1904 date system
2. pasted CSV and TSV retain literal strings, Thai digits and blank row positions
3. loader records cached, uncached and error formula cells and truncation metadata
4. report round-trip contains Summary plus eight checks, traceable rows and literal strings
5. sample follows the browser loader, auto mapping, all-check runner and nine-sheet export flow

Integration ที่ผ่านใช้ตัวอ่าน fixture แยกจาก SheetJS จึงยืนยันฟังก์ชันตรวจและไฟล์ตัวอย่าง แต่ยังไม่ยืนยันการนำเข้า/ส่งออกรายงานด้วย SheetJS, กราฟ Chart.js, การใช้หน้าเว็บบนเบราว์เซอร์จริง, การเปิดด้วย Excel GUI หรือ GitHub Pages ยังไม่มี bundle จริงของ SheetJS/Chart.js และใบอนุญาตใน `vendor/` จึงยังไม่ควรถือว่าเว็บไซต์พร้อมใช้งาน

## คำสั่งที่ต้องรันบนเครื่องท้องถิ่น

ใช้ Node.js 22.22.0 ขึ้นไป (รุ่นที่ทดสอบแล้วคือ 22.22.0 โดยผู้รีวิว และ 24.19.0 โดยผู้พัฒนา), `curl` และเครือข่ายที่ดาวน์โหลดได้ เริ่มใน root ของโครงการ:

```sh
npm run vendor
npm run generate-sample
npm test
npm run serve
```

ไม่ต้องรัน `npm install` ตัวช่วย vendor ดาวน์โหลดเวอร์ชันที่ตรึงไว้พร้อมใบอนุญาตและ hash ให้เก็บไฟล์ที่ได้เข้า repository หลังมี SheetJS จริง `npm test` ต้องผ่านโดยไม่ข้าม 5 กรณีข้างต้น แล้วตรวจด้วยมือใน README ก่อนเผยแพร่ผ่าน GitHub Pages
