package com.mybangjo.merchant;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
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
        return "1.0.0-native";
    }

    @JavascriptInterface
    public void playOrderAlarm() {
        OrderAlarmService.startAlarm(context);
    }

    @JavascriptInterface
    public void stopOrderAlarm() {
        OrderAlarmService.stopAlarm(context);
    }

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
