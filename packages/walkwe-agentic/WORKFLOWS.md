# Walk We · ข้อตกลงของ Agentic AI

สถานะ 21 พ.ย. 2569 · ขอบเขตรอบนี้คือ workflow, Model API, MCP, การทดสอบ และการส่งต่องานทีม โครง UI และการเชื่อมหน้าจอจะเริ่มเมื่อทีมแจ้งว่า repo ของแอปพร้อม

## ฟีเจอร์ AI ที่เพิ่ม

| ลำดับ | ฟีเจอร์ | ความเปลี่ยนแปลงที่ผู้ใช้เห็น | เกณฑ์ตัดสินว่าผ่าน |
|---|---|---|---|
| 1 | **Route Evidence และ Night Confidence** | ถามเป็นภาษาธรรมชาติ เลือกข้อจำกัดและเทียบเวลา ระยะ และข้อมูลไฟรายช่วง เมื่อสมมติฐานของช่วง unknown ทำให้ผลพลิก Planner ชี้จุดที่ทำให้พลิกและถามเพิ่มได้หนึ่งครั้ง | ผลเลือก route ตรงกับ Worker ทุกตัวเลข ค่า unknown ยังเป็น unknown ทั้งข้อความและ trace ชี้ evidence/version ได้ |
| 2 | **Departure Advisor กลางวัน** | เมื่อเลื่อนเวลา ระบบเทียบเวลาถึงและนาทีที่คาดว่าโดนแดดภายใต้เวลาเปิดทางเดินและข้อจำกัดเดิม ใช้กราฟรายชั่วโมงจากเว็บเดิมเป็น baseline | ค่า ETA/นาทีโดนแดดมาจาก Worker เวลาเดินสะท้อนค่า `Asia/Bangkok` และทางที่ปิดระหว่างเดินถูกตัด |
| 3 | **ถามรายละเอียดทริปด้วยเสียงไทย** | บอกชื่อสถานที่ ถามว่าช่วงไหนไฟยังไม่มีข้อมูล หรือขอเปิดแผงช่วยเหลือจากทริปเดียวกัน | ชื่อกำกวมเข้าสู่การยืนยัน ตัวเลขจากแอป การขอช่วยเหลือเปิดแผงได้และไม่มีเหตุส่งออกจากเสียง |
| 4 | **Companion ตามเหตุการณ์** | แจ้งเมื่อกฎพบว่าฝนมา เวลาจะเข้าช่วงกลางคืน ทางจะปิด หรือมีช่วงข้อมูลแสงข้างหน้า แล้วเสนอให้ผู้ใช้เลือกทางใหม่ | แจ้งตาม trigger จริง ใช้เพดานสองครั้งต่อทริป ผู้ใช้ต้องยืนยันก่อนสลับ route |
| 5 | **Evidence Steward และสกัดข่าวเข้าคิว** | ถามผู้ใช้หลังเดินเฉพาะช่วงที่ข้อมูลขาดและเปลี่ยนคำแนะนำ รวมรายงานและข่าวเป็นรายการที่คนตรวจได้ | ข่าวและภาพยังคง pending ข้อมูลที่อนุมัติมีแหล่ง เวลา และ audit trail แล้ว replay ทริปเดิมผ่าน snapshot ใหม่ |

งานเดโมเริ่มจาก **ข้อ 1 และข้อ 2** บนเส้นทางเดียวกัน ต่อเสียงไทยเมื่อผลจาก Worker และ verifier ผ่านแล้ว ใช้คำสั่งพิมพ์เป็นทางเลือกเสมอ ส่วน SOS เป็น workflow ที่ผู้ใช้ควบคุม เหมาะให้เดโมในโหมดซ้อมแยกจากการประเมินโมเดล

## เส้นทางข้อมูล

คำขอไทย/อังกฤษหรือ Voice tool → Intent และยืนยันสถานที่ → Worker คำนวณกราฟตามเวลา → Planner ขอหลักฐานและเสนอผล → Critic เมื่อมีข้อสงสัย → verifier ตรวจ → แอปคืนผลแบบข้อความหรือเสียงที่เติมตัวเลขจาก Worker

ระหว่างเดิน สัญญาณจากแอปเข้า Companion แบบ event-driven เมื่อจบทริป ข้อสังเกตที่ยินยอมให้ใช้เข้า Steward และคิวคนตรวจ เปลี่ยน `datasetVersion` หลังอนุมัติแล้วจึงนำ overlay มาใช้ในการคำนวณครั้งถัดไป

## Runtime และฝ่ายทีม

| Workflow / เจ้าของ | Input → Output และสิทธิ์ | จบและ fallback |
|---|---|---|
| **Intent — GPT‑6.1 Terra** `gpt-6.1-terra` effort `none` | ข้อความที่ตัดรูปแบบข้อมูลติดต่อที่รองรับและรายชื่อสถานที่ที่อนุญาต → draft `from/to/time/mode/noStairs` ผ่าน schema ผูกกับ gazetteer | รอยืนยันสถานที่และข้อจำกัดก่อนวางทาง เมื่อโมเดลใช้ชื่อผิดบทบาท ตั้งชื่อที่ไม่รองรับ หรือ provider ขัดข้อง ให้ใช้ parser ในเครื่องหรือฟอร์ม |
| **Routing Worker — โค้ด** | จุดและข้อจำกัดที่ยืนยันแล้ว, ETA, coverage, snapshot → route IDs/metrics/หลักฐาน/ทางสั้นสุดที่เดินได้ กลางวันอ่าน SunCalc/OSM/Turf/Open‑Meteo ผ่าน adapter กลางคืนใช้หลักฐานสถานะไฟ | `ok/no_path/out_of_coverage/invalid` ไม่มีทางที่ใช้ได้ให้แสดงเหตุ ไม่ใส่คะแนนจากโมเดล |
| **Planner — GPT‑6.1 Terra** `gpt-6.1-terra` high | รับ context จำกัดจาก Worker snapshot และเรียก `plan_routes`, `stress_test_route`, `get_segment_evidence` หรือ tool อื่นที่เกี่ยวข้องใน snapshot เดียวกัน ส่ง draft ผ่าน `finish_trip` | `ACT`, `VERIFY`, `ABSTAIN` ตาม Worker และ verifier ถามได้ครั้งเดียวเมื่อผลพลิก ใช้ deadline 20 วินาทีร่วมกับ Critic และสูงสุด 6 Planner steps ถ้าลูปจบผิดเงื่อนไขให้แสดง template จาก Worker |
| **Critic — GPT‑6.1 Sol** `gpt-6.1-sol` high | ข้ออ้างแบบมี enum และหลักฐาน snapshot เดียวกัน → `accept/reject` พร้อมเหตุผล โค้ดใช้เฉพาะ verdict ที่ผ่าน schema | เรียกเมื่อ unknown ทำให้ route พลิก เส้นทางสูสี หรือมี claim สำคัญ ใช้ deadline เดียวกับ Planner ถ้าล่มแสดงผล Worker พร้อม caveat |
| **Companion — GPT‑6.1 Terra ตามแผน** | แอปส่ง trigger, route summary และโควตา → `silent/warn/offer_replan` อนุญาตอ่าน weather และขอ route ใหม่จาก Worker | ปิด trigger หลังตัดสินหนึ่งครั้ง ห้ามสลับทางเอง ใช้ template ตามกฎได้เมื่อปิดโมเดล |
| **Steward — GPT‑6.1 Terra ตามแผน** | กลุ่ม unknown, ข้อมูลรายงานแบบลดตัวตน และ label จากภาพที่ผ่าน consent → candidate proposal ไม่มีสิทธิ์เปิดดูข้อมูลผู้เดินหรือ publish | จบที่ draft หรือขอเพิ่ม evidence หากเสียงโหวตไม่พอคง unknown จนกว่าคนตรวจ |
| **ข่าว — GPT‑6.2 Sol** `gpt-6.2-sol` medium | ข้อความข่าวสาธารณะที่ทีมส่งเข้า และ segment IDs ที่อนุญาต → วันเกิดเหตุ/วันเผยแพร่/ประเภท/ช่วงถนน/URL เป็นร่าง ไม่รับ URL ที่เครื่องมือของโมเดลสร้างเอง | `pending_review` เสมอ จับคู่ไม่ได้เก็บ unassigned ให้ผู้ตรวจตัดสิน โค้ด dedupe และเลือกรับเฉพาะรายการอนุมัติใน dataset |
| **Human review — คนและฐานข้อมูล** | ผู้ดูแลที่ backend ยืนยันสิทธิ์อ่าน pending proposal ตรวจแหล่งและช่วงเวลา → approve/reject และบันทึก audit | publish เป็น transaction ที่ตรวจ revision พร้อม bump dataset version กรณีข้อมูลใหม่เข้าคิวระหว่าง approve ให้ขอโหลดใหม่ |
| **Voice — ElevenLabs** | Adapter มี 13 client tools และใช้ trip กับช่วงถนนจาก state ฝั่งแอป ข้อความสำหรับพูดมาจาก callback ของแอป | คำสั่งช่วยเหลือเปิด SOS sheet และคำสั่งแชร์เปิดหน้าขอยืนยัน รอต่อ callbacks กับหน้าแอปจริง |
| **SOS — state machine และบริการส่ง** | กดค้าง/ตัวเลือกเข้าถึง → นับถอยหลังที่ยกเลิกได้ → ยืนยันและส่งถึง verified recipient ที่ยังยินยอม ระดับสิทธิ์และการส่งซ้ำคุมฝั่ง server | แยก provider accepted, recipient ACK, cancel, failed, delivery unknown, expired และ practice โหมดซ้อมใช้ simulator เท่านั้น |
| **Build / eval — Codex และ harness** | Fixture, Worker snapshot, model ID/effort, mock provider และ regression cases → ผล eval พร้อม trace ที่ตัดข้อมูลส่วนตัว | เก็บ test results ของ fixture, mocked provider และ live แยกกัน ใช้ replay พร้อมป้ายถ้า runtime ยังไม่พร้อม |
| **MCP — อ่านอย่างเดียว** | Codex หรือ Claude ส่ง segment ID กับ fixture/mode → หลักฐานหรือ route replay จากชุดข้อมูลที่ระบุ ไม่มี action ที่เผยแพร่และไม่รับพิกัด/เบอร์ | คืน output พร้อม dataset version และป้าย fixture ใช้ CLI หรือ worker core เดิมเมื่อไม่มี MCP |
| **Dot — ผู้ช่วยทีมเฉพาะงาน Walk We** | project docs, ขอบเขตโฟลเดอร์, สถานะ tests ที่ทีมอนุมัติ และรายการตัดสินใจ → ติดตาม blocker, เช็ก acceptance, สรุป handoff | ส่งผลให้เจ้าของตรวจใน ChatGPT สิทธิ์ deploy, key, ข่าวอนุมัติ และ SOS อยู่กับคนหรือบริการที่รับผิดชอบ |

## กติกาข้าม workflow

- Route options และ shortest ใช้ข้อจำกัดเดียวกัน ตรวจทางเปิด ณ ETA จุดผ่าน บันได ขอบเขต pilot และเวลาไปถึงก่อนให้คำแนะนำ ใช้ SunCalc v1/v2 ผ่าน adapter ที่ normalize หน่วยและทิศ MapLibre รับ geometry มาแสดง
- สถานะไฟแยก known lit, dark และ unknown สถานะ lamp/CCTV/crowd เป็นคนละปัจจัย แสดง source, observed time, stale/estimated และ version ห้าม extrapolate ความสว่างจากชั้นถนน
- Stress test คำนวณผลสองสมมติฐานสำหรับ unknown หากผลพลิกคงตัวชี้ช่วงที่มีผลใน trace ข้อมูลใน dataset ยังเป็น unknown
- Model output เลือก enum และ IDs จำกัดเท่านั้น ตัวเลขและคำอธิบายสุดท้ายประกอบจากค่าที่ตรวจแล้ว โค้ดตรวจ snapshot, ความสอดคล้องของ claim, เงื่อนไขเวลา/ทางเดิน และถ้อยคำรับประกัน
- แยก function call ฝั่งแอป, Model API/ElevenLabs และ HTTP services ฝั่ง server ออกจาก MCP สำหรับเครื่องมือทีมเก็บ key ฝั่งบริการ และไม่มี raw GPS, เบอร์, ภาพดิบ หรือ transcript ใน MCP, Dot หรือ eval artifacts
- ข่าว/รูป/user prompt และ tool outputs เป็น input ที่ผ่าน schema ผ่าน model allowlist และไม่มีสิทธิ์เปลี่ยนคำสั่งระบบ

## ข้อตกลงพื้นที่ของทีม

- Claude ยืนยันว่า Codex ดูแล `packages/walkwe-agentic/` สำหรับ core, adapters, fixtures, MCP และ tests ส่วนงานของ Claude ในรอบที่ประสานอยู่ที่เอกสารสเปกและค่าตั้ง ElevenLabs
- UI และ routing worker ของแอปจะเชื่อมผ่าน adapter ตาม path และ schema ที่ทีมส่งให้
- อ่านผล approval และ audit ผ่าน interface ของ service ทีมรับผิดชอบ data storage เลือก DB และ migration หลัง repo ตัวแอปเข้ามา
- ตรวจสอบ live provider, sender/receiver และ build ที่ deploy จากหลักฐานใหม่ก่อนประกาศว่าใช้งานจริง

## สถานะโค้ดที่ตรวจได้

| สิ่งที่เพิ่มในแพ็กเกจ | สถานะ |
|---|---|
| Intent, Planner, Critic, Companion | Node modules และ HTTP preview ผ่านเทสต์ fixture และ mocked model ตรวจ route/metric consistency, บังคับอ่าน evidence ก่อนจบ และ fallback เมื่อ tool/model ผิด |
| กราฟสยามจำลอง, แดด/เวลาเดิน, night stress test | เทียบสองเวลาและทดสอบยืนยันว่า unknown ทำให้ route เปลี่ยนได้ กราฟไม่มีหลักฐานเดินจริงและไม่ใช้แนะนำการเดิน |
| ข่าว, Steward, Human review, photo label | ร่าง pending และ role gate ใช้ได้ในเทสต์ ระบบฐานข้อมูล, upload/reencode ภาพ, verified identity และการ publish transaction ต้องต่อ service ของแอป |
| Voice | มี signed URL helper, preview tools สามตัว และ adapter ครบ 13 client tools รอผูก React SDK และ callbacks ฝั่งหน้าแอป |
| SOS | state machine พร้อมโหมดซ้อมและสัญญา outbox ที่ต้องตรวจ gesture, ขอบเขตเจ้าของ, verified destination และ idempotency ฝั่งโฮสต์ทดสอบด้วย transport จำลอง การจัดเก็บผู้รับ verified, live share และการส่งจริงยังต้องต่อบน staging |
| MCP | stdio ใช้ได้ผ่านทดสอบ handshake, `tools/list`, `tools/call` และปฏิเสธเวอร์ชันที่ไม่ตรง มี 3 tools สำหรับ fixture |
| Dot | เตรียมบทบาท งาน และขอบเขตข้อมูลไว้ใน [DOT.md](DOT.md) การสร้างหรือผูก Dot ใหม่อยู่ที่บัญชี ChatGPT |

แผนสัญญาของระบบจริงอยู่ที่ `POST /agent/step`, `POST /parse`, `POST /explain`, `POST /speak` และ data/approval endpoints ตามสเปก §5, §7, §12 ส่วน HTTP routes ใน [README](README.md) ใช้ทดสอบพฤติกรรมของแพ็กเกจ ฝั่งแอปจะใช้ adapter รักษารูปแบบเดิมและ map ชื่อ field/version กับ worker ก่อน merge

**ผลในเครื่อง** eval ผ่าน fixture 34/34 และ mocked Responses 18/18 ทริปทดสอบกลางคืนคืน `VERIFY` พร้อม evidence ID `lane-gap` จาก `siam-sandbox-1` ค่าจำลองของทางสั้นคือ 640 ม. โดยมีช่วงไม่มีข้อมูลไฟ 180 ม. ทางอ้อมใน fixture คือ 766 ม. [วิธีรันและอ่านผล](evaluate.md)
