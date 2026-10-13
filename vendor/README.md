# ไลบรารีภายในโครงการ

เว็บไซต์โหลดไลบรารีจากโฟลเดอร์นี้เท่านั้น ไม่มี runtime CDN

| ไลบรารี | เวอร์ชัน | ไฟล์ | ใบอนุญาต |
| --- | --- | --- | --- |
| SheetJS CE | 0.20.3 | `xlsx.full.min.js` | Apache-2.0, `LICENSE-SheetJS.txt` |
| Chart.js | 4.5.1 | `chart.umd.min.js` | MIT, `LICENSE-Chartjs.md` |

แหล่งไฟล์และเวอร์ชันที่ตรึงอยู่ใน [scripts/vendor-libraries.js](../scripts/vendor-libraries.js) ตัวช่วยนี้ใช้เฉพาะตอนเตรียม source และต้องได้รับสิทธิ์เครือข่าย รัน `npm run vendor` เมื่อจำเป็น จากนั้นเก็บไฟล์ไลบรารี ใบอนุญาต และ `SHA256SUMS.txt` เข้า Git ไม่ใช่ขั้นตอน build หรือ runtime ของเว็บไซต์

`xlsx.cjs` เป็นตัวช่วย Node ที่โหลด bundle เดียวกันสำหรับการสร้างข้อมูลตัวอย่างและการทดสอบ
