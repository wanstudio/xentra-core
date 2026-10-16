package com.mybangjo.owner;

import android.annotation.SuppressLint;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

public class OrderOverlayService extends Service {
    public static final String ACTION_SHOW_BALL = "com.mybangjo.owner.ACTION_SHOW_BALL";
    public static final String ACTION_SHOW_CARD = "com.mybangjo.owner.ACTION_SHOW_CARD";
    public static final String ACTION_UPDATE_BADGE = "com.mybangjo.owner.ACTION_UPDATE_BADGE";
    public static final String ACTION_HIDE_OVERLAY = "com.mybangjo.owner.ACTION_HIDE_OVERLAY";

    public static final String EXTRA_ORDER_ID = "extra_order_id";
    public static final String EXTRA_ORDER_NUMBER = "extra_order_number";
    public static final String EXTRA_CUSTOMER = "extra_customer";
    public static final String EXTRA_TOTAL = "extra_total";
    public static final String EXTRA_PENDING_COUNT = "extra_pending_count";

    private static final String PREFS_NAME = "xentra_pos_prefs";
    private static final String KEY_ASSISTIVE_BALL_ENABLED = "assistive_ball_enabled";

    private static final Handler mainHandler = new Handler(Looper.getMainLooper());
    private static WindowManager windowManager;
    private static View currentOverlayView;
    private static WindowManager.LayoutParams params;
    private static int currentMode = 0; // 0 = none, 1 = ball, 2 = card
    private static int lastPendingCount = 0;

    public static boolean isAssistiveBallEnabled(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getBoolean(KEY_ASSISTIVE_BALL_ENABLED, true);
    }

    public static void setAssistiveBallEnabled(Context context, boolean enabled) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(KEY_ASSISTIVE_BALL_ENABLED, enabled).apply();
        if (enabled) {
            showBall(context, 0);
        } else {
            hideOverlay(context);
        }
    }

    public static void showBall(Context context, int pendingCount) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
            return;
        }
        if (!isAssistiveBallEnabled(context)) return;

        Context appContext = context.getApplicationContext();
        mainHandler.post(() -> displayAssistiveBall(appContext, pendingCount));
    }

    public static void showOrderCard(Context context, String orderId, String orderNumber, String customer, String total) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
            return;
        }
        Context appContext = context.getApplicationContext();
        mainHandler.post(() -> displayOrderCard(appContext, orderId, orderNumber, customer, total));
    }

    public static void updateBadge(Context context, int pendingCount) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
            return;
        }
        if (!isAssistiveBallEnabled(context)) return;

        Context appContext = context.getApplicationContext();
        mainHandler.post(() -> {
            lastPendingCount = pendingCount;
            if (currentMode == 1 && currentOverlayView != null) {
                updateBallBadge(lastPendingCount);
            } else if (currentMode == 0 && isAssistiveBallEnabled(appContext)) {
                displayAssistiveBall(appContext, lastPendingCount);
            }
        });
    }

    public static void hideOverlay(Context context) {
        mainHandler.post(() -> {
            removeOverlayView();
            currentMode = 0;
        });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) return START_STICKY;

        switch (intent.getAction()) {
            case ACTION_SHOW_BALL:
                int count = intent.getIntExtra(EXTRA_PENDING_COUNT, 0);
                showBall(this, count);
                break;
            case ACTION_SHOW_CARD:
                String oid = intent.getStringExtra(EXTRA_ORDER_ID);
                String onum = intent.getStringExtra(EXTRA_ORDER_NUMBER);
                String cust = intent.getStringExtra(EXTRA_CUSTOMER);
                String tot = intent.getStringExtra(EXTRA_TOTAL);
                showOrderCard(this, oid, onum, cust, tot);
                break;
            case ACTION_UPDATE_BADGE:
                int pCount = intent.getIntExtra(EXTRA_PENDING_COUNT, 0);
                updateBadge(this, pCount);
                break;
            case ACTION_HIDE_OVERLAY:
                hideOverlay(this);
                break;
        }
        return START_STICKY;
    }

    // ── 1. ASSISTIVE FLOATING BALL (Bola Melayang 24/7) ──

    private static synchronized void displayAssistiveBall(Context context, int pendingCount) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) return;
        if (!isAssistiveBallEnabled(context)) return;

        Context appContext = context.getApplicationContext();
        if (windowManager == null) {
            windowManager = (WindowManager) appContext.getSystemService(Context.WINDOW_SERVICE);
        }

        lastPendingCount = pendingCount;

        if (currentMode == 1 && currentOverlayView != null) {
            updateBallBadge(pendingCount);
            return;
        }

        removeOverlayView();

        int overlayType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;

        params = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        );

        params.gravity = Gravity.TOP | Gravity.START;
        params.x = dp(appContext, 12);
        params.y = dp(appContext, 180);

        currentOverlayView = buildBallView(appContext, pendingCount);
        attachBallDragger(appContext, currentOverlayView);

        try {
            windowManager.addView(currentOverlayView, params);
            currentMode = 1;
        } catch (Exception e) {
            currentOverlayView = null;
            currentMode = 0;
        }
    }

    private static View buildBallView(Context context, int pendingCount) {
        FrameLayout root = new FrameLayout(context);
        root.setPadding(dp(context, 6), dp(context, 6), dp(context, 6), dp(context, 6));

        // Circular background (Dark Slate with Owner Slate Metal accent)
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(Color.parseColor("#0f172a")); // Dark Slate
        bg.setStroke(dp(context, 2.5f), Color.parseColor("#64748b")); // Owner Slate Metal accent
        bg.setSize(dp(context, 54), dp(context, 54));

        FrameLayout ball = new FrameLayout(context);
        ball.setBackground(bg);
        ball.setLayoutParams(new FrameLayout.LayoutParams(dp(context, 54), dp(context, 54)));

        // App Icon inside the ball (Proportional round launcher icon with 7dp padding)
        ImageView iconView = new ImageView(context);
        iconView.setImageResource(R.mipmap.ic_launcher_round);
        int iconPadding = dp(context, 7);
        iconView.setPadding(iconPadding, iconPadding, iconPadding, iconPadding);
        FrameLayout.LayoutParams iconLp = new FrameLayout.LayoutParams(dp(context, 54), dp(context, 54));
        iconLp.gravity = Gravity.CENTER;
        ball.addView(iconView, iconLp);

        // Badge Counter (Red dot or number)
        TextView badgeTv = new TextView(context);
        badgeTv.setId(View.generateViewId());
        badgeTv.setTag("badge_count");
        badgeTv.setTextSize(10.5f);
        badgeTv.setTextColor(Color.WHITE);
        badgeTv.setTypeface(null, android.graphics.Typeface.BOLD);
        badgeTv.setGravity(Gravity.CENTER);

        GradientDrawable badgeBg = new GradientDrawable();
        badgeBg.setShape(GradientDrawable.OVAL);
        badgeBg.setColor(Color.parseColor("#ef4444")); // Crimson Red
        badgeTv.setBackground(badgeBg);

        FrameLayout.LayoutParams badgeLp = new FrameLayout.LayoutParams(dp(context, 20), dp(context, 20));
        badgeLp.gravity = Gravity.TOP | Gravity.END;
        badgeTv.setLayoutParams(badgeLp);

        if (pendingCount > 0) {
            badgeTv.setText(pendingCount > 9 ? "9+" : String.valueOf(pendingCount));
            badgeTv.setVisibility(View.VISIBLE);
        } else {
            badgeTv.setVisibility(View.GONE);
        }

        ball.addView(badgeTv);
        root.addView(ball);
        return root;
    }

    private static void updateBallBadge(int pendingCount) {
        if (currentOverlayView == null) return;
        TextView badgeTv = currentOverlayView.findViewWithTag("badge_count");
        if (badgeTv != null) {
            if (pendingCount > 0) {
                badgeTv.setText(pendingCount > 9 ? "9+" : String.valueOf(pendingCount));
                badgeTv.setVisibility(View.VISIBLE);
            } else {
                badgeTv.setVisibility(View.GONE);
            }
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private static void attachBallDragger(Context context, View view) {
        view.setOnTouchListener(new View.OnTouchListener() {
            private int initialX, initialY;
            private float initialTouchX, initialTouchY;
            private long touchStartTime;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        touchStartTime = System.currentTimeMillis();
                        initialX = params.x;
                        initialY = params.y;
                        initialTouchX = event.getRawX();
                        initialTouchY = event.getRawY();
                        return true;

                    case MotionEvent.ACTION_MOVE:
                        params.x = initialX + (int) (event.getRawX() - initialTouchX);
                        params.y = initialY + (int) (event.getRawY() - initialTouchY);
                        if (currentOverlayView != null && windowManager != null) {
                            try {
                                windowManager.updateViewLayout(currentOverlayView, params);
                            } catch (Exception ignored) {}
                        }
                        return true;

                    case MotionEvent.ACTION_UP:
                        long duration = System.currentTimeMillis() - touchStartTime;
                        float diffX = Math.abs(event.getRawX() - initialTouchX);
                        float diffY = Math.abs(event.getRawY() - initialTouchY);

                        if (duration < 250 && diffX < dp(context, 10) && diffY < dp(context, 10)) {
                            openMainActivity(context);
                            return true;
                        }

                        DisplayMetrics dm = context.getResources().getDisplayMetrics();
                        int screenWidth = dm.widthPixels;
                        if (params.x + dp(context, 27) < screenWidth / 2) {
                            params.x = dp(context, 8);
                        } else {
                            params.x = screenWidth - dp(context, 62);
                        }
                        if (currentOverlayView != null && windowManager != null) {
                            try {
                                windowManager.updateViewLayout(currentOverlayView, params);
                            } catch (Exception ignored) {}
                        }
                        return true;
                }
                return false;
            }
        });
    }

    // ── 2. ORDER CARD POPUP (Kartu Peringatan Pesanan Masuk) ──

    @SuppressLint("ClickableViewAccessibility")
    private static synchronized void displayOrderCard(Context context, String orderId, String orderNumber, String customer, String total) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) return;

        Context appContext = context.getApplicationContext();
        if (windowManager == null) {
            windowManager = (WindowManager) appContext.getSystemService(Context.WINDOW_SERVICE);
        }

        removeOverlayView();

        int overlayType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;

        params = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL |
            WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
            PixelFormat.TRANSLUCENT
        );

        params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        params.y = dp(appContext, 36);

        currentOverlayView = buildCardView(appContext, orderId, orderNumber, customer, total);

        try {
            windowManager.addView(currentOverlayView, params);
            currentMode = 2;
        } catch (Exception e) {
            currentOverlayView = null;
            currentMode = 0;
        }
    }

    private static View buildCardView(Context context, String orderId, String orderNumber, String customer, String total) {
        FrameLayout wrapper = new FrameLayout(context);
        int margin = dp(context, 14);
        wrapper.setPadding(margin, 0, margin, 0);

        LinearLayout card = new LinearLayout(context);
        card.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(context, 16);
        card.setPadding(pad, pad, pad, pad);

        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.RECTANGLE);
        bg.setCornerRadius(dp(context, 16));
        bg.setColor(Color.WHITE);
        bg.setStroke(dp(context, 1.5f), Color.parseColor("#059669"));
        card.setBackground(bg);
        card.setElevation(dp(context, 12));

        // Header
        LinearLayout header = new LinearLayout(context);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);

        TextView iconTv = new TextView(context);
        iconTv.setText("🔔 ");
        iconTv.setTextSize(18f);
        header.addView(iconTv);

        TextView titleTv = new TextView(context);
        titleTv.setText("Pesanan Baru Masuk!");
        titleTv.setTextSize(16f);
        titleTv.setTypeface(null, android.graphics.Typeface.BOLD);
        titleTv.setTextColor(Color.parseColor("#111827"));
        LinearLayout.LayoutParams tLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        header.addView(titleTv, tLp);

        TextView closeBtn = new TextView(context);
        closeBtn.setText("✕");
        closeBtn.setTextSize(18f);
        closeBtn.setTextColor(Color.parseColor("#9CA3AF"));
        closeBtn.setPadding(dp(context, 8), 0, dp(context, 4), 0);
        closeBtn.setOnClickListener(v -> {
            OrderAlarmService.stopAlarm(context);
            if (isAssistiveBallEnabled(context)) {
                showBall(context, lastPendingCount);
            } else {
                hideOverlay(context);
            }
        });
        header.addView(closeBtn);
        card.addView(header);

        // Details
        TextView infoTv = new TextView(context);
        infoTv.setTextSize(14f);
        infoTv.setTextColor(Color.parseColor("#4B5563"));
        infoTv.setPadding(0, dp(context, 8), 0, dp(context, 12));

        String num = (orderNumber != null && !orderNumber.isEmpty()) ? orderNumber : "#" + orderId;
        String cust = (customer != null && !customer.isEmpty()) ? customer : "Pelanggan";
        String tot = (total != null && !total.isEmpty()) ? (" · " + total) : "";
        infoTv.setText(num + " · " + cust + tot);
        card.addView(infoTv);

        // Action Buttons
        LinearLayout btnBar = new LinearLayout(context);
        btnBar.setOrientation(LinearLayout.HORIZONTAL);

        Button silenceBtn = new Button(context);
        silenceBtn.setText("Matikan Suara");
        silenceBtn.setTextSize(13f);
        silenceBtn.setTextColor(Color.parseColor("#4B5563"));
        GradientDrawable sBg = new GradientDrawable();
        sBg.setColor(Color.parseColor("#F3F4F6"));
        sBg.setCornerRadius(dp(context, 10));
        silenceBtn.setBackground(sBg);
        LinearLayout.LayoutParams sLp = new LinearLayout.LayoutParams(0, dp(context, 44), 1f);
        sLp.setMarginEnd(dp(context, 8));
        silenceBtn.setLayoutParams(sLp);
        silenceBtn.setOnClickListener(v -> {
            OrderAlarmService.stopAlarm(context);
            if (isAssistiveBallEnabled(context)) {
                showBall(context, lastPendingCount);
            } else {
                hideOverlay(context);
            }
        });
        btnBar.addView(silenceBtn);

        Button openBtn = new Button(context);
        openBtn.setText("Buka Kasir");
        openBtn.setTextSize(13f);
        openBtn.setTextColor(Color.WHITE);
        openBtn.setTypeface(null, android.graphics.Typeface.BOLD);
        GradientDrawable oBg = new GradientDrawable();
        oBg.setColor(Color.parseColor("#059669"));
        oBg.setCornerRadius(dp(context, 10));
        openBtn.setBackground(oBg);
        LinearLayout.LayoutParams oLp = new LinearLayout.LayoutParams(0, dp(context, 44), 1.2f);
        openBtn.setLayoutParams(oLp);
        openBtn.setOnClickListener(v -> {
            OrderAlarmService.stopAlarm(context);
            if (isAssistiveBallEnabled(context)) {
                showBall(context, 0);
            } else {
                hideOverlay(context);
            }
            openMainActivity(context);
        });
        btnBar.addView(openBtn);

        card.addView(btnBar);
        wrapper.addView(card);
        return wrapper;
    }

    private static void openMainActivity(Context context) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        context.startActivity(intent);
    }

    private static synchronized void removeOverlayView() {
        if (currentOverlayView != null) {
            if (windowManager != null) {
                try {
                    windowManager.removeViewImmediate(currentOverlayView);
                } catch (Exception e1) {
                    try {
                        windowManager.removeView(currentOverlayView);
                    } catch (Exception ignored) {}
                }
            }
            currentOverlayView = null;
            currentMode = 0;
        }
    }

    private static int dp(Context context, float value) {
        return (int) (value * context.getResources().getDisplayMetrics().density + 0.5f);
    }

    @Override
    public void onDestroy() {
        removeOverlayView();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
