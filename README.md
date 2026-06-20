# QR Satisfaction App

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/bonuskee/qr-satisfaction-app)

เว็บแอป TypeScript สำหรับสร้างแบบสำรวจความพึงพอใจผ่าน QR Code ใช้ PostgreSQL บน Neon และเตรียม Deploy บน Render

## ระบบที่ใช้

- Render เปิดเว็บและ API ผ่าน HTTPS
- Neon PostgreSQL เก็บแบบสำรวจ คำตอบ ข้อมูลตรวจสอบอุปกรณ์ และ Session ผู้ดูแล
- QR Code ใช้ URL สาธารณะจาก Render โดยอัตโนมัติ
- Session ผู้ดูแลยังใช้งานได้หลัง Render พักหรือรีสตาร์ต ตราบใดที่ยังไม่หมดอายุ 8 ชั่วโมง

## เปิดในเครื่อง

ต้องใช้ Node.js 24 ขึ้นไป

```bash
npm install
cp .env.example .env
```

แก้ `.env` แล้วใส่ข้อมูลต่อไปนี้:

```dotenv
DATABASE_URL=ลิงก์แบบ pooled จาก Neon
ADMIN_PASSWORD=รหัสผ่านยาวอย่างน้อย 12 ตัวอักษร
DEVICE_HASH_SECRET=ข้อความสุ่มยาวอย่างน้อย 32 ตัวอักษร
HOST=127.0.0.1
PORT=3000
```

จากนั้นรัน:

```bash
npm start
```

เปิด `http://localhost:3000` ตารางฐานข้อมูลจะถูกสร้างอัตโนมัติเมื่อเริ่มเซิร์ฟเวอร์

## ย้ายข้อมูลเดิมจาก SQLite ไป Neon

หลังกรอก `DATABASE_URL` ใน `.env` แล้ว ให้รันคำสั่งนี้เพียงครั้งเดียว:

```bash
npm run db:migrate:sqlite
```

คำสั่งนี้รวมข้อมูลเดิมเข้ากับ Neon โดยไม่ลบข้อมูลที่มีอยู่ และไม่เพิ่มคำตอบเดิมซ้ำ

## เปิดเว็บสาธารณะด้วย Render

1. สร้างโปรเจกต์ฟรีใน Neon
2. กด `Connect` เลือก `Pooled connection` แล้วคัดลอก Connection string
3. สร้าง Repository ใน GitHub และอัปโหลดไฟล์โฟลเดอร์นี้ โดยให้ `render.yaml` อยู่ที่หน้าแรกของ Repository
4. เข้า Render แล้วเลือก `New` > `Blueprint`
5. เชื่อม Repository จาก GitHub
6. กรอก `DATABASE_URL` ด้วย Pooled connection string จาก Neon
7. กรอก `ADMIN_PASSWORD` เป็นรหัสใหม่ที่ยาวอย่างน้อย 12 ตัวอักษร
8. กด Apply เพื่อสร้าง Web Service แบบ Free
9. รอ Deploy สำเร็จ แล้วเปิด URL รูปแบบ `https://ชื่อบริการ.onrender.com`
10. ตรวจ `https://ชื่อบริการ.onrender.com/api/health` ต้องแสดง `{"status":"ok"}`

`DEVICE_HASH_SECRET` จะถูก Render สร้างให้โดยอัตโนมัติและไม่ถูกบันทึกลง GitHub

## ตัวแปรระบบ

- `DATABASE_URL` Pooled connection string ของ Neon
- `ADMIN_PASSWORD` รหัสเข้าสู่ Dashboard ขั้นต่ำ 12 ตัวอักษร
- `DEVICE_HASH_SECRET` Secret สำหรับแฮชข้อมูลเครือข่าย ขั้นต่ำ 32 ตัวอักษร
- `PUBLIC_URL` ไม่จำเป็นบน Render แต่ใช้กำหนดโดเมนเองได้
- `HOST` ใช้ `0.0.0.0` บน Render
- `PORT` Render กำหนดให้อัตโนมัติ

## โครงสร้างหลัก

- `server.ts` เซิร์ฟเวอร์, API, Login และ Security headers
- `database.ts` การเชื่อมต่อ Neon PostgreSQL
- `schema.sql` ตารางและดัชนีฐานข้อมูล
- `scripts/migrate-sqlite-to-postgres.ts` ย้ายข้อมูล SQLite เดิม
- `render.yaml` การตั้งค่า Deploy บน Render
- `src/components/*` ส่วนประกอบ UI
- `src/styles/*` CSS แยกตามส่วน

## ความปลอดภัย

- Session เก็บเฉพาะค่าแฮชของ Token ใน PostgreSQL
- คุกกี้ Login เป็น `HttpOnly`, `SameSite=Strict`, `Secure` เมื่อใช้ HTTPS และหมดอายุใน 8 ชั่วโมง
- จำกัดการลองรหัสผ่านและการส่งคำตอบถี่เกินไป
- เก็บรหัสอุปกรณ์และเครือข่ายเป็นค่าแฮช ไม่เก็บ IP ดิบ
- ตั้ง Content Security Policy และ HTTP security headers
- ไม่บันทึก `.env`, ฐานข้อมูล SQLite หรือรหัสลับลง GitHub
