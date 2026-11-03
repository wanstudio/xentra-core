package com.mybangjo.driver;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

public class XentraDriverBridge {
    private final MainActivity activity;
    private final SharedPreferences prefs;

    public XentraDriverBridge(MainActivity activity) {
        this.activity = activity;
        this.prefs = activity.getSharedPreferences("xentra_driver_prefs", Context.MODE_PRIVATE);
    }

    @JavascriptInterface
    public boolean isNativeApp() {
        return true;
    }

    @JavascriptInterface
    public void clearAppCache() {
        activity.runOnUiThread(activity::clearWebViewCache);
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

    @JavascriptInterface
    public void setAuthToken(String token, String driverId, String brandId, String branchId) {
        prefs.edit()
            .putString("auth_token", token)
            .putString("driver_id", driverId)
            .putString("brand_id", brandId)
            .putString("branch_id", branchId)
            .apply();
        activity.runOnUiThread(() -> {
            if (token != null && !token.trim().isEmpty()) {
                DriverGpsService.startService(activity);
            } else {
                DriverGpsService.stopService(activity);
            }
        });
    }

    @JavascriptInterface
    public void syncAuth(String token, String branchId) {
        prefs.edit()
            .putString("auth_token", token)
            .putString("branch_id", branchId)
            .apply();
        activity.runOnUiThread(() -> {
            if (token != null && !token.trim().isEmpty()) {
                DriverGpsService.startService(activity);
            } else {
                DriverGpsService.stopService(activity);
            }
        });
    }

    @JavascriptInterface
    public void clearAuth() {
        prefs.edit()
            .remove("auth_token")
            .remove("driver_id")
            .remove("brand_id")
            .remove("branch_id")
            .remove("active_order_id")
            .remove("last_alerted_order_id")
            .putBoolean("is_online", false)
            .apply();
        activity.runOnUiThread(() -> {
            OrderAlarmService.stop(activity);
            OrderOverlayService.hideOverlay(activity);
            DriverGpsService.stopService(activity);
        });
    }

    @JavascriptInterface
    public void setOnlineStatus(boolean isOnline) {
        prefs.edit().putBoolean("is_online", isOnline).apply();
        String token = prefs.getString("auth_token", null);
        activity.runOnUiThread(() -> {
            if (isOnline || (token != null && !token.isEmpty())) {
                DriverGpsService.startService(activity);
            } else {
                DriverGpsService.stopService(activity);
            }
        });
    }

    // ── Floating Order Overlay & Assistive Ball Controls ──
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
            activity.runOnUiThread(() -> {
                Intent intent = new Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + activity.getPackageName())
                );
                activity.startActivity(intent);
            });
        }
    }

    @JavascriptInterface
    public void showOrderCard(String orderId, String orderNumber, String customer, String address, String total) {
        activity.runOnUiThread(() -> OrderOverlayService.showOrderCard(activity, orderId, orderNumber, customer, address, total));
    }

    @JavascriptInterface
    public void showBall() {
        activity.runOnUiThread(() -> OrderOverlayService.showBall(activity));
    }

    @JavascriptInterface
    public void hideOverlay() {
        activity.runOnUiThread(() -> OrderOverlayService.hideOverlay(activity));
    }

    @JavascriptInterface
    public void setActiveOrder(String orderId) {
        prefs.edit().putString("active_order_id", orderId != null ? orderId : "").apply();
    }

    @JavascriptInterface
    public void playOrderAlert() {
        activity.runOnUiThread(() -> OrderAlarmService.start(activity));
    }

    @JavascriptInterface
    public void stopOrderAlert() {
        activity.runOnUiThread(() -> OrderAlarmService.stop(activity));
    }

    // Alias for parity with XentraAudio (audio-alerts.js) and standard XentraNative bridge
    @JavascriptInterface
    public void playOrderAlarm() {
        playOrderAlert();
    }

    @JavascriptInterface
    public void stopOrderAlarm() {
        stopOrderAlert();
    }

    @JavascriptInterface
    public void openGoogleMaps(double latitude, double longitude, String label) {
        activity.runOnUiThread(() -> {
            try {
                String uriString = "google.navigation:q=" + latitude + "," + longitude + "&mode=d";
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uriString));
                intent.setPackage("com.google.android.apps.maps");
                if (intent.resolveActivity(activity.getPackageManager()) != null) {
                    activity.startActivity(intent);
                } else {
                    Intent webIntent = new Intent(Intent.ACTION_VIEW,
                        Uri.parse("https://www.google.com/maps/dir/?api=1&destination=" + latitude + "," + longitude));
                    activity.startActivity(webIntent);
                }
            } catch (Exception e) {
                Toast.makeText(activity, "Gagal membuka navigasi Google Maps", Toast.LENGTH_SHORT).show();
            }
        });
    }

    @JavascriptInterface
    public int getBatteryLevel() {
        try {
            BatteryManager bm = (BatteryManager) activity.getSystemService(Context.BATTERY_SERVICE);
            if (bm != null) {
                return bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
            }
        } catch (Exception ignored) {}
        return -1;
    }
}
