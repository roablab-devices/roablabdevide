const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const express = require("express");
const { Zalo, ThreadType, LoginQRCallbackEventType } = require("zca-js");

const COOKIE_PATH = path.join(__dirname, "cookies.json");
const PORT = process.env.PORT || 3000;
// ID nhóm Zalo mặc định nhận thông báo QA
const DEFAULT_GROUP_ID = "3454929219339921562";

// Khởi tạo Express Server để nhận lệnh gửi tin từ Google Apps Script / Tool
const app = express();
app.use(express.json());

let zaloApi = null;

// Hàm mở ảnh QR tự động trên cả Windows và Ubuntu
function openImage(filePath) {
  const platform = process.platform;
  if (platform === "win32") {
    exec(`start "" "${filePath}"`);
  } else if (platform === "linux") {
    exec(`xdg-open "${filePath}" 2>/dev/null || display "${filePath}" 2>/dev/null`);
  } else if (platform === "darwin") {
    exec(`open "${filePath}"`);
  }
}

// Khởi tạo Zalo Client
const zalo = new Zalo({
  selfListen: false,
  checkUpdate: true,
  logging: false,
});

async function startBot() {
  console.log("==================================================");
  console.log("🤖 ROAB LAB - ZALO BOT THÔNG BÁO QA (Dual-Boot)");
  console.log("==================================================");

  // 1. Thử đăng nhập bằng cookie đã lưu trước đó
  if (fs.existsSync(COOKIE_PATH)) {
    try {
      console.log("🔍 Đã tìm thấy session lưu trữ (cookies.json). Đang đăng nhập...");
      const credentials = JSON.parse(fs.readFileSync(COOKIE_PATH, "utf8"));
      zaloApi = await zalo.login(credentials);
      console.log(`✅ Đăng nhập thành công với ID tài khoản: ${zaloApi.getOwnId()}`);
      setupBotFeatures();
      return;
    } catch (err) {
      console.warn("⚠️ Phiên đăng nhập cũ đã hết hạn. Đang tạo mã QR mới để quét...");
    }
  }

  // 2. Nếu chưa có cookie hoặc cookie hết hạn -> Đăng nhập bằng mã QR
  try {
    console.log("📲 Đang khởi tạo mã QR đăng nhập...");
    const qrFilePath = path.join(__dirname, "qr.png");

    zaloApi = await zalo.loginQR(
      { qrPath: qrFilePath },
      (event) => {
        if (event.type === LoginQRCallbackEventType.QRCodeGenerated) {
          event.actions.saveToFile(qrFilePath);
          console.log("\n=======================================================");
          console.log(`📸 ĐÃ TẠO MÃ QR TẠI: ${qrFilePath}`);
          console.log("👉 Vui lòng mở ảnh 'qr.png' và dùng nick Zalo phụ để quét!");
          console.log("=======================================================\n");
          openImage(qrFilePath);
        } else if (event.type === LoginQRCallbackEventType.QRCodeScanned) {
          console.log("👁️ Đã quét mã QR! Vui lòng bấm [Xác nhận đăng nhập] trên điện thoại...");
        } else if (event.type === LoginQRCallbackEventType.GotLoginInfo) {
          console.log("💾 Đang lưu phiên đăng nhập vào cookies.json...");
          fs.writeFileSync(COOKIE_PATH, JSON.stringify(event.data, null, 2), "utf8");
        } else if (event.type === LoginQRCallbackEventType.QRCodeExpired) {
          console.log("⌛ Mã QR đã hết hạn. Đang thử lại...");
          if (event.actions && event.actions.retry) event.actions.retry();
        }
      }
    );

    console.log(`✅ Đăng nhập QR thành công! ID: ${zaloApi.getOwnId()}`);
    setupBotFeatures();
  } catch (error) {
    console.error("❌ Đăng nhập thất bại:", error);
  }
}

function setupBotFeatures() {
  // Lắng nghe sự kiện tin nhắn
  zaloApi.listener.start();
  console.log("👂 Bot đã bắt đầu lắng nghe tin nhắn...");

  // Hỗ trợ tìm ID: Mỗi khi có ai nhắn tin (cá nhân hoặc trong nhóm), in ra Thread ID
  zaloApi.listener.on("message", (msg) => {
    const isGroup = msg.type === ThreadType.Group;
    console.log(`\n📩 [TIN NHẮN ĐẾN] Loại: ${isGroup ? "Nhóm" : "Cá nhân"}`);
    console.log(`- ID để gửi tin (groupId): ${msg.threadId}`);
    console.log(`- Người gửi: ${msg.data ? msg.data.uidFrom : "N/A"}`);
    console.log(`- Nội dung: ${msg.data && msg.data.content ? msg.data.content : ""}`);
    if (isGroup) {
      console.log(`(👉 Copy "groupId: ${msg.threadId}" để cấu hình thông báo QA)\n`);
    }
  });

  // Khởi động API Server để Google Apps Script gọi tới
  app.listen(PORT, () => {
    console.log(`🚀 API Server đang chạy tại: http://localhost:${PORT}`);
    console.log(`- Kiểm tra trạng thái: GET  http://localhost:${PORT}/status`);
    console.log(`- Bắn thông báo QA:   POST http://localhost:${PORT}/notify-qa`);
    console.log(`- Gửi tin nhắn tự do: POST http://localhost:${PORT}/send-message`);
  });
}

// 1. Endpoint kiểm tra trạng thái bot
app.get("/status", (req, res) => {
  res.json({
    online: !!zaloApi,
    ownId: zaloApi ? zaloApi.getOwnId() : null,
  });
});

// 2. Endpoint thông báo số lượt cần QA phê duyệt (gọn gàng, đơn giản)
app.post("/notify-qa", async (req, res) => {
  try {
    if (!zaloApi) {
      return res.status(503).json({ success: false, error: "Bot Zalo chưa đăng nhập!" });
    }

    const targetGroupId = req.body.groupId || DEFAULT_GROUP_ID;
    const { count, message } = req.body;

    if (!targetGroupId) {
      return res.status(400).json({ success: false, error: "Thiếu groupId nhóm Zalo!" });
    }

    let text = "";
    if (message) {
      text = message;
    } else {
      const soLuot = count || 1;
      text = `🔔 Có ${soLuot} lượt cần kiểm định phê duyệt mới. Nhờ các bạn QA vào check nhé!`;
    }

    const result = await zaloApi.sendMessage(text, String(targetGroupId), ThreadType.Group);
    console.log(`📤 Đã gửi thông báo vào nhóm [${targetGroupId}]: ${text}`);
    res.json({ success: true, result });
  } catch (error) {
    console.error("Lỗi gửi thông báo QA:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Endpoint gửi tin nhắn chung
app.post("/send-message", async (req, res) => {
  try {
    if (!zaloApi) {
      return res.status(503).json({ success: false, error: "Bot Zalo chưa đăng nhập!" });
    }

    const { groupId, message } = req.body;
    if (!groupId || !message) {
      return res.status(400).json({ success: false, error: "Thiếu groupId hoặc message!" });
    }

    const result = await zaloApi.sendMessage(message, String(groupId), ThreadType.Group);
    res.json({ success: true, result });
  } catch (error) {
    console.error("Lỗi gửi tin nhắn:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Chạy bot
startBot();
