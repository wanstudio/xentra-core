package com.mybangjo.merchant;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class OrderMonitorService extends Service {
    private static final String PREFS_NAME = "xentra_merchant_prefs";
    private static final String KEY_TOKEN = "auth_token";
    private static final String KEY_BRANCH_ID = "auth_branch_id";

    private static final String CHANNEL_PERSISTENT = "channel_order_monitor_status";
    private static final String CHANNEL_ALERT = "channel_orders_alarm_v1";

    private static final int NOTIF_PERSISTENT_ID = 8118;
    private static final int NOTIF_ALERT_ID = 8228;

    public static final String ACTION_START = "com.mybangjo.merchant.ACTION_START_MONITOR";
    public static final String ACTION_STOP = "com.mybangjo.merchant.ACTION_STOP_MONITOR";

    private ScheduledExecutorService scheduler;
    private final Set<String> seenPendingOrderIds = new HashSet<>();
    private boolean isAlarmActive = false;

    public static void saveAuthContext(Context context, String token, String branchId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putString(KEY_TOKEN, token)
            .putString(KEY_BRANCH_ID, branchId)
            .apply();

        if (token != null && !token.isEmpty() && branchId != null && !branchId.isEmpty()) {
            startMonitoring(context);
        }
    }

    public static void clearAuthContext(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().clear().apply();
        stopMonitoring(context);
    }

    public static void startMonitoring(Context context) {
        Intent intent = new Intent(context, OrderMonitorService.class);
        intent.setAction(ACTION_START);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    public static void stopMonitoring(Context context) {
        Intent intent = new Intent(context, OrderMonitorService.class);
        intent.setAction(ACTION_STOP);
        context.startService(intent);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannels();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopPollingScheduler();
            OrderAlarmService.stopAlarm(this);
            OrderOverlayService.hideOverlay(this);
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        startForeground(NOTIF_PERSISTENT_ID, buildPersistentNotification());
        startPollingScheduler();

        return START_STICKY;
    }

    private void startPollingScheduler() {
        if (scheduler != null && !scheduler.isShutdown()) {
            return;
        }

        scheduler = Executors.newSingleThreadScheduledExecutor();
        // Poll orders every 8 seconds in native Java
        scheduler.scheduleWithFixedDelay(this::pollPendingOrders, 1, 8, TimeUnit.SECONDS);
    }

    private void stopPollingScheduler() {
        if (scheduler != null) {
            scheduler.shutdownNow();
            scheduler = null;
        }
    }

    private void pollPendingOrders() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String token = prefs.getString(KEY_TOKEN, null);
        String branchId = prefs.getString(KEY_BRANCH_ID, null);

        if (token == null || branchId == null || token.isEmpty() || branchId.isEmpty()) {
            return;
        }

        HttpURLConnection conn = null;
        try {
            URL url = new URL("https://m.mybangjo.com/api/v1/admin/branches/" + branchId + "/orders?status=pending");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setRequestProperty("Accept", "application/json");
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(6000);

            int responseCode = conn.getResponseCode();
            if (responseCode == 200) {
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder response = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    response.append(line);
                }
                reader.close();

                processOrderResponse(response.toString());
            } else if (responseCode == 401 || responseCode == 403) {
                // Token invalid or expired
            }
        } catch (Exception e) {
            // Network glitch, will retry next cycle
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private void processOrderResponse(String jsonString) {
        try {
            JSONObject data = new JSONObject(jsonString);
            if (!data.optBoolean("success", false)) return;

            JSONArray orders = data.optJSONArray("orders");
            int pendingCount = 0;
            JSONObject latestOrder = null;
            Set<String> currentPendingIds = new HashSet<>();

            if (orders != null) {
                for (int i = 0; i < orders.length(); i++) {
                    JSONObject o = orders.getJSONObject(i);
                    String status = o.optString("status", "");
                    if ("pending".equalsIgnoreCase(status)) {
                        String id = o.optString("id", "");
                        currentPendingIds.add(id);
                        pendingCount++;
                        if (latestOrder == null) {
                            latestOrder = o;
                        }
                    }
                }
            }

            if (pendingCount > 0) {
                boolean hasNewOrder = false;
                for (String id : currentPendingIds) {
                    if (!seenPendingOrderIds.contains(id)) {
                        hasNewOrder = true;
                        break;
                    }
                }

                // If new order arrived, or alarm not yet playing for waiting orders:
                if (hasNewOrder || !isAlarmActive) {
                    isAlarmActive = true;
                    seenPendingOrderIds.addAll(currentPendingIds);

                    // 1. Wake screen up
                    wakeUpScreen();

                    // 2. Play native alarm sound & vibration loop
                    OrderAlarmService.startAlarm(this);

                    // 3. Post High Priority Native Notification
                    showNativeOrderNotification(pendingCount, latestOrder);

                    // 4. Show Floating Overlay widget over other apps
                    if (latestOrder != null) {
                        String orderId = latestOrder.optString("id", "");
                        String orderNum = latestOrder.optString("order_number", "");
                        String customer = latestOrder.optString("customer_name", "Pelanggan");
                        double amount = latestOrder.optDouble("total_amount", 0);
                        String totalStr = amount > 0 ? ("Rp " + String.format("%,.0f", amount).replace(',', '.')) : "";

                        OrderOverlayService.showOverlay(this, orderId, orderNum, customer, totalStr);
                    }
                }
            } else {
                // No pending orders left (accepted or rejected)
                if (isAlarmActive || !seenPendingOrderIds.isEmpty()) {
                    isAlarmActive = false;
                    seenPendingOrderIds.clear();
                    OrderAlarmService.stopAlarm(this);
                    OrderOverlayService.hideOverlay(this);
                    dismissOrderNotification();
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void wakeUpScreen() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                PowerManager.WakeLock wl = pm.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK |
                    PowerManager.ACQUIRE_CAUSES_WAKEUP |
                    PowerManager.ON_AFTER_RELEASE,
                    "Mybangjo:OrderWakeUp"
                );
                wl.acquire(60 * 1000L); // 1 minute wake lock
            }
        } catch (Exception ignored) {}
    }

    private void showNativeOrderNotification(int pendingCount, JSONObject order) {
        String title = pendingCount > 1
            ? ("🔔 Ada " + pendingCount + " Pesanan Baru Menunggu!")
            : "🔔 Ada Pesanan Baru Masuk!";

        String body = "Ketuk untuk membuka pesanan dan mengonfirmasi.";
        if (order != null) {
            String cust = order.optString("customer_name", "Pelanggan");
            String num = order.optString("order_number", order.optString("id", "").substring(Math.max(0, order.optString("id", "").length() - 6)));
            double amount = order.optDouble("total_amount", 0);
            String amtStr = amount > 0 ? (" · Rp " + String.format("%,.0f", amount).replace(',', '.')) : "";
            body = "Pesanan #" + num + " dari " + cust + amtStr;
        }

        // Tap notification directly launches MainActivity (NOT Chrome!)
        Intent openAppIntent = new Intent(this, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentPendingIntent = PendingIntent.getActivity(
            this, 0, openAppIntent,
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0
        );

        // Action: Stop alarm
        Intent stopIntent = new Intent(this, OrderAlarmService.class);
        stopIntent.setAction(OrderAlarmService.ACTION_STOP_ALARM);
        PendingIntent stopPendingIntent = PendingIntent.getService(
            this, 1, stopIntent,
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0
        );

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ALERT)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(contentPendingIntent)
            .setAutoCancel(true)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_menu_view, "Buka Kasir", contentPendingIntent)
            .addAction(android.R.drawable.ic_media_pause, "Hentikan Suara", stopPendingIntent)
            .build();

        NotificationManagerCompat.from(this).notify(NOTIF_ALERT_ID, notification);
    }

    private void dismissOrderNotification() {
        NotificationManagerCompat.from(this).cancel(NOTIF_ALERT_ID);
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null) return;

            // Persistent background status channel (silent)
            NotificationChannel statusChannel = new NotificationChannel(
                CHANNEL_PERSISTENT,
                "Status Pemantau Pesanan",
                NotificationManager.IMPORTANCE_LOW
            );
            statusChannel.setDescription("Menampilkan status aktif aplikasi di latar belakang.");
            statusChannel.setShowBadge(false);
            nm.createNotificationChannel(statusChannel);

            // Alert Channel (High priority, vibration, heads-up)
            NotificationChannel alertChannel = new NotificationChannel(
                CHANNEL_ALERT,
                getString(R.string.notification_channel_orders),
                NotificationManager.IMPORTANCE_HIGH
            );
            alertChannel.setDescription(getString(R.string.notification_channel_orders_desc));
            alertChannel.enableVibration(true);
            alertChannel.setVibrationPattern(new long[]{0, 600, 300, 600, 300, 1000});
            alertChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            alertChannel.setShowBadge(true);
            nm.createNotificationChannel(alertChannel);
        }
    }

    private Notification buildPersistentNotification() {
        Intent openAppIntent = new Intent(this, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, openAppIntent,
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0
        );

        return new NotificationCompat.Builder(this, CHANNEL_PERSISTENT)
            .setContentTitle("Mybangjo Merchant")
            .setContentText("Pemantau pesanan aktif di latar belakang")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build();
    }

    @Override
    public void onDestroy() {
        stopPollingScheduler();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
