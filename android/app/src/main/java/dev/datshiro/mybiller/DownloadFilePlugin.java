package dev.datshiro.mybiller;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import androidx.annotation.RequiresApi;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Ghi một file chữ vào thư mục Tải về (Download) của máy. WebView của Capacitor nuốt im lặng cú
 * `<a download>` với blob URL, nên trong APK mọi file app xuất ra (sao lưu, file an toàn, file mẫu) phải
 * đi qua đây. Trả về tên **thật** hệ thống đã đặt — trùng tên thì Android tự đổi thành "… (1).json".
 */
@CapacitorPlugin(
    name = "DownloadFile",
    permissions = {
        // Chỉ dùng cho API 24–28; manifest khai `maxSdkVersion="28"`. API 29+ ghi qua MediaStore, không xin quyền.
        @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "storage")
    }
)
public class DownloadFilePlugin extends Plugin {
    static final String PERMISSION_DENIED = "Chưa cho phép ghi vào bộ nhớ, nên chưa lưu được file.";

    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        String filename = basename(call.getString("filename"));
        String mimeType = call.getString("mimeType");
        String text = call.getString("text");
        if (filename == null || filename.isEmpty() || mimeType == null || text == null) {
            call.reject("Thiếu tên file, loại file hoặc nội dung.", "EARGS");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "onStoragePermission");
            return;
        }
        write(call);
    }

    @PermissionCallback
    private void onStoragePermission(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) write(call);
        else call.reject(PERMISSION_DENIED, "EPERM");
    }

    private void write(PluginCall call) {
        String filename = basename(call.getString("filename"));
        String mimeType = baseMime(call.getString("mimeType"));
        byte[] bytes = call.getString("text").getBytes(StandardCharsets.UTF_8);
        // Ghi đĩa ngoài main thread: sổ vài nghìn đơn là vài MB.
        new Thread(() -> {
            try {
                call.resolve(
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                        ? writeMediaStore(filename, mimeType, bytes)
                        : writeLegacy(filename, bytes)
                );
            } catch (Exception e) {
                call.reject("Chưa lưu được file vào thư mục Tải về: " + e.getMessage(), "EWRITE");
            }
        }).start();
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private JSObject writeMediaStore(String filename, String mimeType, byte[] bytes) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
        values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        // IS_PENDING giấu file khỏi app khác cho tới khi ghi xong — không ai mở được nửa file.
        values.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IllegalStateException("hệ thống không tạo được file");

        try {
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new IllegalStateException("không mở được file để ghi");
                out.write(bytes);
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(uri, done, null, null);

            // Đọc lại tên sau khi xong: hệ thống đổi tên khi trùng, và app phải nói đúng tên người bán sẽ thấy.
            String displayName = filename;
            String relativePath = Environment.DIRECTORY_DOWNLOADS + "/";
            String[] columns = { MediaStore.Downloads.DISPLAY_NAME, MediaStore.Downloads.RELATIVE_PATH };
            try (Cursor cursor = resolver.query(uri, columns, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    if (cursor.getString(0) != null) displayName = cursor.getString(0);
                    if (cursor.getString(1) != null) relativePath = cursor.getString(1);
                }
            }
            return result(displayName, relativePath);
        } catch (Exception e) {
            // Không để lại file dở dang trong Tải về.
            try { resolver.delete(uri, null, null); } catch (Exception ignored) {}
            throw e;
        }
    }

    private JSObject writeLegacy(String filename, byte[] bytes) throws Exception {
        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("không tạo được thư mục Tải về");
        File target = createUnique(dir, filename);
        try (FileOutputStream out = new FileOutputStream(target)) {
            out.write(bytes);
        } catch (Exception e) {
            target.delete();
            throw e;
        }
        // Báo cho MediaStore để file hiện ngay trong app Files › Tải xuống.
        MediaScannerConnection.scanFile(getContext(), new String[] { target.getAbsolutePath() }, null, null);
        return result(target.getName(), Environment.DIRECTORY_DOWNLOADS + "/");
    }

    /** Trùng tên thì thêm " (n)" như MediaStore; `createNewFile` giữ chỗ nguyên tử nên hai lần lưu không đè nhau. */
    static File createUnique(File dir, String filename) throws Exception {
        int dot = filename.lastIndexOf('.');
        String stem = dot > 0 ? filename.substring(0, dot) : filename;
        String extension = dot > 0 ? filename.substring(dot) : "";
        for (int n = 0; n < 1000; n++) {
            File candidate = new File(dir, n == 0 ? filename : stem + " (" + n + ")" + extension);
            if (candidate.createNewFile()) return candidate;
        }
        throw new IllegalStateException("đã có quá nhiều file trùng tên");
    }

    /** Chỉ lấy tên file: bỏ mọi thư mục (`/`, `\`) để tên do JS đưa xuống không ghi ra ngoài Tải về. */
    static String basename(String name) {
        if (name == null) return null;
        String base = name.substring(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1).trim();
        return base.equals(".") || base.equals("..") ? "" : base;
    }

    /** `text/csv;charset=utf-8` → `text/csv`: MediaStore chỉ nhận MIME trần; nội dung luôn ghi UTF-8. */
    static String baseMime(String mimeType) {
        int semicolon = mimeType.indexOf(';');
        return (semicolon >= 0 ? mimeType.substring(0, semicolon) : mimeType).trim();
    }

    private static JSObject result(String displayName, String relativePath) {
        JSObject result = new JSObject();
        result.put("displayName", displayName);
        result.put("relativePath", relativePath.endsWith("/") ? relativePath : relativePath + "/");
        return result;
    }
}
