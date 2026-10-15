package com.mybangjo.pos;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

public class XentraPosBridge {
    private final MainActivity activity;
    private final BluetoothThermalPrinter printer;
    private final Handler mainHandler;

    public XentraPosBridge(MainActivity activity) {
        this.activity = activity;
        this.printer = new BluetoothThermalPrinter();
        this.mainHandler = new Handler(Looper.getMainLooper());
    }

    @JavascriptInterface
    public boolean isNativeShell() {
        return true;
    }

    @JavascriptInterface
    public String getAppVersion() {
        return "1.0.0";
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

    @JavascriptInterface
    public void setStatusBarColor(String hexColor, boolean darkIcons) {
        activity.updateStatusBar(hexColor, darkIcons);
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
