package com.mybangjo.owner;

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
    private static final String PREFS_NAME = "xentra_pos_prefs";
    private static final String KEY_TOKEN = "auth_token";
    private static final String KEY_BRANCH_ID = "auth_branch_id";

    private static final String CHANNEL_PERSISTENT = "channel_pos_monitor_status";
    private static final String CHANNEL_ALERT = "channel_pos_orders_silent";

    private static final int NOTIF_PERSISTENT_ID = 8119;
    private static final int NOTIF_ALERT_ID = 8229;

    public static final String ACTION_START = "com.mybangjo.owner.ACTION_START_MONITOR";
    public static final String ACTION_STOP = "com.mybangjo.owner.ACTION_STOP_MONITOR";

    private ScheduledExecutorService scheduler;
    private final Set<String> seenPendingOrderIds = new HashSet<>();
    private boolean isAlarmActive = false;

    public static void saveAuthContext(Context context, String token, String branchId) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit()
                .putString(KEY_TOKEN, token)
                .putString(KEY_BRANCH_ID, branchId)
                .apply();

            if (token != null && !token.isEmpty() && branchId != null && !branchId.isEmpty()) {
                startMonitoring(context);
            }
        } catch (Exception e) {
            android.util.Log.w("OrderMonitorService", "Failed to save auth context: " + e.getMessage());
        }
    }

    public static void clearAuthContext(Context context) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().remove(KEY_TOKEN).remove(KEY_BRANCH_ID).apply();
            stopMonitoring(context);
        } catch (Exception ignored) {}
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
            stopScheduler();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        startForeground(NOTIF_PERSISTENT_ID, buildForegroundNotification());
        startScheduler();

        if (OrderOverlayService.isAssistiveBallEnabled(this)) {
            OrderOverlayService.showBall(this, 0);
        }

        return START_STICKY;
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager == null) return;

            NotificationChannel statusChannel = new NotificationChannel(
                CHANNEL_PERSISTENT,
                "Status Layanan Kasir POS",
                NotificationManager.IMPORTANCE_MIN
            );
            statusChannel.setDescription("Menjaga notifikasi pesanan kasir tetap aktif di latar belakang");
            statusChannel.setShowBadge(false);
            manager.createNotificationChannel(statusChannel);

            NotificationChannel alertChannel = new NotificationChannel(
                CHANNEL_ALERT,
                "Pesanan Kasir Masuk",
                NotificationManager.IMPORTANCE_HIGH
            );
            alertChannel.setDescription("Pemberitahuan pesanan baru masuk ke kasir");
            alertChannel.setSound(null, null);
            alertChannel.enableVibration(false);
            alertChannel.setShowBadge(true);
            manager.createNotificationChannel(alertChannel);
        }
    }

    private Notification buildForegroundNotification() {
        Intent openAppIntent = new Intent(this, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(
            this, 0, openAppIntent,
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0
        );

        return new NotificationCompat.Builder(this, CHANNEL_PERSISTENT)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Mybangjo POS Aktif")
            .setContentText("Memantau pesanan kasir & antrean secara real-time.")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(pi)
            .setOngoing(true)
            .build();
    }

    private synchronized void startScheduler() {
        if (scheduler != null && !scheduler.isShutdown()) return;

        scheduler = Executors.newSingleThreadScheduledExecutor();
        scheduler.scheduleWithFixedDelay(this::pollPendingOrders, 1, 5, TimeUnit.SECONDS);
    }

    private synchronized void stopScheduler() {
        if (scheduler != null) {
            scheduler.shutdownNow();
            scheduler = null;
        }
    }

    private void pollPendingOrders() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String token = prefs.getString(KEY_TOKEN, null);
        String branchId = prefs.getString(KEY_BRANCH_ID, null);

        if (token == null || token.isEmpty()) return;

        PowerManager.WakeLock pollLock = null;
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                pollLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MybangjoPOS:OrderPollLock");
                pollLock.acquire(10 * 1000L);
            }
        } catch (Exception ignored) {}

        HttpURLConnection conn = null;
        try {
            String urlStr = (branchId != null && !branchId.trim().isEmpty() && !branchId.equals("null"))
                ? ("https://m.mybangjo.com/api/v1/admin/branches/" + branchId + "/orders?status=pending")
                : "https://m.mybangjo.com/api/v1/admin/orders?status=pending";

            URL url = new URL(urlStr);
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
            }
        } catch (Exception ignored) {
        } finally {
            if (conn != null) conn.disconnect();
            if (pollLock != null && pollLock.isHeld()) {
                try { pollLock.release(); } catch (Exception ignored) {}
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

            OrderOverlayService.updateBadge(this, pendingCount);

            if (pendingCount > 0) {
                boolean hasNewOrder = false;
                for (String id : currentPendingIds) {
                    if (!seenPendingOrderIds.contains(id)) {
                        hasNewOrder = true;
                        break;
                    }
                }

                if (hasNewOrder || !isAlarmActive) {
                    isAlarmActive = true;
                    seenPendingOrderIds.addAll(currentPendingIds);

                    wakeUpScreen();
                    OrderAlarmService.startAlarm(this);
                    showNativeOrderNotification(pendingCount, latestOrder);

                    if (latestOrder != null) {
                        String orderId = latestOrder.optString("id", "");
                        String orderNum = latestOrder.optString("order_number", "");
                        String customer = latestOrder.optString("customer_name", "Pelanggan");
                        double amount = latestOrder.optDouble("total_amount", 0);
                        String totalStr = amount > 0 ? ("Rp " + String.format("%,.0f", amount).replace(',', '.')) : "";

                        OrderOverlayService.showOrderCard(this, orderId, orderNum, customer, totalStr);
                    }
                }
            } else {
                if (isAlarmActive || !seenPendingOrderIds.isEmpty()) {
                    isAlarmActive = false;
                    seenPendingOrderIds.clear();
                    OrderAlarmService.stopAlarm(this);
                    dismissOrderNotification();
                    if (OrderOverlayService.isAssistiveBallEnabled(this)) {
                        OrderOverlayService.showBall(this, 0);
                    }
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
                    "MybangjoPOS:OrderWakeUp"
                );
                wl.acquire(60 * 1000L);
            }
        } catch (Exception ignored) {}
    }

    private void showNativeOrderNotification(int pendingCount, JSONObject order) {
        String title = pendingCount > 1
            ? ("🔔 Ada " + pendingCount + " Pesanan Kasir Baru!")
            : "🔔 Ada Pesanan Kasir Masuk!";

        String body = "Ketuk untuk membuka kasir dan mengonfirmasi.";
        if (order != null) {
            String cust = order.optString("customer_name", "Pelanggan");
            String rawNum = order.optString("order_number", "");
            String num = !rawNum.isEmpty() ? (rawNum.startsWith("#") ? rawNum : ("#" + rawNum)) : "#" + order.optString("id", "");
            double amount = order.optDouble("total_amount", 0);
            String amtStr = amount > 0 ? (" · Rp " + String.format("%,.0f", amount).replace(',', '.')) : "";
            body = "Pesanan " + num + " dari " + cust + amtStr;
        }

        Intent openAppIntent = new Intent(this, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentPendingIntent = PendingIntent.getActivity(
            this, 0, openAppIntent,
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0
        );

        Intent stopAlarmIntent = new Intent(this, OrderAlarmService.class);
        stopAlarmIntent.setAction(OrderAlarmService.ACTION_STOP_ALARM);
        PendingIntent stopAlarmPi = PendingIntent.getService(
            this, 2, stopAlarmIntent,
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0
        );

        Notification notif = new NotificationCompat.Builder(this, CHANNEL_ALERT)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setContentIntent(contentPendingIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Matikan Suara", stopAlarmPi)
            .setAutoCancel(true)
            .setSound(null)
            .setVibrate(new long[]{0})
            .build();

        NotificationManagerCompat.from(this).notify(NOTIF_ALERT_ID, notif);
    }

    private void dismissOrderNotification() {
        try {
            NotificationManagerCompat.from(this).cancel(NOTIF_ALERT_ID);
        } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        stopScheduler();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
