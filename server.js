const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();
app.use(cors());
app.use(express.json());

const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!rawServiceAccount) {
  console.error("FIREBASE_SERVICE_ACCOUNT_JSON 환경변수가 없습니다.");
  process.exit(1);
}

const serviceAccount = JSON.parse(rawServiceAccount);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://chat-f04e4-default-rtdb.firebaseio.com"
});

const db = admin.database();
const messaging = admin.messaging();

app.get("/", (req, res) => {
  res.status(200).send("OK");
});

app.post("/send-call", async (req, res) => {
  try {
    const {
      roomId,
      roomName = "채팅방",
      callerName = "누군가",
      callerDeviceId = "",
      targetDeviceIds = [],
      targetTokens = []
    } = req.body || {};

    let tokens = Array.isArray(targetTokens) ? [...targetTokens] : [];

    if (tokens.length === 0 && roomId) {
      const membersSnap = await db.ref(`kakao_chat_app/room_members/${roomId}`).once("value");
      const members = membersSnap.val() || {};

      const deviceIds = Object.entries(members)
        .map(([key, val]) => (val && typeof val === "object" && val.deviceId ? val.deviceId : key))
        .filter((id) => id && id !== callerDeviceId);

      const idsToLookup = deviceIds.length > 0 ? deviceIds : targetDeviceIds;

      for (const devId of idsToLookup) {
        const userSnap = await db.ref(`kakao_chat_app/users/${devId}`).once("value");
        const userVal = userSnap.val();
        if (userVal && userVal.fcmToken) {
          tokens.push(userVal.fcmToken);
        }
      }
    }

    tokens = [...new Set(tokens.filter(Boolean))];

    if (tokens.length === 0) {
      return res.status(200).json({ ok: false, message: "수신할 FCM 토큰이 없습니다." });
    }

    const title = "채팅방 호출";
    const body = `[${roomName}] ${callerName}님이 채팅방 호출을 보냈습니다.`;

    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title,
        body
      },
      data: {
        title,
        body,
        roomId: String(roomId || ""),
        roomName: String(roomName || ""),
        callerName: String(callerName || "")
      },
      android: {
        priority: "high",
        notification: {
          channelId: "ssapssaotalk_push",
          sound: "default"
        }
      }
    });

    return res.status(200).json({
      ok: true,
      successCount: response.successCount,
      failureCount: response.failureCount
    });
  } catch (error) {
    console.error("푸시 발송 오류:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Push server running on port ${PORT}`);
});
