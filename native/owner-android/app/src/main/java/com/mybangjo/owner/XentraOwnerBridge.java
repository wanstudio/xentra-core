package com.mybangjo.owner;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

public class XentraOwnerBridge {
    private final MainActivity activity;
    private final BluetoothThermalPrinter printer;
    private final Handler mainHandler;

    public XentraOwnerBridge(MainActivity activity) {
        this.activity = activity;
        this.printer = new BluetoothThermalPrinter();
        this.mainHandler = new Handler(Looper.getMainLooper());
    }

    @JavascriptInterface
    public boolean isNativeShell() {
        return true;
    }

    @JavascriptInterface
    public boolean isNativeApp() {
        return true;
    }

    @JavascriptInterface
    public String getAppVersion() {
        return "1.1.0";
    }

    @JavascriptInterface
    public String getPlatform() {
        return "android-pos";
    }

    @JavascriptInterface
    public void toast(String message) {
        if (message == null) return;
        mainHandler.post(() -> Toast.makeText(activity, message, Toast.LENGTH_SHORT).show());
    }

    @JavascriptInterface
    public void setKeepScreenOn(boolean keepOn) {
        mainHandler.post(() -> activity.setKeepScreenOn(keepOn));
    }

    // ── Dynamic / Adaptive Status Bar Control ──
    @JavascriptInterface
    public void setStatusBarColor(String hexColor, boolean darkIcons) {
        activity.updateStatusBar(hexColor, darkIcons);
    }

    // ── Dynamic / Adaptive Navigation Bar Control ──
    @JavascriptInterface
    public void setNavigationBarColor(String hexColor, boolean darkIcons) {
        activity.updateNavigationBar(hexColor, darkIcons);
    }

    @JavascriptInterface
    public void setSystemBarsColor(String statusBarColor, String navBarColor, boolean darkIcons) {
        activity.updateStatusBar(statusBarColor, darkIcons);
        activity.updateNavigationBar(navBarColor, darkIcons);
    }

    // ── Native Google Sign-In (System Account Picker) ──
    @JavascriptInterface
    public void launchGoogleSignIn() {
        launchGoogleSignIn("");
    }

    @JavascriptInterface
    public void launchGoogleSignIn(String clientId) {
        activity.startGoogleSignIn(clientId);
    }

    // ── Authentication Synchronization for Background Order Monitor ──
    @JavascriptInterface
    public void syncAuth(String token, String branchId) {
        OrderMonitorService.saveAuthContext(activity, token, branchId);
    }

    @JavascriptInterface
    public void clearAuth() {
        OrderMonitorService.clearAuthContext(activity);
    }

    // ── Floating Order Widget (System Overlay & Assistive Ball) ──
    @JavascriptInterface
    public boolean hasOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return Settings.canDrawOverlays(activity);
        }
        return true;
    }

    @JavascriptInterface
    public void requestOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(activity)) {
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + activity.getPackageName())
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
        } else {
            toast("Izin Tampil di Atas Aplikasi Lain sudah aktif.");
        }
    }

    @JavascriptInterface
    public boolean isAssistiveBallEnabled() {
        return OrderOverlayService.isAssistiveBallEnabled(activity);
    }

    @JavascriptInterface
    public void setAssistiveBallEnabled(boolean enabled) {
        OrderOverlayService.setAssistiveBallEnabled(activity, enabled);
    }

    @JavascriptInterface
    public void updateBadge(int pendingCount) {
        OrderOverlayService.updateBadge(activity, pendingCount);
    }

    @JavascriptInterface
    public void testOverlay() {
        OrderOverlayService.showOrderCard(
            activity,
            "pos_demo",
            "#POS-99",
            "Pelanggan Kasir Demo",
            "Rp 50.000"
        );
    }

    @JavascriptInterface
    public void testAssistiveBall() {
        OrderOverlayService.showBall(activity, 1);
    }

    // ── Battery Optimization Whitelist ──
    @JavascriptInterface
    public boolean isIgnoringBatteryOptimizations() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) activity.getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isIgnoringBatteryOptimizations(activity.getPackageName());
        }
        return true;
    }

    @JavascriptInterface
    public void requestIgnoreBatteryOptimization() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
            } catch (Exception ignored) {}
        }
    }

    // ── Audio & Alarm Controls ──
    @JavascriptInterface
    public void playOrderAlarm() {
        OrderAlarmService.startAlarm(activity);
    }

    @JavascriptInterface
    public void stopOrderAlarm() {
        OrderAlarmService.stopAlarm(activity);
        if (OrderOverlayService.isAssistiveBallEnabled(activity)) {
            OrderOverlayService.showBall(activity, 0);
        } else {
            OrderOverlayService.hideOverlay(activity);
        }
    }

    // ── Bluetooth Thermal Printer & ESC/POS Hardware ──

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
        if (receiptText == null || receiptText.trim().isEmpty()) return false;
        return printer.printFormattedReceipt(receiptText);
    }

    @JavascriptInterface
    public boolean printRawBase64(String base64Data) {
        if (base64Data == null || base64Data.trim().isEmpty()) return false;
        return printer.printBase64(base64Data);
    }

    @JavascriptInterface
    public boolean openCashDrawer() {
        return printer.openCashDrawer();
    }
}
