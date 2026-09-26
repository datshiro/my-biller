package dev.datshiro.mybiller;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.ConnectException;
import java.net.InetSocketAddress;
import java.net.NoRouteToHostException;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;

@CapacitorPlugin(name = "PrinterSocket")
public class PrinterSocketPlugin extends Plugin {
    @PluginMethod
    public void printRaw(PluginCall call) {
        String host = call.getString("host");
        Integer port = call.getInt("port");
        String b64 = call.getString("base64");
        int timeout = call.getInt("timeoutMs", 3000);
        int writeTimeout = call.getInt("writeTimeoutMs", 20000);
        if (host == null || port == null || b64 == null) {
            call.reject("Thiếu host/port/base64", "EARGS");
            return;
        }
        // Chạy nền: mạng trên main thread ném NetworkOnMainThreadException.
        new Thread(() -> {
            Socket socket = new Socket();
            try {
                socket.connect(new InetSocketAddress(host, port), timeout);
                byte[] data = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
                SocketWriter.write(socket, data, writeTimeout);
                // Byte đã ra khỏi máy. Máy in (lwIP) hay gửi RST trong FIN_WAIT_2 dù giấy đã in; trên
                // Android/Linux teardown (shutdownOutput/close) khi đó ném ECONNRESET — KHÔNG phải lỗi in.
                // Nên chốt "đã gửi" NGAY sau flush; shutdownOutput best-effort, close nuốt ở finally. Báo
                // hỏng lúc này khiến chủ quán bấm in lại → hai phiếu. write()/flush() vẫn ném (kể cả quá hạn ghi) → reject
                // (gửi dở thật). Không setSoTimeout: không hề đọc, timeout đọc là vô nghĩa ở đây.
                JSObject result = new JSObject();
                result.put("sent", data.length);
                try { socket.shutdownOutput(); } catch (Exception ignored) {}
                call.resolve(result);
            } catch (SocketWriter.WriteTimeoutException e) {
                call.reject(e.getMessage(), "EWRITETIMEOUT");
            } catch (SocketTimeoutException e) {
                call.reject(e.getMessage(), "ETIMEDOUT");
            } catch (ConnectException e) {
                call.reject(e.getMessage(), "ECONNREFUSED");
            } catch (NoRouteToHostException | UnknownHostException e) {
                call.reject(e.getMessage(), "EHOSTUNREACH");
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()), "EOTHER");
            } finally {
                try {
                    socket.close();
                } catch (Exception ignored) {
                    // Đóng sau khi đã gửi: không phải lỗi in.
                }
            }
        }).start();
    }
}
