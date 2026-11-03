/**
 * ======================================================================================
 * ROAB LAB - SMART LAB ASSET MANAGER (GOOGLE APPS SCRIPT BACKEND)
 * Hỗ trợ:
 * 1. Quản Trị Viên (Thêm, Bớt/Xóa thiết bị, Sửa thông số & tài liệu, Log chỉnh sửa)
 * 2. Cán Bộ Kiểm Định (QA Audit đối soát ảnh song song & phê duyệt/báo vi phạm)
 * 3. Sinh Viên (Zero-Password Whitelist, Chụp ảnh trải phẳng linh kiện nén Drive)
 * ======================================================================================
 */

const CONFIG = {
  FOLDER_ID: "1TBtzA8MVXcOU_eIVXQvy8Rg0wC0apoJv",
  TELEGRAM_BOT_TOKEN: "YOUR_TELEGRAM_BOT_TOKEN_HERE",
  TELEGRAM_CHAT_ID: "-1001234567890",
  SHEET_DEVICES: "Devices",
  SHEET_USERS: "Users",
  SHEET_LOGS: "Logs"
};

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// Only application-generated formulas may use setFormula; all other cells are text.
function sheetText(value) {
  const text = String(value == null ? "" : value);
  return /^[\s\u0000-\u001f]*[=+@-]/.test(text) || text.startsWith("'") ? "'" + text : text;
}

function setText(range, value) {
  range.setValue(sheetText(value));
}

function appendTextRow(sheet, values) {
  sheet.appendRow(values.map(sheetText));
}

/**
 * ======================================================================================
 * 1. doGet(e): Trả về Devices, Whitelist, Hàng đợi Kiểm định QA và Nhật ký Chỉnh sửa Admin
 * ======================================================================================
 */
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 1. Lấy danh sách Devices
    const devSheet = ss.getSheetByName(CONFIG.SHEET_DEVICES);
    if (!devSheet) return createJsonResponse({ success: false, message: "Sheet Devices không tồn tại!" });
    
    const devValues = devSheet.getDataRange().getValues();
    
    // 2. Lấy Logs và phân loại (Giao dịch sinh viên & Nhật ký chỉnh sửa của Admin)
    const logSheet = ss.getSheetByName(CONFIG.SHEET_LOGS);
    const logsByDevice = {};
    const auditQueue = [];
    const editLogs = [];
    
    if (logSheet && logSheet.getLastRow() > 1) {
      const logValues = logSheet.getDataRange().getValues();
      for (let i = logValues.length - 1; i >= 1; i--) {
        const row = logValues[i];
        const rawDeviceIds = String(row[4] || "");
        const deviceIds = rawDeviceIds.split(",").map(s => s.trim());
        const actionType = String(row[3] || "");
        
        const logItem = {
          timestamp: row[0] instanceof Date ? Utilities.formatDate(row[0], "GMT+7", "yyyy-MM-dd HH:mm:ss") : String(row[0]),
          tx_id: String(row[1] || ""),
          user_name: String(row[2] || ""),
          action: actionType,
          device_ids: rawDeviceIds,
          project_tag: String(row[5] || ""),
          checked_accessories: String(row[6] || ""),
          return_condition: String(row[7] || ""),
          note: String(row[8] || ""),
          photo_url: String(row[9] || ""),
          audit_status: String(row[11] || "Chờ kiểm định"),
          audited_by: String(row[12] || ""),
          audit_note: String(row[13] || "")
        };
        
        // Nếu là log thao tác của Admin
        if (actionType.indexOf("[Admin]") !== -1) {
          if (editLogs.length < 50) editLogs.push(logItem);
        } else {
          // Là giao dịch sinh viên bàn giao cần kiểm định
          if (auditQueue.length < 50) auditQueue.push(logItem);
          
          deviceIds.forEach(id => {
            if (!id) return;
            if (!logsByDevice[id]) logsByDevice[id] = [];
            if (logsByDevice[id].length < 3) logsByDevice[id].push(logItem);
          });
        }
      }
    }
    
    const devices = [];
    for (let i = 1; i < devValues.length; i++) {
      const row = devValues[i];
      const deviceId = String(row[0] || "").trim();
      if (!deviceId) continue;
      
      devices.push({
        device_id: deviceId,
        name: String(row[1] || ""),
        category: String(row[2] || "Khác"),
        location: String(row[3] || ""),
        accessories: String(row[4] || ""),
        golden_image: String(row[5] || ""),
        specs_note: String(row[6] || ""),
        pinout_link: String(row[7] || ""),
        status: String(row[8] || "Trong kho"),
        holder_id: String(row[9] || ""),
        holder_name: String(row[10] || ""),
        project_tag: String(row[11] || ""),
        updated_at: row[12] instanceof Date ? Utilities.formatDate(row[12], "GMT+7", "yyyy-MM-dd HH:mm:ss") : String(row[12] || ""),
        recent_logs: logsByDevice[deviceId] || []
      });
    }

    // 3. Lấy Whitelist Sinh viên (Bảo mật: Không bao gồm mã PIN)
    const userSheet = ss.getSheetByName(CONFIG.SHEET_USERS);
    const whitelist = [];
    if (userSheet && userSheet.getLastRow() > 1) {
      const userValues = userSheet.getDataRange().getValues();
      for (let i = 1; i < userValues.length; i++) {
        const uId = String(userValues[i][0] || "").trim();
        if (!uId) continue;
        whitelist.push({
          user_id: uId,
          full_name: String(userValues[i][2] || ""),
          phone: String(userValues[i][3] || ""),
          // Users column F: Khóa (e.g. K68, K69). Keep A-E unchanged.
          cohort: String(userValues[i][5] || "").trim(),
          role: String(userValues[i][4] || "STUDENT").toUpperCase()
        });
      }
    }
    
    return createJsonResponse({
      success: true,
      timestamp: Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss"),
      devices: devices,
      whitelist: whitelist,
      audit_queue: auditQueue,
      edit_logs: editLogs
    });
    
  } catch (error) {
    return createJsonResponse({ success: false, message: "Lỗi doGet: " + error.toString() });
  }
}

/**
 * ======================================================================================
 * 2. doPost(e): Xử lý Login, Thêm/Sửa/Xóa Thiết bị, Kiểm định ảnh, Giao dịch
 * ======================================================================================
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return createJsonResponse({ success: false, message: "Hệ thống bận, vui lòng thử lại sau vài giây." });
  }
  
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ success: false, message: "Dữ liệu yêu cầu rỗng." });
    }
    
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === "admin_change_password") {
      const sheet = ss.getSheetByName(CONFIG.SHEET_USERS);
      if (!sheet) return createJsonResponse({ success: false, message: "Sheet Users không tồn tại!" });
      const adminId = String(payload.admin_id || "").trim().toLowerCase();
      const adminPin = String(payload.admin_pin || "").trim();
      const targetId = String(payload.target_id || "").trim().toLowerCase();
      const newPin = typeof payload.new_pin === "string" ? payload.new_pin : "";
      if (!adminId || !adminPin || !targetId || newPin.length < 8 || newPin.length > 128 || newPin !== newPin.trim() || /[\r\n\u0000]/.test(newPin)) {
        return createJsonResponse({ success: false, message: "Nhập đủ thông tin. Mật khẩu mới cần 8–128 ký tự, không có khoảng trắng ở đầu/cuối." });
      }
      const cache = CacheService.getScriptCache();
      const key = "password_change_attempts_" + encodeURIComponent(adminId).slice(0, 180);
      const attempts = Number(cache.get(key) || 0);
      if (attempts >= 5) return createJsonResponse({ success: false, message: "Đã thử quá nhiều lần. Vui lòng thử lại sau 15 phút." });
      const rows = sheet.getDataRange().getValues();
      const admins = rows.slice(1).filter(row => String(row[0] || "").trim().toLowerCase() === adminId);
      if (admins.length !== 1 || String(admins[0][4] || "").toUpperCase() !== "ADMIN" || String(admins[0][1] || "").trim() !== adminPin) {
        cache.put(key, String(attempts + 1), 900);
        return createJsonResponse({ success: false, message: "Không xác nhận được tài khoản Admin hoặc mật khẩu hiện tại." });
      }
      const targets = [];
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0] || "").trim().toLowerCase() === targetId) targets.push(i + 1);
      }
      if (targets.length !== 1) return createJsonResponse({ success: false, message: "Không tìm thấy tài khoản duy nhất cần đổi mật khẩu." });
      setText(sheet.getRange(targets[0], 2), newPin);
      cache.remove(key);
      return createJsonResponse({ success: true, message: "Đã đổi mật khẩu tài khoản. Lần đăng nhập tiếp theo cần dùng mật khẩu mới." });
    }

    // -------------------------------------------------------------
    // LUỒNG 1: ĐĂNG NHẬP CÁN BỘ (ADMIN & CÁN BỘ KIỂM ĐỊNH INSPECTOR)
    // -------------------------------------------------------------
    if (action === "admin_login") {
      const userSheet = ss.getSheetByName(CONFIG.SHEET_USERS);
      if (!userSheet) return createJsonResponse({ success: false, message: "Sheet Users không tồn tại!" });
      
      const inputId = String(payload.user_id || "").trim();
      const inputPin = String(payload.pin || "").trim();
      const userRows = userSheet.getDataRange().getValues();
      
      let matchedStaff = null;
      for (let i = 1; i < userRows.length; i++) {
        const rowId = String(userRows[i][0] || "").trim();
        const rowPin = String(userRows[i][1] || "").trim();
        const rowRole = String(userRows[i][4] || "STUDENT").toUpperCase();
        
        if ((rowRole === "ADMIN" || rowRole === "INSPECTOR") && rowId.toLowerCase() === inputId.toLowerCase() && rowPin === inputPin) {
          matchedStaff = {
            user_id: rowId,
            full_name: String(userRows[i][2] || "Cán bộ Lab"),
            phone: String(userRows[i][3] || ""),
            role: rowRole
          };
          break;
        }
      }
      
      if (matchedStaff) {
        return createJsonResponse({ success: true, user: matchedStaff, message: `Chào mừng ${matchedStaff.full_name} (${matchedStaff.role})!` });
      } else {
        return createJsonResponse({ success: false, message: "Sai tài khoản Quản trị/Kiểm định hoặc mã PIN!" });
      }
    }

    // -------------------------------------------------------------
    // LUỒNG 2: THÊM MỚI HOẶC CHỈNH SỬA THIẾT BỊ (KÈM GHI NHẬN EDIT LOG)
    // -------------------------------------------------------------
    if (action === "admin_save_device") {
      const devSheet = ss.getSheetByName(CONFIG.SHEET_DEVICES);
      if (!devSheet) return createJsonResponse({ success: false, message: "Sheet Devices không tồn tại!" });
      
      const devId = String(payload.device_id || "").trim();
      const adminName = String(payload.admin_name || "Admin Lab").trim();
      if (!devId) return createJsonResponse({ success: false, message: "Mã thiết bị không được để trống!" });
      
      const devValues = devSheet.getDataRange().getValues();
      const nowStr = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");
      
      let foundRow = -1;
      for (let r = 1; r < devValues.length; r++) {
        if (String(devValues[r][0] || "").trim().toLowerCase() === devId.toLowerCase()) {
          foundRow = r + 1;
          break;
        }
      }

      const logSheet = ss.getSheetByName(CONFIG.SHEET_LOGS);

      if (foundRow > 0) {
        // CẬP NHẬT THIẾT BỊ HIỆN CÓ
        setText(devSheet.getRange(foundRow, 2), payload.name || "");
        setText(devSheet.getRange(foundRow, 3), payload.category || "Khác");
        setText(devSheet.getRange(foundRow, 4), payload.location || "");
        setText(devSheet.getRange(foundRow, 5), payload.accessories || "");
        setText(devSheet.getRange(foundRow, 6), payload.golden_image || "");
        setText(devSheet.getRange(foundRow, 7), payload.specs_note || "");
        setText(devSheet.getRange(foundRow, 8), payload.pinout_link || "");
        setText(devSheet.getRange(foundRow, 13), nowStr);

        // Ghi log chỉnh sửa
        if (logSheet) {
          appendTextRow(logSheet, [
            nowStr,
            "ADMIN-" + Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd-HHmmss"),
            adminName,
            "[Admin] Sửa thiết bị",
            devId,
            "",
            payload.accessories || "",
            "",
            `Cập nhật thông số/tài liệu cho: ${payload.name}`,
            payload.golden_image || "",
            "",
            "Đã ghi nhận",
            adminName,
            "Sửa thiết bị"
          ]);
        }

        return createJsonResponse({ success: true, message: `Đã cập nhật thông số & tài liệu cho [${devId}] thành công!` });
      } else {
        // THÊM THIẾT BỊ MỚI
        appendTextRow(devSheet, [
          devId,
          payload.name || "",
          payload.category || "Khác",
          payload.location || "Chưa xác định",
          payload.accessories || "",
          payload.golden_image || "",
          payload.specs_note || "",
          payload.pinout_link || "",
          "Trong kho",
          "",
          "",
          "",
          nowStr
        ]);

        // Ghi log thêm mới
        if (logSheet) {
          appendTextRow(logSheet, [
            nowStr,
            "ADMIN-" + Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd-HHmmss"),
            adminName,
            "[Admin] Thêm thiết bị mới",
            devId,
            "",
            payload.accessories || "",
            "",
            `Thêm mới thiết bị: ${payload.name} (${payload.category})`,
            payload.golden_image || "",
            "",
            "Đã ghi nhận",
            adminName,
            "Thêm thiết bị mới"
          ]);
        }

        return createJsonResponse({ success: true, message: `Đã thêm thiết bị mới [${devId}] vào hệ thống!` });
      }
    }

    // -------------------------------------------------------------
    // LUỒNG 3: BỚT / XÓA THIẾT BỊ KHỎI KHO (KÈM GHI NHẬN EDIT LOG)
    // -------------------------------------------------------------
    if (action === "admin_delete_device") {
      const devSheet = ss.getSheetByName(CONFIG.SHEET_DEVICES);
      if (!devSheet) return createJsonResponse({ success: false, message: "Sheet Devices không tồn tại!" });
      
      const targetId = String(payload.device_id || "").trim();
      const adminName = String(payload.admin_name || "Admin Lab").trim();
      const devValues = devSheet.getDataRange().getValues();
      const nowStr = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");
      
      let deletedRow = -1;
      let deletedName = "";
      for (let r = 1; r < devValues.length; r++) {
        if (String(devValues[r][0] || "").trim().toLowerCase() === targetId.toLowerCase()) {
          deletedRow = r + 1;
          deletedName = String(devValues[r][1] || "");
          break;
        }
      }

      if (deletedRow > 0) {
        devSheet.deleteRow(deletedRow);

        // Ghi log xóa
        const logSheet = ss.getSheetByName(CONFIG.SHEET_LOGS);
        if (logSheet) {
          appendTextRow(logSheet, [
            nowStr,
            "ADMIN-" + Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd-HHmmss"),
            adminName,
            "[Admin] Xóa thiết bị",
            targetId,
            "",
            "",
            "",
            `Đã xóa thiết bị: ${deletedName} khỏi danh mục kho`,
            "",
            "",
            "Đã ghi nhận",
            adminName,
            "Xóa thiết bị"
          ]);
        }

        return createJsonResponse({ success: true, message: `Đã xóa thiết bị [${targetId}] thành công!` });
      } else {
        return createJsonResponse({ success: false, message: `Không tìm thấy thiết bị [${targetId}]!` });
      }
    }

    // -------------------------------------------------------------
    // LUỒNG 4: CÁN BỘ KIỂM ĐỊNH (QA) PHÊ DUYỆT / BÁO CẢNH BÁO ẢNH BÀN GIAO
    // -------------------------------------------------------------
    if (action === "audit_transaction") {
      const logSheet = ss.getSheetByName(CONFIG.SHEET_LOGS);
      if (!logSheet) return createJsonResponse({ success: false, message: "Sheet Logs không tồn tại!" });
      
      const targetTxId = String(payload.tx_id || "").trim();
      const auditStatus = String(payload.audit_status || "Đã duyệt hợp lệ").trim();
      const inspectorName = String(payload.inspector_name || "Cán bộ kiểm định").trim();
      const auditNote = String(payload.audit_note || "").trim();
      const logValues = logSheet.getDataRange().getValues();
      if (!["Đã duyệt hợp lệ", "Báo vi phạm"].includes(auditStatus)) {
        return createJsonResponse({ success: false, message: "Kết luận kiểm định không hợp lệ." });
      }
      
      let updated = false;
      let targetRowData = null;
      for (let r = 1; r < logValues.length; r++) {
        if (String(logValues[r][1] || "").trim() === targetTxId) {
          if (String(logValues[r][11] || "Chờ kiểm định") !== "Chờ kiểm định") {
            return createJsonResponse({ success: false, message: "Giao dịch này đã được kiểm định. Hãy tải lại dữ liệu." });
          }
          // Only the latest return may release a device from the inspection queue.
          if (String(logValues[r][3]) === "Trả về kho") {
            const devSheet = ss.getSheetByName(CONFIG.SHEET_DEVICES);
            if (!devSheet) return createJsonResponse({ success: false, message: "Sheet Devices không tồn tại!" });
            const values = devSheet.getDataRange().getValues();
            const ids = String(logValues[r][4] || "").split(",").map(id => id.trim().toLowerCase()).filter(Boolean);
            if (!ids.length || new Set(ids).size !== ids.length) return createJsonResponse({ success: false, message: "Danh sách thiết bị của giao dịch không hợp lệ." });
            const rowsToUpdate = [];
            for (const id of ids) {
              const matches = values.map((row, index) => ({row, index})).slice(1).filter(entry => String(entry.row[0] || "").trim().toLowerCase() === id);
              const stale = logValues.slice(r + 1).some(row =>
                ["Mượn mới", "Trả về kho", "Nhận bàn giao tay đôi"].includes(String(row[3])) &&
                String(row[4] || "").split(",").some(value => value.trim().toLowerCase() === id));
              if (matches.length !== 1 || stale || matches[0].row[8] !== "Chờ kiểm định" || String(matches[0].row[9] || "").trim()) {
                return createJsonResponse({ success: false, message: "Thiết bị không còn chờ kiểm định cho giao dịch này. Hãy tải lại dữ liệu." });
              }
              rowsToUpdate.push(matches[0].index + 1);
            }
            for (const row of rowsToUpdate) {
              setText(devSheet.getRange(row, 9), auditStatus === "Đã duyệt hợp lệ" ? "Trong kho" : "Báo lỗi/Khóa");
              setText(devSheet.getRange(row, 13), Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss"));
            }
          }
          const rowIndex = r + 1;
          setText(logSheet.getRange(rowIndex, 12), auditStatus);
          setText(logSheet.getRange(rowIndex, 13), inspectorName);
          setText(logSheet.getRange(rowIndex, 14), auditNote);
          updated = true;
          targetRowData = logValues[r];
          break;
        }
      }

      if (updated) {
        // Bắn thông báo Telegram kết quả kiểm định
        try {
          if (CONFIG.TELEGRAM_BOT_TOKEN && CONFIG.TELEGRAM_BOT_TOKEN !== "YOUR_TELEGRAM_BOT_TOKEN_HERE") {
            const isApproved = auditStatus.includes("hợp lệ");
            const icon = isApproved ? "✅" : "🚨 CẢNH BÁO VI PHẠM";
            let msg = `<b>${icon} KẾT QUẢ KIỂM ĐỊNH BÀN GIAO THIẾT BỊ</b>\n\n`;
            msg += `• <b>Mã GD:</b> <code>${targetTxId}</code>\n`;
            msg += `• <b>Người kiểm định:</b> <b>${inspectorName}</b>\n`;
            msg += `• <b>Kết luận:</b> <b>${auditStatus.toUpperCase()}</b>\n`;
            if (targetRowData) {
              msg += `• <b>Người mượn/trả:</b> ${targetRowData[2]}\n`;
              msg += `• <b>Thiết bị:</b> <code>${targetRowData[4]}</code>\n`;
            }
            if (auditNote) {
              msg += `• <b>Chi tiết đánh giá:</b> <i>${auditNote}</i>\n`;
            }
            sendTextMessageFallback(msg);
          }
        } catch (tErr) {}

        return createJsonResponse({ success: true, message: `Giao dịch [${targetTxId}] đã được ghi nhận: ${auditStatus}!` });
      } else {
        return createJsonResponse({ success: false, message: `Không tìm thấy mã giao dịch [${targetTxId}]!` });
      }
    }

    // -------------------------------------------------------------
    // LUỒNG 5: ADMIN MỞ KHÓA THIẾT BỊ BÁO HỎNG (action = "admin_unlock")
    // -------------------------------------------------------------
    if (action === "admin_unlock") {
      const devSheet = ss.getSheetByName(CONFIG.SHEET_DEVICES);
      if (!devSheet) return createJsonResponse({ success: false, message: "Sheet Devices không tồn tại!" });
      
      const targetId = String(payload.device_id || "").trim().toLowerCase();
      const adminName = String(payload.admin_name || "Admin Lab").trim();
      const devRange = devSheet.getDataRange();
      const devValues = devRange.getValues();
      const nowStr = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");
      
      let unlocked = false;
      for (let r = 1; r < devValues.length; r++) {
        if (String(devValues[r][0] || "").trim().toLowerCase() === targetId) {
          if (String(devValues[r][8] || "").trim() !== "Báo lỗi/Khóa" || String(devValues[r][9] || "").trim()) {
            return createJsonResponse({ success: false, message: "Chỉ được mở khóa thiết bị báo hỏng và không có người giữ." });
          }
          const rowIndex = r + 1;
          setText(devSheet.getRange(rowIndex, 9), "Trong kho");
          setText(devSheet.getRange(rowIndex, 10), "");
          setText(devSheet.getRange(rowIndex, 11), "");
          setText(devSheet.getRange(rowIndex, 12), "");
          setText(devSheet.getRange(rowIndex, 13), nowStr);
          unlocked = true;
          break;
        }
      }
      
      if (unlocked) {
        // Ghi log mở khóa
        const logSheet = ss.getSheetByName(CONFIG.SHEET_LOGS);
        if (logSheet) {
          appendTextRow(logSheet, [
            nowStr,
            "ADMIN-" + Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd-HHmmss"),
            adminName,
            "[Admin] Mở khóa thiết bị",
            payload.device_id,
            "",
            "",
            "",
            `Đã kiểm tra và mở khóa thiết bị đưa về TRONG KHO`,
            "",
            "",
            "Đã ghi nhận",
            adminName,
            "Mở khóa"
          ]);
        }
        return createJsonResponse({ success: true, message: `Đã mở khóa thiết bị [${payload.device_id}] về TRONG KHO thành công!` });
      } else {
        return createJsonResponse({ success: false, message: `Không tìm thấy thiết bị [${payload.device_id}]!` });
      }
    }

    // -------------------------------------------------------------
    // LUỒNG 6: GIAO DỊCH BÀN GIAO (Mượn mới, Trả về kho, Nhận tay đôi)
    // -------------------------------------------------------------
    if (action === "transaction") {
      const txType = payload.tx_type;
      const userId = String(payload.user_id || "").trim();
      const userName = String(payload.user_name || "").trim();
      const deviceIds = Array.isArray(payload.device_ids) ? payload.device_ids : [];
      const projectTag = String(payload.project_tag || "").trim();
      const checkedAccessories = String(payload.checked_accessories || "").trim();
      const returnCondition = String(payload.return_condition || "Hoạt động tốt - Đủ đồ").trim();
      const note = String(payload.note || "").trim();
      const photoBase64 = payload.photo_base64;
      
      if (!userId || deviceIds.length === 0) {
        return createJsonResponse({ success: false, message: "Thiếu thông tin người dùng hoặc danh sách thiết bị!" });
      }

      // Validate the whole batch under the script lock, before upload/log/write.
      if (txType !== "Mượn mới" && txType !== "Trả về kho") {
        return createJsonResponse({ success: false, message: "Thao tác không hợp lệ. Bàn giao tay đôi tạm ngừng: người giữ cần trả về kho trước khi người nhận mượn lại." });
      }
      if (txType === "Trả về kho" && !["Hoạt động tốt - Đủ đồ", "Thiếu phụ kiện", "Báo lỗi/Hỏng"].includes(returnCondition)) {
        return createJsonResponse({ success: false, message: "Tình trạng hoàn trả không hợp lệ." });
      }
      const devSheet = ss.getSheetByName(CONFIG.SHEET_DEVICES);
      const logSheet = ss.getSheetByName(CONFIG.SHEET_LOGS);
      if (!devSheet || !logSheet) return createJsonResponse({ success: false, message: "Thiếu Sheet Devices hoặc Logs." });
      const devValues = devSheet.getDataRange().getValues();
      const seen = new Set();
      for (const id of deviceIds) {
        if (typeof id !== "string" || !id.trim() || seen.has(id.trim().toLowerCase())) {
          return createJsonResponse({ success: false, message: "Danh sách thiết bị không hợp lệ hoặc trùng mã." });
        }
        const key = id.trim().toLowerCase();
        seen.add(key);
        const matches = devValues.slice(1).filter(row => String(row[0] || "").trim().toLowerCase() === key);
        if (matches.length !== 1) return createJsonResponse({ success: false, message: `Không tìm thấy mã thiết bị duy nhất: ${id}.` });
        const status = String(matches[0][8] || "").trim();
        const holder = String(matches[0][9] || "").trim();
        if (txType === "Mượn mới" && (status !== "Trong kho" || holder)) {
          return createJsonResponse({ success: false, message: `Thiết bị ${id} không sẵn sàng cho mượn. Hãy tải lại dữ liệu.` });
        }
        if (txType === "Trả về kho" && (status !== "Đang mượn" || holder !== userId)) {
          return createJsonResponse({ success: false, message: `Chỉ người đang giữ thiết bị ${id} mới được trả về kho.` });
        }
      }
      
      const now = new Date();
      const timestampStr = Utilities.formatDate(now, "GMT+7", "yyyy-MM-dd HH:mm:ss");
      const txId = "TX-" + Utilities.formatDate(now, "GMT+7", "yyyyMMdd-HHmmss") + "-" + Math.floor(100 + Math.random() * 900);
      
      let directPhotoUrl = "";
      if (photoBase64 && photoBase64.indexOf("base64,") !== -1) {
        try {
          const base64Data = photoBase64.split("base64,")[1];
          const decodedBytes = Utilities.base64Decode(base64Data);
          const fileName = `${txId}_${deviceIds.join("_")}.jpg`;
          const blob = Utilities.newBlob(decodedBytes, "image/jpeg", fileName);
          
          let folder;
          if (CONFIG.FOLDER_ID && CONFIG.FOLDER_ID !== "YOUR_GOOGLE_DRIVE_FOLDER_ID_HERE") {
            folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
          } else {
            folder = DriveApp.getRootFolder();
          }
          
          const file = folder.createFile(blob);
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          directPhotoUrl = `https://drive.google.com/uc?export=view&id=${file.getId()}`;
        } catch (uploadErr) {
          Logger.log("Lỗi upload Drive: " + uploadErr.toString());
          directPhotoUrl = "LỖI_UPLOAD: " + uploadErr.message;
        }
      }
      
      const nextLogRow = logSheet.getLastRow() + 1;
      const formulaPreview = directPhotoUrl.startsWith("http") ? `=IMAGE(J${nextLogRow})` : "";
      
      appendTextRow(logSheet, [
        timestampStr,
        txId,
        `${userName} (${userId})`,
        txType,
        deviceIds.join(", "),
        projectTag,
        checkedAccessories,
        returnCondition,
        note,
        directPhotoUrl,
        "",
        "Chờ kiểm định",
        "",
        ""
      ]);
      if (formulaPreview) logSheet.getRange(nextLogRow, 11).setFormula(formulaPreview);
      
      deviceIds.forEach(targetId => {
        const cleanTargetId = String(targetId).trim().toLowerCase();
        
        for (let r = 1; r < devValues.length; r++) {
          const currentId = String(devValues[r][0] || "").trim().toLowerCase();
          if (currentId === cleanTargetId) {
            const rowIndex = r + 1;
            
            let newStatus = "";
            let newHolderId = "";
            let newHolderName = "";
            let newProjectTag = "";
            
            if (txType === "Mượn mới" || txType === "Nhận bàn giao tay đôi") {
              newStatus = "Đang mượn";
              newHolderId = userId;
              newHolderName = userName;
              newProjectTag = projectTag || devValues[r][11];
            } else if (txType === "Trả về kho") {
              newStatus = "Chờ kiểm định";
              newHolderId = "";
              newHolderName = "";
              newProjectTag = "";
            }
            
            setText(devSheet.getRange(rowIndex, 9), newStatus);
            setText(devSheet.getRange(rowIndex, 10), newHolderId);
            setText(devSheet.getRange(rowIndex, 11), newHolderName);
            setText(devSheet.getRange(rowIndex, 12), newProjectTag);
            setText(devSheet.getRange(rowIndex, 13), timestampStr);
            break;
          }
        }
      });
      
      // Bắn thông báo Telegram
      try {
        if (CONFIG.TELEGRAM_BOT_TOKEN && CONFIG.TELEGRAM_BOT_TOKEN !== "YOUR_TELEGRAM_BOT_TOKEN_HERE") {
          sendTelegramNotification({
            txId: txId,
            txType: txType,
            userId: userId,
            userName: userName,
            deviceIds: deviceIds.join(", "),
            projectTag: projectTag,
            checkedAccessories: checkedAccessories,
            returnCondition: returnCondition,
            note: note,
            timestampStr: timestampStr,
            photoUrl: directPhotoUrl
          });
        }
      } catch (teleErr) {
        Logger.log("Telegram notification error: " + teleErr.toString());
      }
      
      return createJsonResponse({
        success: true,
        tx_id: txId,
        photo_url: directPhotoUrl,
        message: `Giao dịch [${txType}] cho ${deviceIds.join(", ")} thành công!`
      });
    }
    
    return createJsonResponse({ success: false, message: `Hành động '${action}' không được hỗ trợ!` });
    
  } catch (error) {
    return createJsonResponse({ success: false, message: "Lỗi doPost: " + error.toString() });
  } finally {
    try {
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }
  }
}

function sendTelegramNotification(data) {
  const icon = data.txType === "Mượn mới" ? "📤" : (data.txType === "Trả về kho" ? "📥" : "🤝");
  
  let caption = `<b>${icon} THÔNG BÁO BÀN GIAO THIẾT BỊ LAB</b>\n\n`;
  caption += `• <b>Mã GD:</b> <code>${data.txId}</code>\n`;
  caption += `• <b>Thao tác:</b> <b>${data.txType.toUpperCase()}</b>\n`;
  caption += `• <b>Người thực hiện:</b> ${data.userName} (<code>${data.userId}</code>)\n`;
  caption += `• <b>Thiết bị:</b> <code>${data.deviceIds}</code>\n`;
  
  if (data.projectTag) caption += `• <b>Mục đích/Đề tài:</b> 🏷️ <i>${data.projectTag}</i>\n`;
  if (data.checkedAccessories) caption += `• <b>Phụ kiện đã tích:</b> ✅ ${data.checkedAccessories}\n`;
  
  if (data.txType === "Trả về kho" && data.returnCondition) {
    const condIcon = data.returnCondition.includes("Tốt") ? "🟢" : (data.returnCondition.includes("Thiếu") ? "🟡" : "🔴 CẢNH BÁO");
    caption += `• <b>Tình trạng trả:</b> ${condIcon} <b>${data.returnCondition}</b>\n`;
  }
  
  if (data.note) caption += `• <b>Ghi chú:</b> 💬 <i>${data.note}</i>\n`;
  caption += `• <b>Thời gian:</b> 🕒 ${data.timestampStr}\n`;
  
  if (data.photoUrl && data.photoUrl.startsWith("http")) {
    const photoApiUrl = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendPhoto`;
    const photoPayload = {
      chat_id: CONFIG.TELEGRAM_CHAT_ID,
      photo: data.photoUrl,
      caption: caption,
      parse_mode: "HTML"
    };
    
    const response = UrlFetchApp.fetch(photoApiUrl, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(photoPayload),
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() !== 200) {
      caption += `\n🔗 <a href="${data.photoUrl}">👉 Bấm vào đây để xem ảnh bàn giao</a>`;
      sendTextMessageFallback(caption);
    }
  } else {
    sendTextMessageFallback(caption);
  }
}

function sendTextMessageFallback(text) {
  const msgUrl = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`;
  UrlFetchApp.fetch(msgUrl, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      chat_id: CONFIG.TELEGRAM_CHAT_ID,
      text: text,
      parse_mode: "HTML",
      disable_web_page_preview: false
    }),
    muteHttpExceptions: true
  });
}

/**
 * ======================================================================================
 * 3. initialSetup(): Khởi tạo tự động toàn bộ Sheet & dữ liệu mẫu (Chạy 1 lần duy nhất)
 * ======================================================================================
 */
function initialSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Tạo hoặc cấu hình Sheet Devices
  let devSheet = ss.getSheetByName(CONFIG.SHEET_DEVICES);
  if (!devSheet) {
    devSheet = ss.insertSheet(CONFIG.SHEET_DEVICES);
  }
  if (devSheet.getLastRow() === 0) {
    const devHeaders = [
      "Mã thiết bị", "Tên thiết bị", "Danh mục", "Vị trí", "Phụ kiện đi kèm",
      "Ảnh chuẩn bàn giao", "Cảnh báo nguồn & Lưu ý", "Link tài liệu / Pinout",
      "Trạng thái", "MSSV giữ", "Họ tên người giữ", "Dự án / Mục đích", "Cập nhật lúc"
    ];
    appendTextRow(devSheet, devHeaders);
    devSheet.getRange(1, 1, 1, devHeaders.length).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
    devSheet.setFrozenRows(1);
    
    // Thêm dữ liệu mẫu
    const nowStr = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");
    const sampleDevices = [
      ["DEV001", "Jetson Nano Developer Kit B01", "MCU/SBC", "Tủ A - Ngăn 1", "Nguồn 5V-4A, Thẻ nhớ 64GB, Cáp microUSB, Quạt tản nhiệt", "https://images.unsplash.com/photo-1518770660439-4636190af475?w=600", "Nguồn 5V-4A DC Barrel Jack", "https://developer.nvidia.com/embedded/jetson-nano-developer-kit", "Trong kho", "", "", "", nowStr],
      ["DEV002", "Raspberry Pi 4 Model B (4GB)", "MCU/SBC", "Tủ A - Ngăn 2", "Nguồn Type-C 5V-3A, Vỏ nhôm tản nhiệt, Thẻ nhớ 32GB", "https://images.unsplash.com/photo-1555680202-c86f0e12f086?w=600", "Dùng nguồn Type-C 5V chuẩn", "https://www.raspberrypi.com/documentation/", "Trong kho", "", "", "", nowStr],
      ["DEV003", "LiDAR Slamtec RPLIDAR A1M8", "Cảm biến", "Tủ B - Ngăn 1", "Board chuyển đổi USB, Cáp kết nối 7-pin", "https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=600", "5V-0.5A, tránh va đập mạnh gương quay", "https://www.slamtec.com/en/Support#rplidar-a-series", "Trong kho", "", "", "", nowStr]
    ];
    sampleDevices.forEach(row => appendTextRow(devSheet, row));
  }
  
  // 2. Tạo hoặc cấu hình Sheet Users
  let userSheet = ss.getSheetByName(CONFIG.SHEET_USERS);
  if (!userSheet) {
    userSheet = ss.insertSheet(CONFIG.SHEET_USERS);
  }
  if (userSheet.getLastRow() === 0) {
    const userHeaders = ["MSSV / Mã cán bộ", "Mã PIN", "Họ và tên", "Số điện thoại", "Vai trò (ADMIN/INSPECTOR/STUDENT)", "Khóa"];
    appendTextRow(userSheet, userHeaders);
    userSheet.getRange(1, 1, 1, userHeaders.length).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
    userSheet.setFrozenRows(1);
    
    const sampleUsers = [
      ["admin", "9999", "Quản Trị Viên Lab", "0988888888", "ADMIN", "K68"],
      ["inspector", "7777", "Cán Bộ Kiểm Định QA", "0977777777", "INSPECTOR", "K68"],
      ["sv01", "1234", "Nguyễn Văn A", "0912345678", "STUDENT", "K68"],
      ["sv02", "1234", "Trần Thị B", "0923456789", "STUDENT", "K69"]
    ];
    sampleUsers.forEach(row => appendTextRow(userSheet, row));
  }
  
  // 3. Tạo hoặc cấu hình Sheet Logs
  let logSheet = ss.getSheetByName(CONFIG.SHEET_LOGS);
  if (!logSheet) {
    logSheet = ss.insertSheet(CONFIG.SHEET_LOGS);
  }
  if (logSheet.getLastRow() === 0) {
    const logHeaders = [
      "Thời gian", "Mã giao dịch", "Người thực hiện", "Hành động", "Danh sách thiết bị",
      "Dự án / Mục đích", "Phụ kiện kiểm tra", "Tình trạng", "Ghi chú sinh viên",
      "Link ảnh Drive", "Xem trước ảnh", "Trạng thái kiểm định", "Cán bộ kiểm định", "Ghi chú QA"
    ];
    appendTextRow(logSheet, logHeaders);
    logSheet.getRange(1, 1, 1, logHeaders.length).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
    logSheet.setFrozenRows(1);
  }
  
  Logger.log("Đã khởi tạo thành công toàn bộ hệ cơ sở dữ liệu ROAB LAB trên Google Sheets!");
}
