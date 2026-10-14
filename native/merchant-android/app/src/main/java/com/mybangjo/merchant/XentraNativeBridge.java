package com.mybangjo.merchant;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

public class XentraNativeBridge {
    private final Context context;
    private final BluetoothThermalPrinter printer;

    public XentraNativeBridge(Context context) {
        this.context = context;
        this.printer = new BluetoothThermalPrinter();
    }

    @JavascriptInterface
    public boolean isNativeApp() {
        return true;
    }

    @JavascriptInterface
    public String getAppVersion() {
        return "1.1.0-gobiz";
    }

    // ── Authentication Synchronization for Native Background Worker ──
    @JavascriptInterface
    public void syncAuth(String token, String branchId) {
        OrderMonitorService.saveAuthContext(context, token, branchId);
    }

    @JavascriptInterface
    public void clearAuth() {
        OrderMonitorService.clearAuthContext(context);
    }

    // ── Floating Order Widget (System Overlay / GoBiz-style) ──
    @JavascriptInterface
    public boolean hasOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return Settings.canDrawOverlays(context);
        }
        return true;
    }

    @JavascriptInterface
    public void requestOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + context.getPackageName())
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        } else {
            showToast("Izin Tampil di Atas Aplikasi Lain sudah aktif.");
        }
    }

    @JavascriptInterface
    public void testOverlay() {
        OrderOverlayService.showOverlay(
            context,
            "ord_demo",
            "99",
            "Pelanggan Bangjo (Demo)",
            "Rp 45.000"
        );
    }

    // ── Audio & Alarm Controls ──
    @JavascriptInterface
    public void playOrderAlarm() {
        OrderAlarmService.startAlarm(context);
    }

    @JavascriptInterface
    public void stopOrderAlarm() {
        OrderAlarmService.stopAlarm(context);
        OrderOverlayService.hideOverlay(context);
    }

    // ── Bluetooth Thermal Printer ──
    @JavascriptInterface
    public String getPairedPrinters() {
        return printer.getPairedDevicesJson();
    }

    @JavascriptInterface
    public boolean connectPrinter(String macAddress) {
        return printer.connect(macAddress);
    }

    @JavascriptInterface
    public boolean isPrinterConnected() {
        return printer.isConnected();
    }

    @JavascriptInterface
    public void disconnectPrinter() {
        printer.disconnect();
    }

    @JavascriptInterface
    public boolean printReceipt(String receiptText) {
        return printer.printFormattedReceipt(receiptText);
    }

    @JavascriptInterface
    public boolean printRawBase64(String base64EscPosData) {
        return printer.printBase64(base64EscPosData);
    }

    @JavascriptInterface
    public void vibrate(long[] pattern) {
        try {
            Vibrator v = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createWaveform(pattern != null ? pattern : new long[]{0, 500, 250, 500}, -1));
                } else {
                    v.vibrate(pattern != null ? pattern : new long[]{0, 500, 250, 500}, -1);
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @JavascriptInterface
    public void showToast(String message) {
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show();
    }
}
