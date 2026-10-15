package com.mybangjo.merchant;

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
    public static final String ACTION_SHOW_BALL = "com.mybangjo.merchant.ACTION_SHOW_BALL";
    public static final String ACTION_SHOW_CARD = "com.mybangjo.merchant.ACTION_SHOW_CARD";
    public static final String ACTION_UPDATE_BADGE = "com.mybangjo.merchant.ACTION_UPDATE_BADGE";
    public static final String ACTION_HIDE_OVERLAY = "com.mybangjo.merchant.ACTION_HIDE_OVERLAY";

    public static final String EXTRA_ORDER_ID = "extra_order_id";
    public static final String EXTRA_ORDER_NUMBER = "extra_order_number";
    public static final String EXTRA_CUSTOMER = "extra_customer";
    public static final String EXTRA_TOTAL = "extra_total";
    public static final String EXTRA_PENDING_COUNT = "extra_pending_count";

    private static final String PREFS_NAME = "xentra_merchant_prefs";
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
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_STICKY;

        String action = intent.getAction();
        if (ACTION_HIDE_OVERLAY.equals(action)) {
            hideOverlay(this);
            return START_STICKY;
        }

        if (ACTION_UPDATE_BADGE.equals(action)) {
            int count = intent.getIntExtra(EXTRA_PENDING_COUNT, 0);
            updateBadge(this, count);
            return START_STICKY;
        }

        if (ACTION_SHOW_CARD.equals(action)) {
            String orderId = intent.getStringExtra(EXTRA_ORDER_ID);
            String orderNumber = intent.getStringExtra(EXTRA_ORDER_NUMBER);
            String customer = intent.getStringExtra(EXTRA_CUSTOMER);
            String total = intent.getStringExtra(EXTRA_TOTAL);
            showOrderCard(this, orderId, orderNumber, customer, total);
            return START_STICKY;
        }

        if (ACTION_SHOW_BALL.equals(action)) {
            int count = intent.getIntExtra(EXTRA_PENDING_COUNT, lastPendingCount);
            showBall(this, count);
            return START_STICKY;
        }

        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        // Persist the floating icon when app is cleared from recents
        if (isAssistiveBallEnabled(this)) {
            showBall(this, lastPendingCount);
        }
    }

    // ── 1. ASSISTIVE BALL (Floating Icon Melayang) ──

    @SuppressLint("ClickableViewAccessibility")
    private static synchronized void displayAssistiveBall(Context context, int pendingCount) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) return;
        if (!isAssistiveBallEnabled(context)) return;

        Context appContext = context.getApplicationContext();
        if (windowManager == null) {
            windowManager = (WindowManager) appContext.getSystemService(Context.WINDOW_SERVICE);
        }

        lastPendingCount = pendingCount;

        // If assistive ball is already active, NEVER add a second view! Just update badge and return.
        if (currentOverlayView != null && currentMode == 1) {
            updateBallBadge(pendingCount);
            return;
        }

        // Clean up any existing overlay view (e.g. order card) before adding ball
        removeOverlayView();

        currentMode = 1;
        int layoutType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;

        params = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        );

        params.gravity = Gravity.TOP | Gravity.START;
        params.x = dp(appContext, 12);
        params.y = dp(appContext, 160);

        currentOverlayView = createBallView(appContext, pendingCount);
        attachBallDragger(appContext, currentOverlayView);

        try {
            windowManager.addView(currentOverlayView, params);
        } catch (Exception e) {
            e.printStackTrace();
            currentOverlayView = null;
            currentMode = 0;
        }
    }

    private static View createBallView(Context context, int pendingCount) {
        FrameLayout root = new FrameLayout(context);
        root.setPadding(dp(context, 6), dp(context, 6), dp(context, 6), dp(context, 6));

        // Circular background
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(Color.parseColor("#0f172a")); // Dark Slate
        bg.setStroke(dp(context, 2.5f), Color.parseColor("#059669")); // Emerald green accent
        bg.setSize(dp(context, 54), dp(context, 54));

        FrameLayout ball = new FrameLayout(context);
        ball.setBackground(bg);
        ball.setLayoutParams(new FrameLayout.LayoutParams(dp(context, 54), dp(context, 54)));

        // App Icon inside the ball
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

                        // Tap detection: short touch without much movement
                        if (duration < 250 && diffX < dp(context, 10) && diffY < dp(context, 10)) {
                            openMainActivity(context);
                            return true;
                        }

                        // Drag finished: Snap to left or right screen edge
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

        currentMode = 2;
        int layoutType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;

        params = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN |
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
            PixelFormat.TRANSLUCENT
        );

        params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        params.x = 0;
        params.y = dp(appContext, 100);

        currentOverlayView = createOrderCardView(appContext, orderId, orderNumber, customer, total);
        attachCardDragger(appContext, currentOverlayView);

        try {
            windowManager.addView(currentOverlayView, params);
        } catch (Exception e) {
            e.printStackTrace();
            currentOverlayView = null;
            currentMode = 0;
        }
    }

    private static View createOrderCardView(Context context, String orderId, String orderNumber, String customer, String total) {
        LinearLayout root = new LinearLayout(context);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(context, 16), dp(context, 14), dp(context, 16), dp(context, 14));

        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#0f172a")); // Dark Slate
        bg.setCornerRadius(dp(context, 18));
        bg.setStroke(dp(context, 2), Color.parseColor("#10b981")); // Emerald border
        root.setBackground(bg);

        // Header: Icon + Title
        LinearLayout header = new LinearLayout(context);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);

        TextView iconTv = new TextView(context);
        iconTv.setText("🛍️ ");
        iconTv.setTextSize(18);
        header.addView(iconTv);

        TextView titleTv = new TextView(context);
        titleTv.setText("Pesanan Baru Masuk!");
        titleTv.setTextColor(Color.parseColor("#ffffff"));
        titleTv.setTextSize(15);
        titleTv.setTypeface(null, android.graphics.Typeface.BOLD);
        header.addView(titleTv);

        root.addView(header);

        // Body: Customer + Total
        TextView bodyTv = new TextView(context);
        String displayNum;
        if (orderNumber != null && !orderNumber.trim().isEmpty()) {
            String trimmed = orderNumber.trim();
            displayNum = trimmed.startsWith("#") ? trimmed : ("#" + trimmed);
        } else if (orderId != null && !orderId.trim().isEmpty()) {
            String digits = orderId.replaceAll("\\D", "");
            String num = digits.length() >= 3 ? digits.substring(digits.length() - 3) : "100";
            displayNum = "#OD-" + num;
        } else {
            displayNum = "#OD-100";
        }
        String displayCust = (customer != null && !customer.isEmpty()) ? customer : "Pelanggan";
        String displayTot = (total != null && !total.isEmpty()) ? total : "";
        bodyTv.setText(displayNum + " · " + displayCust + (displayTot.isEmpty() ? "" : ("\n" + displayTot)));
        bodyTv.setTextColor(Color.parseColor("#cbd5e1"));
        bodyTv.setTextSize(13);
        bodyTv.setPadding(0, dp(context, 6), 0, dp(context, 12));
        root.addView(bodyTv);

        // Action Buttons Row
        LinearLayout btnRow = new LinearLayout(context);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        btnRow.setGravity(Gravity.CENTER_VERTICAL);

        Button btnOpen = new Button(context);
        btnOpen.setText("Buka Kasir");
        btnOpen.setTextColor(Color.parseColor("#ffffff"));
        btnOpen.setTextSize(13);
        btnOpen.setTypeface(null, android.graphics.Typeface.BOLD);
        GradientDrawable openBg = new GradientDrawable();
        openBg.setColor(Color.parseColor("#059669"));
        openBg.setCornerRadius(dp(context, 10));
        btnOpen.setBackground(openBg);
        btnOpen.setPadding(dp(context, 16), dp(context, 8), dp(context, 16), dp(context, 8));
        btnOpen.setOnClickListener(v -> {
            OrderAlarmService.stopAlarm(context);
            openMainActivity(context);
            if (isAssistiveBallEnabled(context)) {
                displayAssistiveBall(context, 0);
            } else {
                removeOverlayView();
            }
        });
        btnRow.addView(btnOpen);

        View spacer = new View(context);
        LinearLayout.LayoutParams spacerLp = new LinearLayout.LayoutParams(dp(context, 10), 1);
        spacer.setLayoutParams(spacerLp);
        btnRow.addView(spacer);

        Button btnDismiss = new Button(context);
        btnDismiss.setText("Tutup");
        btnDismiss.setTextColor(Color.parseColor("#94a3b8"));
        btnDismiss.setTextSize(13);
        GradientDrawable dismissBg = new GradientDrawable();
        dismissBg.setColor(Color.parseColor("#1e293b"));
        dismissBg.setCornerRadius(dp(context, 10));
        btnDismiss.setBackground(dismissBg);
        btnDismiss.setPadding(dp(context, 12), dp(context, 8), dp(context, 12), dp(context, 8));
        btnDismiss.setOnClickListener(v -> {
            OrderAlarmService.stopAlarm(context);
            if (isAssistiveBallEnabled(context)) {
                displayAssistiveBall(context, lastPendingCount);
            } else {
                removeOverlayView();
            }
        });
        btnRow.addView(btnDismiss);

        root.addView(btnRow);
        return root;
    }

    @SuppressLint("ClickableViewAccessibility")
    private static void attachCardDragger(Context context, View view) {
        view.setOnTouchListener(new View.OnTouchListener() {
            private int initialX, initialY;
            private float initialTouchX, initialTouchY;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        initialX = params.x;
                        initialY = params.y;
                        initialTouchX = event.getRawX();
                        initialTouchY = event.getRawY();
                        return false;
                    case MotionEvent.ACTION_MOVE:
                        params.x = initialX + (int) (event.getRawX() - initialTouchX);
                        params.y = initialY + (int) (event.getRawY() - initialTouchY);
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
        float density = context.getResources().getDisplayMetrics().density;
        return Math.round(value * density);
    }

    @Override
    public void onDestroy() {
        // Do NOT remove overlay view on service reclaim if user wants the assistive ball visible 24/7
        if (!isAssistiveBallEnabled(this)) {
            removeOverlayView();
        }
        super.onDestroy();
    }
}
