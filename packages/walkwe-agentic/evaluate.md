# Walk We · ประเมิน GPT Context และ Agent Loop

ประเมิน 21 พฤศจิกายน 2569 เวลาไทย · แพ็กเกจ `packages/walkwe-agentic` · route fixture `siam-sandbox-1` · context contract `walkwe-context-v1`

Intent ใช้ **GPT‑6.1 Terra** (`gpt-6.1-terra`, effort `none`) และ strict structured output ส่วน Planner ใช้ Terra `high` และ Critic ใช้ GPT‑6.1 Sol `high` โดยจำกัด output รวม reasoning ต่อ API call ที่ 4,096 และ 6,144 tokens ตามลำดับ [โปรไฟล์ที่ใช้](src/model.mjs)

## Context Engineering

| ชั้น | สิ่งที่ลงโค้ดและทดสอบ |
|---|---|
| คำสั่งคงที่ | เก็บ instructions ของ Intent, Planner, Critic และ Companion แยกจาก user data, place catalogue, Worker snapshot และผลเครื่องมือ ทุกครั้งใช้ strict schema ตามบทบาท |
| Intent | ส่งคำขอไม่เกิน 500 ตัวอักษรและ catalogue จำกัด ตัดรูปแบบลิงก์ อีเมล เบอร์โทร และพิกัดที่รองรับก่อนส่ง เก็บบทบาทต้นทาง/ปลายทางหากรู้แน่จากคำนำใน parser ของ fixture เมื่อ model draft ขัดกับชื่อที่ระบบจับคู่ได้หรือกำกวม ให้ใช้ local draft และให้ผู้ใช้ยืนยัน |
| Planner/Critic | ส่งเฉพาะ route IDs, constraints, เวลา Asia/Bangkok, metrics และหลักฐานจาก snapshot เดียวกัน จำกัดข้อมูลตั้งต้น 16 KiB และตัด geometry, raw user request และ arbitrary source text หลักฐานระบุ `observedAt`, `ageStatus`, method และ `datasetVersion` ข้อมูลแสงอายุเกิน 90 วันหรือมาจากอนาคตเป็น `unknown` ก่อนคิดเส้นทางและก่อน stress test มีคำอธิบายกำกับเมื่อกระทบคำแนะนำ |
| การคงสถานะระหว่างรอบ | ใช้ OpenAI Responses แบบ `store: false` replay เฉพาะ function call/output ที่ตรวจแล้วและ encrypted reasoning items ที่จำเป็น ภายใน run เดียวและมีเพดาน 96,000 bytes Trace ส่งชื่อ step, evidence ID, สถานะ, เวลา และตัวนับ โดยเก็บ expected labels อยู่ในชุดประเมินแยกจาก runtime |

กฎของ fixture ตรวจ snapshot เวอร์ชันที่ caller คาดและความสอดคล้องของ segment ID ที่ซ้ำข้ามทางเลือก หาก worker เก่ายังอ้างไฟที่หลักฐานเก่าหรืออยู่ในอนาคต จะคืน `stale_snapshot` ให้ caller คำนวณใหม่ ส่วนตัวอย่างคำขอที่มีชื่อสถานที่ใหม่ยังต้องพึ่ง gazetteer ของแอปตัวจริง [Context](src/context.mjs) · [Workflow](src/workflows.mjs)

## Loop Engineering กับ GPT Harness

1. โค้ดยืนยันว่าผล Worker ใช้ได้และสร้าง snapshot สำหรับ Planner ถ้าผลแนะนำเปลี่ยนตามสมมติฐานแสง ให้คืน `VERIFY` และ clarification ID คงที่ แอปเก็บคำตอบ `direct` หรือ `prefer_evidence` กับ trip แล้วใช้ snapshot เดิมตอนเรียกซ้ำ หลังได้คำตอบแล้วไม่มี clarification รอบใหม่สำหรับคำขอนั้น
2. Harness ให้ Planner ใช้ได้ทีละ tool จาก allowlist คือ `get_segment_evidence` และ `finish_trip` ต้องอ่านทุก segment ที่มีผลต่อ stress test ก่อนจบ ถ้าข้าม ให้ feedback ระบุเฉพาะ evidence IDs ที่ยังไม่ได้อ่าน และลองใหม่ได้เมื่อมีหลักฐานเพิ่ม
3. Verifier ตรวจ route ID, decision, reason, required evidence IDs และลำดับการอ่าน เรียก Critic เมื่อผลพลิกหรือเวลาตัวเลือกต่างกันไม่เกินสองนาที เครื่องมือไม่รู้จัก, arguments ผิด, call ID ซ้ำ และข้อมูลนอก snapshot หยุดทันที
4. Planner สูงสุด 6 steps และ 8 tools โดยเปิดทีละ tool จึงมีโอกาสเรียกได้สูงสุด 6 ครั้งในรุ่นนี้ หยุดหลัง verifier ปฏิเสธ 2 ครั้ง เท่ากับอนุญาต retry หลังปฏิเสธครั้งแรกหนึ่งครั้ง ใช้ deadline 20 วินาทีร่วมกับ Critic หลังได้ Worker result เมื่อหมดเวลา, model ล่ม, ไม่มีความคืบหน้า หรือ Critic ไม่รับ ให้คืนผล Worker และเหตุ fallback

`ACT/VERIFY/ABSTAIN` เป็นผลการตัดสินใจต่อเส้นทาง ส่วน `verified/fallback` ใน `loop.status` เป็นสถานะการจบลูป สองค่าอยู่คนละ field [Harness](src/harness.mjs) · [Responses client](src/model.mjs)

## รีวิวร่วมกับ Claude

Claude อ่านไฟล์นี้และ source ของ context, loop และ parser แล้วลอง parser ในเครื่องโดยตรง พบว่า **“เซ็นทรัลชิดลม” ถูกจับเป็นสถานี BTS** และ **“สามทุ่มครึ่ง” ถูกแปลเป็น 21:00** นอกจากนี้พบว่าป้าย stale เพียงอย่างเดียวยังปล่อยให้ไฟเก่ามีผลต่อการเลือกทาง แก้ทั้งสามจุดและรัน regression แล้ว

| ข้อเสนอจาก Claude | สิ่งที่ตรวจและผล |
|---|---|
| E1 ชื่อซ้อนและนอกพื้นที่ | `I11–I14` รวมเซ็นทรัลชิดลม, เซ็นทรัล, ทะนิยะ และสยามพารากอน `H18` ตรวจว่า model ที่คืน ID ของ BTS ชิดลมถูกตีกลับเมื่อคำขอหมายถึงห้าง |
| E2 ต้นทาง–ปลายทางและเวลาภาษาไทย | `I03–I06`, `I09–I10`, `I15–I17` ครอบคลุมข้อความเรียงกลับ, ระบุแค่ปลายทาง, ใช้เลขไทย, ระบุทางเลือก, สามทุ่มครึ่ง, หกโมงเย็น และคำสั่งแทรก ผลสำหรับสามทุ่มครึ่งคือ 21:30 |
| E3 Tool loop ผิดรูปแบบ | `H03–H11`, `H14–H15` ครอบคลุมการกู้คืนเมื่ออ่านหลักฐานเพิ่ม, เรียกซ้ำ, finish โดยไม่มีหลักฐาน, ส่งข้อความแทน tool, ใช้ schema ผิด และเครื่องมือหรือหลักฐานนอกสิทธิ์ |
| E4 Deadline และ provider ล่ม | `H12–H13`, `H16–H17` ครอบคลุม Critic ปฏิเสธ, caller ยกเลิก, Critic ค้างแล้วหมด deadline และ HTTP 503 เคส deadline ฉีดเวลา 15 ms เพื่อตรวจเส้นทาง timeout ของ harness เดียวกับค่าเริ่มต้น 20 วินาที |
| E5 ข้อมูลเก่าและเปลี่ยนระหว่างทริป | `R06–R08`, `R10–R12` ครอบคลุมคนละ snapshot, segment ID ซ้ำแต่หลักฐานขัดกัน, หลักฐานเก่าและอนาคต, adapter ที่ยังตีความ stale เป็น lit และทางเดินที่เปิดตอนเข้าแต่จะปิดก่อนออก |

รายละเอียดอินพุตและ expected อยู่ใน [ชุดประเมิน](evals/cases.mjs) รายการนอก pilot เป็น fixture สำหรับ regression และจะย้ายไปใช้ข้อมูลสถานที่จริงเมื่อเชื่อมกับแอป

## ผลที่รันและตีความได้

| การรัน | ผ่าน | สิ่งที่ยืนยัน |
|---|---:|---|
| Node unit/integration | 13/13 | ส่วนประกอบหลัก รวม Voice/SOS แบบจำลอง, MCP stdio และการรายงาน HTTP status โดยไม่บันทึก body ของ provider |
| Fixture eval | 34/34 | Intent ไทย/อังกฤษ 17 กรณี, routing/evidence 12 กรณี, สิทธิ์และ fallback 5 กรณี |
| Mocked Responses eval | 18/18 | Payload รุ่น Terra และการตัดข้อมูล, tool replay, verifier/Critic, budget และ fallback ดัก trap ที่กำหนดได้ 14/14 |
| Live OpenAI API | 0 เคส | รอบล่าสุดยังรอคีย์สำหรับ eval และยังไม่ได้ส่งคำขอไป OpenAI เกณฑ์ accuracy, latency และรายการเคสที่ไม่ผ่านพร้อมบันทึกเมื่อรันได้ |

ผล 52/52 คือ coverage ของเคสที่กำหนดใน fixture/mock รันยืนยันซ้ำสามรอบและผ่านทุกครั้ง ความแม่นของ GPT‑6.1 Terra บนคำขอจริงยังต้องวัดหลัง live run และควรแยกแหล่งข้อมูล Worker กับวันของ dataset เมื่อเทียบผล [รายงาน JSON](evals/eval_report.json)

```sh
npm test
npm run eval -- --out evals/eval_report.json
npm run eval -- --live --out evals/eval_report.json
```

Live lane มีเคส Intent ภาษาไทย/อังกฤษและ Planner กลางวัน/กลางคืน รวม 12 เคสที่รันผ่าน Responses client เดียวกัน ตัดสินผลจาก expected fields และ verifier ในโค้ด รายงานแสดง input, output, reasoning, cache read/write และ USD ต่อรอบจาก usage ที่ API ส่งกลับ ค่าใช้จ่ายเป็นประมาณการตามราคา Standard และอาจไม่รวมคำขอที่ถูกยกเลิกก่อนรับ usage [ตัวรัน](evals/run.mjs) · [ราคา OpenAI](https://developers.openai.com/api/docs/pricing)
