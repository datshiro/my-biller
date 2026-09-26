package dev.datshiro.mybiller;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothServerSocket;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.IOException;
import java.io.InputStream;
import java.util.UUID;

/**
 * Điện thoại giả làm máy in Bluetooth: mở server RFCOMM trên UUID SPP chuẩn, nhận từng máy gửi một, đẩy byte
 * nhận được lên JS (event "data", base64). Không hiểu ESC/POS, không cắt job — việc đó ở tầng TS, nơi có test.
 */
@CapacitorPlugin(
    name = "BluetoothPrinter",
    permissions = { @Permission(strings = { Manifest.permission.BLUETOOTH_CONNECT }, alias = "connect") }
)
public class BluetoothPrinterPlugin extends Plugin {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private volatile BluetoothServerSocket server;
    private volatile BluetoothSocket client;

    @PluginMethod
    public void start(PluginCall call) {
        // Android 12+ mới có quyền runtime BLUETOOTH_CONNECT; máy cũ dùng BLUETOOTH (cấp sẵn lúc cài).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("connect") != PermissionState.GRANTED) {
            requestPermissionForAlias("connect", call, "onConnectPermission");
            return;
        }
        listen(call);
    }

    @PermissionCallback
    private void onConnectPermission(PluginCall call) {
        if (getPermissionState("connect") == PermissionState.GRANTED) listen(call);
        else call.reject("Chưa cho phép quyền Bluetooth", "EPERM");
    }

    private synchronized void listen(PluginCall call) {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
        if (adapter == null) {
            call.reject("Máy không có Bluetooth", "ENOBT");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("Bluetooth đang tắt", "EBTOFF");
            return;
        }
        try {
            if (server == null) {
                BluetoothServerSocket socket = adapter.listenUsingRfcommWithServiceRecord("my-biller", SPP);
                server = socket;
                new Thread(() -> acceptLoop(socket), "bt-printer-accept").start();
            }
            JSObject result = new JSObject();
            result.put("name", adapter.getName());
            call.resolve(result);
        } catch (SecurityException e) {
            call.reject(String.valueOf(e.getMessage()), "EPERM");
        } catch (IOException e) {
            call.reject(String.valueOf(e.getMessage()), "EOTHER");
        }
    }

    /** Một máy gửi một lúc, như máy in thật: nối sau chờ tới khi nối trước đóng. */
    private void acceptLoop(BluetoothServerSocket socket) {
        while (server == socket) {
            BluetoothSocket peer;
            try {
                peer = socket.accept();
            } catch (IOException e) {
                // stop() đóng socket → accept ném: đó là tắt chủ động, không phải lỗi.
                if (server == socket) {
                    server = null;
                    closeQuietly(socket);
                    JSObject error = new JSObject();
                    error.put("message", "Bluetooth đã tắt hoặc mất kết nối — bấm BẬT lại.");
                    notifyListeners("error", error);
                }
                return;
            }
            // stop() chen vào ngay sau accept: nối này không ai đóng nữa — đóng luôn, thoát vòng.
            synchronized (this) {
                if (server != socket) {
                    closeQuietly(peer);
                    return;
                }
                client = peer;
            }
            String device = deviceName(peer);
            notifyConnection("connected", device);
            try (InputStream in = peer.getInputStream()) {
                byte[] buffer = new byte[4096];
                int n;
                while ((n = in.read(buffer)) > 0) {
                    JSObject data = new JSObject();
                    data.put("base64", Base64.encodeToString(buffer, 0, n, Base64.NO_WRAP));
                    notifyListeners("data", data);
                }
            } catch (IOException ignored) {
                // Máy gửi đóng nối hay rớt sóng đều đọc ra IOException — kết thúc job ở tầng TS.
            } finally {
                closeQuietly(peer);
                // Bật lại nhanh: vòng mới có thể đã nhận nối khác — chỉ xoá nếu vẫn là nối của mình.
                synchronized (this) {
                    if (client == peer) client = null;
                }
                notifyConnection("disconnected", device);
            }
        }
    }

    private String deviceName(BluetoothSocket peer) {
        try {
            String name = peer.getRemoteDevice().getName();
            return name != null ? name : peer.getRemoteDevice().getAddress();
        } catch (SecurityException e) {
            return "Máy gửi";
        }
    }

    private void notifyConnection(String state, String device) {
        JSObject event = new JSObject();
        event.put("state", state);
        event.put("device", device);
        notifyListeners("connection", event);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        close();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        close();
    }

    private synchronized void close() {
        BluetoothServerSocket socket = server;
        server = null;
        closeQuietly(socket);
        closeQuietly(client);
    }

    private static void closeQuietly(java.io.Closeable closeable) {
        if (closeable == null) return;
        try {
            closeable.close();
        } catch (IOException ignored) {
            // Đóng khi tắt: không còn ai nghe lỗi này.
        }
    }
}
