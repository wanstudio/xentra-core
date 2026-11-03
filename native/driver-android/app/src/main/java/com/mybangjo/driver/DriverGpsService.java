package com.mybangjo.driver;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONArray;
import org.json.JSONObject;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class DriverGpsService extends Service {
    private static final String TAG = "DriverGpsService";
    private static final String CHANNEL_ID = "mybangjo_driver_gps_channel";
    private static final String CHANNEL_ALERT_ID = "mybangjo_driver_heads_up_v2";
    private static final int NOTIFICATION_ID = 2001;
    private static final int ALERT_NOTIFICATION_ID = 3002;

    public static final String ACTION_START = "com.mybangjo.driver.ACTION_START_MONITOR";
    public static final String ACTION_STOP = "com.mybangjo.driver.ACTION_STOP_MONITOR";

    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private ScheduledExecutorService taskPoller;
    private PowerManager.WakeLock wakeLock;
    private SharedPreferences prefs;
    private OkHttpClient httpClient;
    private long lastPingTime = 0;

    public static void startService(Context context) {
        try {
            Intent intent = new Intent(context, DriverGpsService.class);
            intent.setAction(ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to start DriverGpsService: " + e.getMessage());
        }
    }

    public static void stopService(Context context) {
        try {
            Intent intent = new Intent(context, DriverGpsService.class);
            intent.setAction(ACTION_STOP);
            context.startService(intent);
        } catch (Exception e) {
            try {
                context.stopService(new Intent(context, DriverGpsService.class));
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        prefs = getSharedPreferences("xentra_driver_prefs", Context.MODE_PRIVATE);
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);

        httpClient = new OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .writeTimeout(10, TimeUnit.SECONDS)
                .readTimeout(10, TimeUnit.SECONDS)
                .build();

        createNotificationChannels();
        acquireWakeLock();
        startForegroundServiceNotification();
        setupLocationUpdates();
        startTaskPollingScheduler();
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager == null) return;

            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Mybangjo Driver Pemantau Aktif",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Memantau lokasi pengantaran dan penerimaan order realtime di latar belakang");
            channel.setSound(null, null);
            channel.enableVibration(false);
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);

            NotificationChannel alertChannel = new NotificationChannel(
                    CHANNEL_ALERT_ID,
                    "Peringatan Tugas Baru Driver",
                    NotificationManager.IMPORTANCE_HIGH
            );
            alertChannel.setDescription("Menampilkan pop-up notifikasi tugas pengantaran baru");
            alertChannel.setSound(null, null); // OrderAlarmService plays the looping MP3 alarm on USAGE_ALARM stream
            alertChannel.enableVibration(false);
            alertChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            alertChannel.setShowBadge(true);
            manager.createNotificationChannel(alertChannel);
        }
    }

    private void acquireWakeLock() {
        try {
            PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (powerManager != null && (wakeLock == null || !wakeLock.isHeld())) {
                wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Mybangjo::DriverGpsWakeLock");
                wakeLock.acquire(12 * 60 * 60 * 1000L); // Max 12 hours
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to acquire wake lock", e);
        }
    }

    private void startForegroundServiceNotification() {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, notificationIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Mybangjo Driver Aktif")
                .setContentText("Pemantau tugas baru & pelacakan GPS berjalan di latar belakang")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW);

        Notification notification = builder.build();

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION | ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            // Fallback if location permission wasn't granted yet: run as dataSync foreground service like Merchant OrderMonitorService!
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
                } else {
                    startForeground(NOTIFICATION_ID, notification);
                }
            } catch (Exception ignored) {}
        }
    }

    private void startTaskPollingScheduler() {
        if (taskPoller != null && !taskPoller.isShutdown()) {
            return;
        }
        taskPoller = Executors.newSingleThreadScheduledExecutor();
        // Poll pending tasks every 6 seconds independently of GPS movement (exact reference from Merchant OrderMonitorService)
        taskPoller.scheduleWithFixedDelay(this::pollDriverTasks, 1, 6, TimeUnit.SECONDS);
    }

    private void stopTaskPollingScheduler() {
        if (taskPoller != null) {
            taskPoller.shutdownNow();
            taskPoller = null;
        }
    }

    private void pollDriverTasks() {
        String token = prefs.getString("auth_token", null);
        if (token == null || token.trim().isEmpty()) {
            return;
        }

        PowerManager.WakeLock pollLock = null;
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                pollLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Mybangjo:DriverTaskPollLock");
                pollLock.acquire(8 * 1000L);
            }
        } catch (Exception ignored) {}

        try {
            String serverUrl = prefs.getString("api_base", "https://driver.mybangjo.com") + "/api/v1/driver/tasks";
            Request request = new Request.Builder()
                    .url(serverUrl)
                    .addHeader("Authorization", "Bearer " + token)
                    .addHeader("Accept", "application/json")
                    .get()
                    .build();

            try (Response response = httpClient.newCall(request).execute()) {
                if (response.isSuccessful() && response.body() != null) {
                    String respStr = response.body().string();
                    JSONObject resJson = new JSONObject(respStr);
                    if (!resJson.optBoolean("success", false)) return;

                    JSONArray tasks = resJson.optJSONArray("tasks");
                    JSONObject pendingTask = null;

                    if (tasks != null) {
                        for (int i = 0; i < tasks.length(); i++) {
                            JSONObject t = tasks.getJSONObject(i);
                            String delivStatus = t.optString("delivery_status", "");
                            String assignStatus = t.optString("assignment_status", "pending");
                            if ("assigned".equalsIgnoreCase(delivStatus) && "pending".equalsIgnoreCase(assignStatus)) {
                                pendingTask = t;
                                break;
                            }
                        }
                    }

                    if (pendingTask != null) {
                        String orderId = pendingTask.optString("order_id", "");
                        String orderNum = pendingTask.optString("order_number", orderId);
                        JSONObject custObj = pendingTask.optJSONObject("customer");
                        String cust = custObj != null ? custObj.optString("name", "Pelanggan") : "Pelanggan";
                        JSONObject destObj = pendingTask.optJSONObject("destination");
                        String addr = destObj != null ? destObj.optString("address", "") : "";
                        JSONObject payObj = pendingTask.optJSONObject("payment");
                        double total = payObj != null ? payObj.optDouble("amount", 0) : 0;

                        handleIncomingPendingTask(orderId, orderNum, cust, addr, total);
                    } else {
                        handleNoPendingTask();
                    }
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "Task poll cycle skipped: " + e.getMessage());
        } finally {
            if (pollLock != null && pollLock.isHeld()) {
                try { pollLock.release(); } catch (Exception ignored) {}
            }
        }
    }

    private void setupLocationUpdates() {
        LocationRequest locationRequest = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5000)
                .setMinUpdateIntervalMillis(3000)
                .setMinUpdateDistanceMeters(0) // Allow stationary GPS heartbeats even when motorcycle is parked!
                .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult locationResult) {
                if (locationResult == null) return;
                for (Location location : locationResult.getLocations()) {
                    if (location != null) {
                        handleLocation(location);
                    }
                }
            }
        };

        try {
            fusedLocationClient.requestLocationUpdates(locationRequest, locationCallback, Looper.getMainLooper());
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission missing, continuing with task polling", e);
        }
    }

    private void handleLocation(Location location) {
        long now = System.currentTimeMillis();
        boolean hasActiveOrder = prefs.getString("active_order_id", null) != null;
        long intervalThreshold = hasActiveOrder ? 4000 : 12000;

        if (now - lastPingTime < intervalThreshold) return;
        lastPingTime = now;

        new Thread(() -> pingServer(location)).start();
    }

    private void pingServer(Location location) {
        String token = prefs.getString("auth_token", null);
        if (token == null || token.isEmpty()) return;

        boolean isMock = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            isMock = location.isMock();
        } else {
            isMock = location.isFromMockProvider();
        }

        try {
            JSONObject json = new JSONObject();
            json.put("latitude", location.getLatitude());
            json.put("longitude", location.getLongitude());
            json.put("accuracy", location.getAccuracy());
            json.put("heading", location.getBearing());
            json.put("speed", location.getSpeed());
            json.put("is_mock", isMock);

            RequestBody body = RequestBody.create(
                    json.toString(),
                    MediaType.parse("application/json; charset=utf-8")
            );

            String serverUrl = prefs.getString("api_base", "https://driver.mybangjo.com") + "/api/v1/driver/location";
            Request request = new Request.Builder()
                    .url(serverUrl)
                    .addHeader("Authorization", "Bearer " + token)
                    .addHeader("Content-Type", "application/json")
                    .post(body)
                    .build();

            try (Response response = httpClient.newCall(request).execute()) {
                if (response.isSuccessful() && response.body() != null) {
                    String respStr = response.body().string();
                    JSONObject resJson = new JSONObject(respStr);
                    if (resJson.has("pending_assignment") && !resJson.isNull("pending_assignment")) {
                        JSONObject pending = resJson.getJSONObject("pending_assignment");
                        String orderId = pending.optString("order_id", "");
                        String orderNum = pending.optString("order_number", "");
                        String cust = pending.optString("customer_name", "Pelanggan");
                        String addr = pending.optString("destination_address", "");
                        double total = pending.optDouble("total", 0);
                        handleIncomingPendingTask(orderId, orderNum, cust, addr, total);
                    }
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "Location ping skipped: " + e.getMessage());
        }
    }

    private synchronized void handleIncomingPendingTask(String orderId, String orderNum, String customer, String address, double total) {
        if (orderId == null || orderId.isEmpty()) return;
        String lastAlerted = prefs.getString("last_alerted_order_id", "");
        if (orderId.equals(lastAlerted)) {
            return; // Already alerting for this task
        }
        prefs.edit().putString("last_alerted_order_id", orderId).apply();

        // 1. Wake up screen (same as Merchant OrderMonitorService)
        wakeUpScreen();

        // 2. Play Sound & Vibration Alarm (Looping USAGE_ALARM)
        OrderAlarmService.start(this);

        // 3. Only show Floating Order Card & System Heads-up Notification when Driver App is in background!
        // When MainActivity is in the foreground, WebView's #driver-incoming-task-modal handles the UI without overlapping.
        if (!MainActivity.isForeground) {
            String totalStr = total > 0 ? ("Rp " + String.format("%,d", (long) total).replace(',', '.')) : "";
            OrderOverlayService.showOrderCard(this, orderId, orderNum, customer, address, totalStr);
            sendHeadsUpNotification(orderId, orderNum, customer, address, totalStr);
        }
    }

    private synchronized void handleNoPendingTask() {
        String lastAlerted = prefs.getString("last_alerted_order_id", null);
        if (lastAlerted != null) {
            prefs.edit().remove("last_alerted_order_id").apply();
            OrderAlarmService.stop(this);
            dismissAlertNotification();
            if (MainActivity.isForeground) {
                OrderOverlayService.hideOverlay(this);
            } else {
                OrderOverlayService.showBall(this);
            }
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
                    "Mybangjo:DriverTaskWakeUp"
                );
                wl.acquire(60 * 1000L);
            }
        } catch (Exception ignored) {}
    }

    private void dismissAlertNotification() {
        try {
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.cancel(ALERT_NOTIFICATION_ID);
            }
        } catch (Exception ignored) {}
    }

    private void sendHeadsUpNotification(String orderId, String orderNum, String customer, String address, String totalStr) {
        try {
            Intent intent = new Intent(this, MainActivity.class);
            intent.putExtra("target_order_id", orderId);
            intent.putExtra("auto_accept", true);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                this, ALERT_NOTIFICATION_ID, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
            );

            Intent stopIntent = new Intent(this, OrderAlarmService.class);
            stopIntent.setAction(OrderAlarmService.ACTION_STOP_ALARM);
            PendingIntent stopPendingIntent = PendingIntent.getService(
                this, ALERT_NOTIFICATION_ID + 1, stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
            );

            String displayCode = (orderNum != null && !orderNum.isEmpty())
                ? (orderNum.startsWith("#") ? orderNum : "#" + orderNum)
                : ("#" + orderId);
            String subText = customer + (totalStr != null && !totalStr.isEmpty() ? (" · " + totalStr) : "")
                + (address != null && !address.isEmpty() ? (" · " + address) : "");

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ALERT_ID)
                .setContentTitle("🛵 Tugas Antar Baru! " + displayCode)
                .setContentText(subText)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setSilent(true)
                .setFullScreenIntent(pendingIntent, true)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setAutoCancel(true)
                .addAction(android.R.drawable.ic_menu_view, "Buka & Terima", pendingIntent)
                .addAction(android.R.drawable.ic_media_pause, "Hentikan Suara", stopPendingIntent);

            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.notify(ALERT_NOTIFICATION_ID, builder.build());
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to send heads-up notification", e);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopTaskPollingScheduler();
            OrderAlarmService.stop(this);
            dismissAlertNotification();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        startForegroundServiceNotification();
        startTaskPollingScheduler();
        if (!MainActivity.isForeground) {
            OrderOverlayService.showBall(this);
        } else {
            OrderOverlayService.hideOverlay(this);
        }

        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        // Keep floating ball and background polling alive when Driver App is swiped/closed!
        String token = prefs.getString("auth_token", null);
        if (token != null && !token.isEmpty()) {
            OrderOverlayService.showBall(this);
        }
    }

    @Override
    public void onDestroy() {
        stopTaskPollingScheduler();
        if (fusedLocationClient != null && locationCallback != null) {
            try { fusedLocationClient.removeLocationUpdates(locationCallback); } catch (Exception ignored) {}
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            try { wakeLock.release(); } catch (Exception ignored) {}
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
