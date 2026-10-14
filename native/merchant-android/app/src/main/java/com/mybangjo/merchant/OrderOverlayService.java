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
import android.os.IBinder;
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

        Intent intent = new Intent(context, OrderOverlayService.class);
        intent.setAction(ACTION_SHOW_BALL);
        intent.putExtra(EXTRA_PENDING_COUNT, pendingCount);
        context.startService(intent);
    }

    public static void showOrderCard(Context context, String orderId, String orderNumber, String customer, String total) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
            return;
        }
        Intent intent = new Intent(context, OrderOverlayService.class);
        intent.setAction(ACTION_SHOW_CARD);
        intent.putExtra(EXTRA_ORDER_ID, orderId);
        intent.putExtra(EXTRA_ORDER_NUMBER, orderNumber);
        intent.putExtra(EXTRA_CUSTOMER, customer);
        intent.putExtra(EXTRA_TOTAL, total);
        context.startService(intent);
    }

    public static void updateBadge(Context context, int pendingCount) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
            return;
        }
        Intent intent = new Intent(context, OrderOverlayService.class);
        intent.setAction(ACTION_UPDATE_BADGE);
        intent.putExtra(EXTRA_PENDING_COUNT, pendingCount);
        context.startService(intent);
    }

    public static void hideOverlay(Context context) {
        Intent intent = new Intent(context, OrderOverlayService.class);
        intent.setAction(ACTION_HIDE_OVERLAY);
        context.startService(intent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;

        String action = intent.getAction();
        if (ACTION_HIDE_OVERLAY.equals(action)) {
            removeOverlayView();
            currentMode = 0;
            stopSelf();
            return START_NOT_STICKY;
        }

        if (ACTION_UPDATE_BADGE.equals(action)) {
            lastPendingCount = intent.getIntExtra(EXTRA_PENDING_COUNT, 0);
            if (currentMode == 1) {
                updateBallBadge(lastPendingCount);
            }
            return START_NOT_STICKY;
        }

        if (ACTION_SHOW_CARD.equals(action)) {
            String orderId = intent.getStringExtra(EXTRA_ORDER_ID);
            String orderNumber = intent.getStringExtra(EXTRA_ORDER_NUMBER);
            String customer = intent.getStringExtra(EXTRA_CUSTOMER);
            String total = intent.getStringExtra(EXTRA_TOTAL);

            displayOrderCard(orderId, orderNumber, customer, total);
            return START_NOT_STICKY;
        }

        if (ACTION_SHOW_BALL.equals(action)) {
            lastPendingCount = intent.getIntExtra(EXTRA_PENDING_COUNT, lastPendingCount);
            displayAssistiveBall(lastPendingCount);
            return START_NOT_STICKY;
        }

        return START_NOT_STICKY;
    }

    // ── 1. ASSISTIVE BALL (Floating Icon Melayang) ──

    @SuppressLint("ClickableViewAccessibility")
    private synchronized void displayAssistiveBall(int pendingCount) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) return;

        // If assistive ball is already attached to WindowManager, DO NOT add another view! Just update badge.
        if (currentOverlayView != null && currentMode == 1) {
            try {
                if (currentOverlayView.isAttachedToWindow()) {
                    updateBallBadge(pendingCount);
                    return;
                }
            } catch (Exception ignored) {}
        }

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
        params.x = dp(12);
        params.y = dp(160);

        currentOverlayView = createBallView(pendingCount);
        attachBallDragger(currentOverlayView);

        try {
            windowManager.addView(currentOverlayView, params);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private View createBallView(int pendingCount) {
        FrameLayout root = new FrameLayout(this);
        root.setPadding(dp(6), dp(6), dp(6), dp(6));

        // Circular background
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(Color.parseColor("#0f172a")); // Dark Slate
        bg.setStroke(dp(2.5f), Color.parseColor("#059669")); // Emerald green accent
        bg.setSize(dp(54), dp(54));

        FrameLayout ball = new FrameLayout(this);
        ball.setBackground(bg);
        ball.setLayoutParams(new FrameLayout.LayoutParams(dp(54), dp(54)));

        // App Icon inside the ball
        ImageView iconView = new ImageView(this);
        iconView.setImageResource(R.mipmap.ic_launcher_round);
        int iconPadding = dp(7);
        iconView.setPadding(iconPadding, iconPadding, iconPadding, iconPadding);
        FrameLayout.LayoutParams iconLp = new FrameLayout.LayoutParams(dp(54), dp(54));
        iconLp.gravity = Gravity.CENTER;
        ball.addView(iconView, iconLp);

        // Badge Counter (Red dot or number)
        TextView badgeTv = new TextView(this);
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

        FrameLayout.LayoutParams badgeLp = new FrameLayout.LayoutParams(dp(20), dp(20));
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

    private void updateBallBadge(int pendingCount) {
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
    private void attachBallDragger(View view) {
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
                        if (currentOverlayView != null && currentOverlayView.isAttachedToWindow()) {
                            windowManager.updateViewLayout(currentOverlayView, params);
                        }
                        return true;

                    case MotionEvent.ACTION_UP:
                        long duration = System.currentTimeMillis() - touchStartTime;
                        float diffX = Math.abs(event.getRawX() - initialTouchX);
                        float diffY = Math.abs(event.getRawY() - initialTouchY);

                        // Tap detection: short touch without much movement
                        if (duration < 250 && diffX < dp(10) && diffY < dp(10)) {
                            openMainActivity();
                            return true;
                        }

                        // Drag finished: Snap to left or right screen edge
                        DisplayMetrics dm = getResources().getDisplayMetrics();
                        int screenWidth = dm.widthPixels;
                        if (params.x + dp(27) < screenWidth / 2) {
                            params.x = dp(8);
                        } else {
                            params.x = screenWidth - dp(62);
                        }
                        if (currentOverlayView != null && currentOverlayView.isAttachedToWindow()) {
                            windowManager.updateViewLayout(currentOverlayView, params);
                        }
                        return true;
                }
                return false;
            }
        });
    }

    // ── 2. ORDER CARD POPUP (Kartu Peringatan Pesanan Masuk) ──

    @SuppressLint("ClickableViewAccessibility")
    private void displayOrderCard(String orderId, String orderNumber, String customer, String total) {
        removeOverlayView();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) return;

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
        params.y = dp(100);

        currentOverlayView = createOrderCardView(orderId, orderNumber, customer, total);
        attachCardDragger(currentOverlayView);

        try {
            windowManager.addView(currentOverlayView, params);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private View createOrderCardView(String orderId, String orderNumber, String customer, String total) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(16), dp(14), dp(16), dp(14));

        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#0f172a")); // Dark Slate
        bg.setCornerRadius(dp(18));
        bg.setStroke(dp(2), Color.parseColor("#10b981")); // Emerald border
        root.setBackground(bg);

        // Header: Icon + Title
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);

        TextView iconTv = new TextView(this);
        iconTv.setText("🛍️ ");
        iconTv.setTextSize(18);
        header.addView(iconTv);

        TextView titleTv = new TextView(this);
        titleTv.setText("Pesanan Baru Masuk!");
        titleTv.setTextColor(Color.parseColor("#ffffff"));
        titleTv.setTextSize(15);
        titleTv.setTypeface(null, android.graphics.Typeface.BOLD);
        header.addView(titleTv);

        root.addView(header);

        // Body: Customer + Total
        TextView bodyTv = new TextView(this);
        String displayNum = (orderNumber != null && !orderNumber.isEmpty()) ? ("#" + orderNumber) : ("#" + (orderId != null ? orderId.substring(Math.max(0, orderId.length() - 6)) : ""));
        String displayCust = (customer != null && !customer.isEmpty()) ? customer : "Pelanggan";
        String displayTot = (total != null && !total.isEmpty()) ? total : "";
        bodyTv.setText(displayNum + " · " + displayCust + (displayTot.isEmpty() ? "" : ("\n" + displayTot)));
        bodyTv.setTextColor(Color.parseColor("#cbd5e1"));
        bodyTv.setTextSize(13);
        bodyTv.setPadding(0, dp(6), 0, dp(12));
        root.addView(bodyTv);

        // Action Buttons Row
        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        btnRow.setGravity(Gravity.CENTER_VERTICAL);

        Button btnOpen = new Button(this);
        btnOpen.setText("Buka Kasir");
        btnOpen.setTextColor(Color.parseColor("#ffffff"));
        btnOpen.setTextSize(13);
        btnOpen.setTypeface(null, android.graphics.Typeface.BOLD);
        GradientDrawable openBg = new GradientDrawable();
        openBg.setColor(Color.parseColor("#059669"));
        openBg.setCornerRadius(dp(10));
        btnOpen.setBackground(openBg);
        btnOpen.setPadding(dp(16), dp(8), dp(16), dp(8));
        btnOpen.setOnClickListener(v -> {
            OrderAlarmService.stopAlarm(this);
            openMainActivity();
            if (isAssistiveBallEnabled(this)) {
                displayAssistiveBall(0);
            } else {
                removeOverlayView();
                stopSelf();
            }
        });
        btnRow.addView(btnOpen);

        View spacer = new View(this);
        LinearLayout.LayoutParams spacerLp = new LinearLayout.LayoutParams(dp(10), 1);
        spacer.setLayoutParams(spacerLp);
        btnRow.addView(spacer);

        Button btnDismiss = new Button(this);
        btnDismiss.setText("Tutup");
        btnDismiss.setTextColor(Color.parseColor("#94a3b8"));
        btnDismiss.setTextSize(13);
        GradientDrawable dismissBg = new GradientDrawable();
        dismissBg.setColor(Color.parseColor("#1e293b"));
        dismissBg.setCornerRadius(dp(10));
        btnDismiss.setBackground(dismissBg);
        btnDismiss.setPadding(dp(12), dp(8), dp(12), dp(8));
        btnDismiss.setOnClickListener(v -> {
            OrderAlarmService.stopAlarm(this);
            if (isAssistiveBallEnabled(this)) {
                displayAssistiveBall(lastPendingCount);
            } else {
                removeOverlayView();
                stopSelf();
            }
        });
        btnRow.addView(btnDismiss);

        root.addView(btnRow);
        return root;
    }

    @SuppressLint("ClickableViewAccessibility")
    private void attachCardDragger(View view) {
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
                        if (currentOverlayView != null && currentOverlayView.isAttachedToWindow()) {
                            windowManager.updateViewLayout(currentOverlayView, params);
                        }
                        return true;
                }
                return false;
            }
        });
    }

    private void openMainActivity() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(intent);
    }

    private static synchronized void removeOverlayView() {
        if (currentOverlayView != null) {
            try {
                if (windowManager != null && currentOverlayView.isAttachedToWindow()) {
                    windowManager.removeView(currentOverlayView);
                }
            } catch (Exception ignored) {}
            currentOverlayView = null;
        }
    }

    private int dp(float value) {
        float density = getResources().getDisplayMetrics().density;
        return Math.round(value * density);
    }

    @Override
    public void onDestroy() {
        removeOverlayView();
        super.onDestroy();
    }
}
