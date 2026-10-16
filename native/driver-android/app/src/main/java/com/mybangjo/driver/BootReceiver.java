package com.mybangjo.driver;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            SharedPreferences prefs = context.getSharedPreferences("xentra_driver_prefs", Context.MODE_PRIVATE);
            boolean isOnline = prefs.getBoolean("is_online", false);
            if (isOnline) {
                DriverGpsService.startService(context);
            }
        }
    }
}
