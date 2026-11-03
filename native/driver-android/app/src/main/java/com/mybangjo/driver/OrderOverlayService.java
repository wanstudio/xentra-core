package com.mybangjo.driver;

import android.annotation.SuppressLint;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;

public class OrderOverlayService extends Service {
    public static final String ACTION_SHOW_BALL = "com.mybangjo.driver.ACTION_SHOW_BALL";
    public static final String ACTION_SHOW_CARD = "com.mybangjo.driver.ACTION_SHOW_CARD";
    public static final String ACTION_HIDE_OVERLAY = "com.mybangjo.driver.ACTION_HIDE_OVERLAY";

    public static final String EXTRA_ORDER_ID = "extra_order_id";
    public static final String EXTRA_ORDER_NUMBER = "extra_order_number";
    public static final String EXTRA_CUSTOMER = "extra_customer";
    public static final String EXTRA_ADDRESS = "extra_address";
    public static final String EXTRA_TOTAL = "extra_total";

    private static final Handler mainHandler = new Handler(Looper.getMainLooper());
    private static WindowManager windowManager;
    private static View currentOverlayView;
    private static WindowManager.LayoutParams params;
    private static int currentMode = 0; // 0 = none, 1 = ball, 2 = card

    // ── Public Static Triggers (Usable from anywhere: Service, Activity, Bridge) ──

    public static void showOrderCard(Context context, String orderId, String orderNumber, String customer, String address, String total) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
            return;
        }
        Context appContext = context.getApplicationContext();
        mainHandler.post(() -> displayOrderCard(appContext, orderId, orderNumber, customer, address, total));
    }

    public static void showBall(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
            return;
        }
        Context appContext = context.getApplicationContext();
        mainHandler.post(() -> displayAssistiveBall(appContext));
    }

    public static void hideOverlay(Context context) {
        mainHandler.post(() -> {
            removeOverlayView();
            currentMode = 0;
        });
    }

    // Backward compatibility for existing calls
    public static void show(Context context, String orderId) {
        if (!MainActivity.isForeground) {
            showBall(context);
        } else {
            hideOverlay(context);
        }
    }

    public static void hide(Context context) {
        hideOverlay(context);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.getAction() != null) {
            String action = intent.getAction();
            if (ACTION_SHOW_CARD.equals(action)) {
                String oId = intent.getStringExtra(EXTRA_ORDER_ID);
                String oNum = intent.getStringExtra(EXTRA_ORDER_NUMBER);
                String cust = intent.getStringExtra(EXTRA_CUSTOMER);
                String addr = intent.getStringExtra(EXTRA_ADDRESS);
                String tot = intent.getStringExtra(EXTRA_TOTAL);
                showOrderCard(this, oId, oNum, cust, addr, tot);
            } else if (ACTION_SHOW_BALL.equals(action)) {
                showBall(this);
            } else if (ACTION_HIDE_OVERLAY.equals(action)) {
                hideOverlay(this);
            }
        }
        return START_STICKY;
    }

    // ── Mode 1: Floating Order Card (Heads-Up Popup over Google Maps) ──

    @SuppressLint("ClickableViewAccessibility")
    private static synchronized void displayOrderCard(Context context, String orderId, String orderNumber, String customer, String address, String total) {
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
                WindowManager.LayoutParams.MATCH_PARENT,
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
        params.y = dp(appContext, 60);

        currentOverlayView = createOrderCardView(appContext, orderId, orderNumber, customer, address, total);
        attachCardDragger(appContext, currentOverlayView);

        try {
            windowManager.addView(currentOverlayView, params);
        } catch (Exception e) {
            currentOverlayView = null;
            currentMode = 0;
        }
    }

    private static View createOrderCardView(Context context, String orderId, String orderNumber, String customer, String address, String total) {
        FrameLayout container = new FrameLayout(context);
        container.setPadding(dp(context, 16), dp(context, 6), dp(context, 16), dp(context, 6));

        LinearLayout card = new LinearLayout(context);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(context, 16), dp(context, 14), dp(context, 16), dp(context, 14));

        GradientDrawable cardBg = new GradientDrawable();
        cardBg.setColor(Color.parseColor("#0f172a")); // Dark Slate
        cardBg.setCornerRadius(dp(context, 18));
        cardBg.setStroke(dp(context, 2.5f), Color.parseColor("#2563eb")); // Driver Royal Blue border
        card.setBackground(cardBg);

        // Header: Badge + Title
        LinearLayout header = new LinearLayout(context);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);

        TextView iconTv = new TextView(context);
        iconTv.setText("🛵 ");
        iconTv.setTextSize(18);
        header.addView(iconTv);

        TextView titleTv = new TextView(context);
        titleTv.setText("Tugas Delivery Baru!");
        titleTv.setTextColor(Color.parseColor("#ffffff"));
        titleTv.setTextSize(16);
        titleTv.setTypeface(null, Typeface.BOLD);
        header.addView(titleTv);

        card.addView(header);

        // Subheader: Order Number & Customer
        String displayNum = (orderNumber != null && !orderNumber.isEmpty())
                ? (orderNumber.startsWith("#") ? orderNumber : "#" + orderNumber)
                : "#Tugas";
        String displayCust = (customer != null && !customer.isEmpty()) ? customer : "Pelanggan";

        TextView orderTv = new TextView(context);
        orderTv.setText(displayNum + " • " + displayCust);
        orderTv.setTextColor(Color.parseColor("#93c5fd"));
        orderTv.setTextSize(14);
        orderTv.setTypeface(null, Typeface.BOLD);
        orderTv.setPadding(0, dp(context, 4), 0, dp(context, 2));
        card.addView(orderTv);

        // Address
        if (address != null && !address.isEmpty()) {
            TextView addrTv = new TextView(context);
            addrTv.setText("📍 " + address);
            addrTv.setTextColor(Color.parseColor("#cbd5e1"));
            addrTv.setTextSize(12.5f);
            addrTv.setMaxLines(2);
            addrTv.setPadding(0, dp(context, 2), 0, dp(context, 4));
            card.addView(addrTv);
        }

        // Total / Payment Pill (if provided)
        if (total != null && !total.isEmpty()) {
            TextView totalTv = new TextView(context);
            totalTv.setText(total);
            totalTv.setTextColor(Color.parseColor("#34d399"));
            totalTv.setTextSize(13);
            totalTv.setTypeface(null, Typeface.BOLD);
            totalTv.setPadding(0, dp(context, 2), 0, dp(context, 8));
            card.addView(totalTv);
        } else {
            card.setPadding(dp(context, 16), dp(context, 14), dp(context, 16), dp(context, 10));
        }

        // Action Buttons Row
        LinearLayout btnRow = new LinearLayout(context);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        btnRow.setGravity(Gravity.CENTER_VERTICAL);
        btnRow.setPadding(0, dp(context, 8), 0, 0);

        // Accept / Open App Button
        Button btnOpen = new Button(context);
        btnOpen.setText("🛵 BUKA & TERIMA");
        btnOpen.setTextColor(Color.WHITE);
        btnOpen.setTextSize(13.5f);
        btnOpen.setTypeface(null, Typeface.BOLD);
        GradientDrawable openBg = new GradientDrawable();
        openBg.setColor(Color.parseColor("#2563eb")); // Royal Blue
        openBg.setCornerRadius(dp(context, 12));
        btnOpen.setBackground(openBg);
        LinearLayout.LayoutParams openLp = new LinearLayout.LayoutParams(0, dp(context, 44), 1.0f);
        openLp.rightMargin = dp(context, 8);
        btnOpen.setLayoutParams(openLp);
        btnOpen.setOnClickListener(v -> {
            OrderAlarmService.stop(context);
            hideOverlay(context);
            launchDriverApp(context, orderId, true);
        });
        btnRow.addView(btnOpen);

        // Dismiss / Minimize Button
        Button btnLater = new Button(context);
        btnLater.setText("✕ Nanti");
        btnLater.setTextColor(Color.parseColor("#94a3b8"));
        btnLater.setTextSize(12.5f);
        GradientDrawable laterBg = new GradientDrawable();
        laterBg.setColor(Color.parseColor("#1e293b"));
        laterBg.setCornerRadius(dp(context, 12));
        btnLater.setBackground(laterBg);
        LinearLayout.LayoutParams laterLp = new LinearLayout.LayoutParams(dp(context, 86), dp(context, 44));
        btnLater.setLayoutParams(laterLp);
        btnLater.setOnClickListener(v -> {
            OrderAlarmService.stop(context);
            if (MainActivity.isForeground) {
                hideOverlay(context);
            } else {
                displayAssistiveBall(context);
            }
        });
        btnRow.addView(btnLater);

        card.addView(btnRow);
        container.addView(card);
        return container;
    }

    // ── Mode 2: Floating Assistive Ball (Draggable Shortcut Ball over other apps) ──

    @SuppressLint("ClickableViewAccessibility")
    private static synchronized void displayAssistiveBall(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) return;

        Context appContext = context.getApplicationContext();
        if (windowManager == null) {
            windowManager = (WindowManager) appContext.getSystemService(Context.WINDOW_SERVICE);
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
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT
        );

        params.gravity = Gravity.TOP | Gravity.START;
        params.x = dp(appContext, 16);
        params.y = dp(appContext, 180);

        currentOverlayView = createAssistiveBallView(appContext);
        attachBallDragger(appContext, currentOverlayView);

        try {
            windowManager.addView(currentOverlayView, params);
        } catch (Exception e) {
            currentOverlayView = null;
            currentMode = 0;
        }
    }

    private static View createAssistiveBallView(Context context) {
        FrameLayout root = new FrameLayout(context);
        int pad = dp(context, 6);
        root.setPadding(pad, pad, pad, pad);

        // Circular background (Dark Slate with Driver Red accent)
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(Color.parseColor("#0f172a"));
        bg.setStroke(dp(context, 2.5f), Color.parseColor("#2563eb")); // Driver accent
        bg.setSize(dp(context, 54), dp(context, 54));

        FrameLayout ball = new FrameLayout(context);
        ball.setBackground(bg);
        ball.setLayoutParams(new FrameLayout.LayoutParams(dp(context, 54), dp(context, 54)));

        ImageView iconView = new ImageView(context);
        iconView.setImageResource(R.mipmap.ic_launcher_round);
        int iconPadding = dp(context, 7);
        iconView.setPadding(iconPadding, iconPadding, iconPadding, iconPadding);
        FrameLayout.LayoutParams iconLp = new FrameLayout.LayoutParams(dp(context, 54), dp(context, 54));
        iconLp.gravity = Gravity.CENTER;
        ball.addView(iconView, iconLp);

        root.addView(ball);
        return root;
    }

    // ── Dragger & Touch Handlers ──

    @SuppressLint("ClickableViewAccessibility")
    private static void attachCardDragger(Context context, View view) {
        view.setOnTouchListener(new View.OnTouchListener() {
            private int initialY;
            private float initialTouchY;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        initialY = params.y;
                        initialTouchY = event.getRawY();
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        params.y = initialY + (int) (event.getRawY() - initialTouchY);
                        if (windowManager != null && currentOverlayView != null) {
                            try { windowManager.updateViewLayout(currentOverlayView, params); } catch (Exception ignored) {}
                        }
                        return true;
                }
                return false;
            }
        });
    }

    @SuppressLint("ClickableViewAccessibility")
    private static void attachBallDragger(Context context, View view) {
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
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        params.x = initialX + (int) (event.getRawX() - initialTouchX);
                        params.y = initialY + (int) (event.getRawY() - initialTouchY);
                        if (windowManager != null && currentOverlayView != null) {
                            try { windowManager.updateViewLayout(currentOverlayView, params); } catch (Exception ignored) {}
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        float deltaX = Math.abs(event.getRawX() - initialTouchX);
                        float deltaY = Math.abs(event.getRawY() - initialTouchY);
                        if (deltaX < 12 && deltaY < 12) {
                            // Tapped: Bring Driver App to front
                            launchDriverApp(context, null);
                        }
                        return true;
                }
                return false;
            }
        });
    }

    private static void launchDriverApp(Context context, @Nullable String orderId) {
        launchDriverApp(context, orderId, false);
    }

    private static void launchDriverApp(Context context, @Nullable String orderId, boolean autoAccept) {
        try {
            Intent intent = new Intent(context, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            if (orderId != null && !orderId.isEmpty()) {
                intent.putExtra("target_order_id", orderId);
                if (autoAccept) {
                    intent.putExtra("auto_accept", true);
                }
            }
            context.startActivity(intent);
        } catch (Exception ignored) {}
    }

    private static void removeOverlayView() {
        if (currentOverlayView != null && windowManager != null) {
            try {
                windowManager.removeView(currentOverlayView);
            } catch (Exception ignored) {}
            currentOverlayView = null;
        }
    }

    private static int dp(Context context, float val) {
        return (int) (val * context.getResources().getDisplayMetrics().density);
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        removeOverlayView();
        currentMode = 0;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
