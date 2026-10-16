package com.mybangjo.driver;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.BatteryManager;
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
    public void setAuthToken(String token, String driverId, String brandId, String branchId) {
        prefs.edit()
            .putString("auth_token", token)
            .putString("driver_id", driverId)
            .putString("brand_id", brandId)
            .putString("branch_id", branchId)
            .apply();
    }

    @JavascriptInterface
    public void setOnlineStatus(boolean isOnline) {
        prefs.edit().putBoolean("is_online", isOnline).apply();
        activity.runOnUiThread(() -> {
            if (isOnline) {
                DriverGpsService.startService(activity);
            } else {
                DriverGpsService.stopService(activity);
            }
        });
    }

    @JavascriptInterface
    public void setActiveOrder(String orderId) {
        prefs.edit().putString("active_order_id", orderId).apply();
        if (orderId != null && !orderId.isEmpty()) {
            activity.runOnUiThread(() -> OrderOverlayService.show(activity, orderId));
        } else {
            activity.runOnUiThread(() -> OrderOverlayService.hide(activity));
        }
    }

    @JavascriptInterface
    public void playOrderAlert() {
        activity.runOnUiThread(() -> OrderAlarmService.start(activity));
    }

    @JavascriptInterface
    public void stopOrderAlert() {
        activity.runOnUiThread(() -> OrderAlarmService.stop(activity));
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
