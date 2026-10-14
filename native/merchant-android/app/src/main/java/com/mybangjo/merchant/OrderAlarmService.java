package com.mybangjo.merchant;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

public class OrderAlarmService extends Service {
    private static final String CHANNEL_ID = "channel_orders_alarm_v1";
    private static final int NOTIF_ID = 9119;
    public static final String ACTION_START_ALARM = "com.mybangjo.merchant.ACTION_START_ALARM";
    public static final String ACTION_STOP_ALARM = "com.mybangjo.merchant.ACTION_STOP_ALARM";

    private MediaPlayer mediaPlayer;
    private PowerManager.WakeLock wakeLock;

    public static void startAlarm(Context context) {
        Intent intent = new Intent(context, OrderAlarmService.class);
        intent.setAction(ACTION_START_ALARM);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    public static void stopAlarm(Context context) {
        Intent intent = new Intent(context, OrderAlarmService.class);
        intent.setAction(ACTION_STOP_ALARM);
        context.startService(intent);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP_ALARM.equals(intent.getAction())) {
            stopAudioAndRelease();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        startForeground(NOTIF_ID, buildForegroundNotification());
        acquireScreenWakeLock();
        startAggressiveAudioLoop();

        return START_NOT_STICKY;
    }

    private void acquireScreenWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && (wakeLock == null || !wakeLock.isHeld())) {
                wakeLock = pm.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK |
                    PowerManager.ACQUIRE_CAUSES_WAKEUP |
                    PowerManager.ON_AFTER_RELEASE,
                    "Mybangjo:OrderAlarmWakeLock"
                );
                wakeLock.acquire(120 * 1000L); // Max 2 minutes lock
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void startAggressiveAudioLoop() {
        try {
            if (mediaPlayer != null) {
                if (mediaPlayer.isPlaying()) return;
                mediaPlayer.release();
            }

            mediaPlayer = MediaPlayer.create(this, R.raw.ada_pesanan_baru);
            if (mediaPlayer != null) {
                mediaPlayer.setAudioAttributes(
                    new AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .build()
                );
                mediaPlayer.setLooping(true);
                mediaPlayer.setVolume(1.0f, 1.0f);
                mediaPlayer.start();
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void stopAudioAndRelease() {
        try {
            if (mediaPlayer != null) {
                if (mediaPlayer.isPlaying()) {
                    mediaPlayer.stop();
                }
                mediaPlayer.release();
                mediaPlayer = null;
            }
        } catch (Exception e) {
            e.printStackTrace();
        }

        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                wakeLock = null;
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notification_channel_orders),
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription(getString(R.string.notification_channel_orders_desc));
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 500, 250, 500, 250, 1000, 250, 1000});
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildForegroundNotification() {
        Intent openAppIntent = new Intent(this, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentPendingIntent = PendingIntent.getActivity(
            this, 0, openAppIntent,
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0
        );

        Intent stopIntent = new Intent(this, OrderAlarmService.class);
        stopIntent.setAction(ACTION_STOP_ALARM);
        PendingIntent stopPendingIntent = PendingIntent.getService(
            this, 1, stopIntent,
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("🔔 Ada Pesanan Baru Masuk!")
            .setContentText("Pesanan memerlukan konfirmasi segera. Ketuk untuk membuka.")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(contentPendingIntent)
            .addAction(android.R.drawable.ic_media_pause, "Hentikan Alarm", stopPendingIntent)
            .build();
    }

    @Override
    public void onDestroy() {
        stopAudioAndRelease();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
