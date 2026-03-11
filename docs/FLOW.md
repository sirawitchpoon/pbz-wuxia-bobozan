# 武侠波波攒 — Flow การทำงาน

## 1. โฟลว์หลัก (ภาพรวม) — 8 ช่อง + ช่องดวลชั่วคราว

```mermaid
flowchart TB
    subgraph hub [Channel 1: Hub]
        A[ผู้ใช้เปิดแชนแนล] --> B[เห็นปุ่มถาวร]
        B --> C{เลือกทำอะไร?}
    end

    C --> D[⚔️ ท้าเปิด]
    C --> E[🎯 ท้าเจาะจง]

    D --> H[โพสต์การ์ดคำท้าใน Channel 2]
    H --> I[ใครก็ได้ไป Channel 2 กด รับคำท้า]
    I --> J[สร้างช่องชั่วคราว #duel-A-vs-B]
    J --> K[เลือกอาชีพในช่องชั่วคราว]
    K --> L[เริ่มดวลในช่องชั่วคราว]

    E --> M[เลือกคู่ต่อสู้จาก User Select]
    M --> N[โพสต์การ์ดคำท้าใน Channel 2 + mention คู่ต่อสู้]
    N --> O[คู่ต่อสู้ไป Channel 2 กด รับ หรือ ปฏิเสธ]
    O --> P[รับ → สร้างช่องชั่วคราว → เลือกอาชีพ → เริ่มดวล]

    subgraph info [Channels 4–8: อ่านอย่างเดียว]
        Q[Channel 4: Leaderboard]
        R[Channel 5: Ranks]
        S[Channel 6: Rules]
        T[Channel 7: Honor]
        U[Channel 8: ปุ่ม My Stats]
    end
```

- **Channel 2:** การ์ดคำท้าทั้งแบบเปิดและแบบเจาะจง โพสต์ที่นี่ หมดเวลาตาม `BOBOZAN_CHALLENGE_EXPIRE_SECONDS` (default 180 วินาที)
- **Channel 3:** หลังจบแมตช์ บอตโพสต์สรุป (ใครชนะ/เสมอ กี่รอบ)
- **ช่องชั่วคราว:** เห็นได้เฉพาะผู้เล่น 2 คน + แอดมิน (ถ้ามี) หลังจบแมตช์ลบอัตโนมัติหลังหน่วง `BOBOZAN_TEMP_CHANNEL_DELETE_DELAY_MS`

## 2. ท้าเปิด (Open Challenge)

```mermaid
sequenceDiagram
    participant U as ผู้ท้า
    participant B as บอท
    participant Ch2 as Channel 2 (การ์ดคำท้า)
    participant Temp as ช่องชั่วคราว
    participant O as ผู้รับคำท้า

    U->>B: กดปุ่ม ⚔️ ท้าเปิด (ใน Hub)
    B->>U: Ephemeral "Challenge posted in #challenge-cards"
    B->>Ch2: โพสต์ Embed + ปุ่ม "รับคำท้า"
    Note over Ch2: หมดเวลาตาม BOBOZAN_CHALLENGE_EXPIRE_SECONDS (default 180s)

    O->>B: กด รับคำท้า (ใน Channel 2)
    B->>B: ตรวจสอบ O ≠ ผู้ท้า, ไม่มีเกมอยู่
    B->>B: สร้างช่องชั่วคราว #duel-{A}-vs-{B}
    B->>Ch2: แก้ Embed เป็น "คำท้าถูกรับ — Duel in #temp"
    B->>Temp: ส่ง Job Select (Dropdown)
    B->>U: รอเลือกอาชีพ (ephemeral)
    B->>O: รอเลือกอาชีพ (ephemeral)

    Note over U,O: ทั้งคู่เลือกแล้ว
    B->>Temp: เริ่ม Battle Embed + ปุ่มท่า
    B->>Temp: ส่งข้อความ "Round N — Choose your action!" ทุกรอบ
    B->>B: เริ่มรอบที่ 1 + ตั้งเวลา ROUND_TIMEOUT_SECONDS
```

## 3. ท้าเจาะจง (Targeted Challenge)

```mermaid
sequenceDiagram
    participant U as ผู้ท้า
    participant B as บอท
    participant Ch2 as Channel 2
    participant Temp as ช่องชั่วคราว
    participant T as คู่ต่อสู้ที่เลือก

    U->>B: กดปุ่ม 🎯 ท้าเจาะจง (ใน Hub)
    B->>U: แสดง User Select Menu (ephemeral)
    U->>B: เลือกผู้เล่น T
    B->>B: ตรวจสอบ T ไม่ใช่บอท/ตัวเอง/อยู่ในเกม
    B->>Ch2: โพสต์ Embed + mention T + ปุ่ม รับ / ปฏิเสธ
    U->>U: ได้ข้อความ "ส่งคำท้าไปแล้ว" (ephemeral)

    alt T กด รับ (ใน Channel 2)
        T->>B: กด รับ
        B->>B: สร้างช่องชั่วคราว
        B->>Ch2: แก้เป็น "คำท้าถูกรับ — Duel in #temp"
        B->>Temp: ส่ง Job Select → เริ่มดวล
    else T กด ปฏิเสธ หรือ หมดเวลา
        B->>Ch2: แก้ Embed เป็น ปฏิเสธ/หมดเวลา
    end
```

---

## 4. รอบดวล (Battle Round)

```mermaid
flowchart LR
    subgraph round [หนึ่งรอบ]
        A[แสดง Battle Embed\n+ ปุ่มท่า] --> B[ผู้เล่น A กดท่า\nephemeral]
        B --> C[ผู้เล่น B กดท่า\nephemeral]
        C --> D[ทั้งคู่ล็อกแล้ว]
        D --> E[resolveRound\n4-level pipeline]
        E --> F{มีคนตาย?}
        F -->|ไม่| G[Tick effects\nอัปเดต Embed\nเริ่มรอบถัดไป]
        G --> A
        F -->|ใช่| H[Settlement]
    end
```

---

## 5. Combat Resolution (4-Level Pipeline)

```mermaid
flowchart TD
    Start[resolveRound] --> L1

    subgraph L1 [Level 1: Pre-Check]
        L1a[ตรวจ 盘根/禁招] --> L1b[กับดัก Engineer]
        L1b --> L1c[Blood Fury Bladesman]
        L1c --> L1d[Sword Intent Swordsman]
        L1d --> L1e[ตั้งกับดัก ถ้าต้องการ]
    end

    L1 --> L2
    subgraph L2 [Level 2: Buffs/Ultimates]
        L2a[รัน Ultimates\nใช้พลัง ตั้ง flag]
    end

    L2 --> L3
    subgraph L3 [Level 3: Actions]
        L3a[Charge → +พลัง] --> L3b[โจมตี/ป้องกัน\nClash / First Strike]
    end

    L3 --> L4
    subgraph L4 [Level 4: Post-Check]
        L4a[Passive หลังป้องกัน] --> L4b[连弩 ล่าช้า]
        L4b --> L4c[เช็คตาย]
        L4c --> L4d[Tick effects\nรีเซ็ตท่า]
    end

    L4 --> End[ส่งกลับ RoundLog]
```

---

## 6. Post-Match Settlement

```mermaid
flowchart TB
    End[จบเกม\nHP=0 / Forfeit / Timeout] --> Build[สร้าง BattleResult DTO]
    Build --> Honor[HonorCalculator.calculate\npure function]
    Honor --> Ladder[LadderService\nElo + อัปเดต MongoDB]
    Ladder --> API[HonorPointsApiClient.add\nPOST x2 ไป honor-points-api]
    API --> Logger[BotsLoggerClient.logAction\nPOST x2 ไป discord-bots-logger]
    Logger --> History[MatchHistory.create\nMongoDB]
    History --> Embed[อัปเดต Battle Embed ในช่องชั่วคราว\nแสดง Honor + Rating]
    Embed --> Ch3[โพสต์สรุปใน Channel 3\nMatch History]
    Ch3 --> LB[อัปเดตข้อความ Leaderboard ใน Channel 4]
    LB --> Clean[SessionManager.removeSession\nลบช่องชั่วคราวหลังหน่วง]
```

---

## 7. การเชื่อมต่อกับระบบอื่น

```mermaid
flowchart LR
    subgraph BoboZan [wuxia-bobozan]
        Bot[Discord Bot]
        Engine[Engine + LadderService]
    end

    subgraph External [บริการภายนอก]
        API[honor-points-api:3001]
        Logger[discord-bots-logger:3002]
        MongoDB[(MongoDB\nhonorbot)]
    end

    Bot --> Engine
    Engine --> API
    Engine --> Logger
    Engine --> MongoDB

    API --> MongoDB
    Logger --> MongoDB

    Note1[Honor: บอทเรียก API เท่านั้น\nไม่เขียน users ตรง]
    Note2[Ladder + MatchHistory:\nบอทเขียน MongoDB ตรง]
```

---

## 8. Data Flow สรุป

| ขั้นตอน | ข้อมูล | ปลายทาง |
|--------|--------|---------|
| จบเกม | BattleResult | ในหน่วยความจำ |
| คำนวณ Honor | HonorBreakdown A/B | Pure function |
| อัปเดต Ladder | rating, wins, losses, streak, honorTotal | MongoDB `bobozan_ladder_profiles` |
| เพิ่ม Honor กลาง | amount ต่อ user | POST → honor-points-api → MongoDB `users` |
| ส่ง Log | botId, category, action, userId, details | POST → discord-bots-logger → MongoDB `action_logs` |
| บันทึกประวัติ | match metadata | MongoDB `bobozan_match_history` |
