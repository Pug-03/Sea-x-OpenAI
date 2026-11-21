# Walk We Agentic

แพ็กเกจ Node สำหรับทดสอบ workflow แยกจากแอป และใช้เป็นฐานต่อกับ routing worker จริงภายหลัง เริ่มที่ [รายงาน workflow และ AI Features](WORKFLOWS.md) และ [ขอบเขต Dot](DOT.md)

## ตรวจในเครื่อง

ใช้ Node 22 ขึ้นไป แพ็กเกจไม่ต้องติดตั้ง dependencies

```sh
npm test
npm run eval -- --out evals/eval_report.json
npm start
```

`npm test` ใช้ graph จำลองและ mock model/transport โดยไม่เรียก OpenAI, ElevenLabs หรือผู้รับจริง `npm start` เปิด loopback ที่ `127.0.0.1:4178` เปลี่ยนได้ด้วย `WALKWE_PORT`

| Preview route | รับ JSON | คืน |
|---|---|---|
| `GET /api/status` | — | fixture version และสถานะที่ตั้ง provider |
| `POST /api/intent` | `text`, `useModel?` | draft ให้ยืนยัน |
| `POST /api/plan` | `request` มี from/to/time/mode และ constraints, `useModel?` | ผล Worker, decision, ไทย template และ trace |
| `POST /api/departure` | `request`, `times` 2–6 ค่า HH:mm | ETA, นาทีแดดและข้อจำกัดของแต่ละเวลา |
| `POST /api/companion` | `event`, `route`, `warnings?`, `handled?`, `useModel?` | action และ state คำเตือนถัดไป |
| `POST /api/steward` | `segmentId`, `timeBand`, `observations`, `useModel?` | proposal รอคนตรวจ |
| `POST /api/news` | `text`, `sourceUrl`, `useModel?` | ร่างข้อมูลข่าว |
| `POST /api/voice/session` | `consent: true` | signed WebSocket URL เมื่อ provider ตั้งพร้อม |

```sh
curl -sS http://127.0.0.1:4178/api/plan -H 'Content-Type: application/json' \
  -d '{"request":{"from":"siam","to":"central","mode":"night","time":"21:00"}}'
```

ถ้าเรียก fixture นี้ ทางสั้น 640 ม. มีช่วงข้อมูลไฟที่ขาด 180 ม. และ stress test ออก `VERIFY` มีอีกทาง 766 ม. ที่ fixture ให้ข้อมูลไฟครบ ตัวเลขเป็นชุดทดสอบ

เพิ่มค่า `WALKWE_OPENAI_API_KEY` ใน environment ฝั่ง Node เพื่อใช้ Responses API เฉพาะ request ที่มี `useModel: true` ส่วน signed voice URL ใช้ `WALKWE_ELEVENLABS_API_KEY` และ `WALKWE_ELEVENLABS_AGENT_ID` เก็บค่าเหล่านี้ใน secret store ของ backend

ชุดประเมินใช้ harness เดียวกับ workflow รับ `--live` ต่อเมื่อจงใจรันกับ API จริง โดยเลือก `WALKWE_OPENAI_EVAL_API_KEY` ก่อน หรือใช้ `WALKWE_OPENAI_API_KEY` ที่ตั้งไว้ โปรแกรมคืน exit 2 และบันทึกว่า live ถูกข้ามถ้าขอรันแบบ live แต่หา key ไม่เจอ ดูชุดเคส ผล และข้อจำกัดใน [evaluate.md](evaluate.md)

## MCP สำหรับ Codex และ Claude

`npm run mcp` เปิด stdio server มี `get_segment_evidence`, `replay_demo_trip`, `compare_departure_times` ใช้ `dataset_version: "siam-sandbox-1"` สำหรับทุก tool ตัวอย่าง Claude Code จาก root ของ repo ใช้

```json
{"mcpServers":{"walkwe-evidence":{"command":"node","args":["packages/walkwe-agentic/src/integrations/mcp.mjs"]}}}
```

สำหรับ Codex ตั้ง `command = "node"` และ `args` ชี้ absolute path ของ `src/integrations/mcp.mjs` ภายใต้ชื่อ server `walkwe-evidence` ตัว server อ่าน fixture และไม่มีเครื่องมือส่งหรืออนุมัติ

## จุดเสียบกับแอปจริง

- ส่ง gazetteer, Worker adapter และ snapshot เข้า `createWorkflows` ให้ mapper รองรับระยะและสถานะแสงรายช่วงตามสัญญาเดียวกัน คง legacy proxy DTO จนกว่าจะ migrate ทั้งสองฝั่ง
- ต่อ reviewer identity และ storage ที่ทำ atomic publish/audit เข้ากับ `reviewProposal` ใช้ผู้ใช้ที่ backend ยืนยันแล้วก่อนเขียน evidence
- ต่อ ElevenLabs SDK กับ [`createVoiceClientTools`](src/integrations/voice-client.mjs) และวาง `getSignedVoiceUrl` หลัง session auth ให้แอปส่ง callbacks, ทริปที่กำลังใช้งาน และช่วงถนนของคำถามที่แอปเปิดไว้
- ต่อ SOS กับ server outbox และ verified recipients หลังซ้อมผ่าน ทดสอบ cancel, stale location, duplicate, delivery unknown/ACK ใน staging ก่อนเปิดการส่งจริง
- ผูก [`createAgentStepHandler`](src/workers/agent-step.mjs) หลังระบบยืนยัน session ของแอป พร้อม rate limit และตรวจ replay ดู [สัญญา Worker และ env ที่ใช้ในเครื่อง](../../docs/ARCHITECTURE.md#local-worker-contract)

สถานะ workflow อยู่ใน [WORKFLOWS.md](WORKFLOWS.md)
