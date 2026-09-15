package dev.datshiro.mybiller;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Đăng ký TRƯỚC super.onCreate: bridge dựng WebView trong super, plugin phải có mặt lúc đó.
        registerPlugin(PrinterSocketPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
