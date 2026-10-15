package com.mybangjo.pos;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.provider.Settings;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            SharedPreferences prefs = context.getSharedPreferences("xentra_pos_prefs", Context.MODE_PRIVATE);
            String token = prefs.getString("auth_token", null);
            String branchId = prefs.getString("auth_branch_id", null);

            if (token != null && !token.isEmpty() && branchId != null && !branchId.isEmpty()) {
                OrderMonitorService.startMonitoring(context);
            }

            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)) {
                if (OrderOverlayService.isAssistiveBallEnabled(context)) {
                    OrderOverlayService.showBall(context, 0);
                }
            }
        }
    }
}
