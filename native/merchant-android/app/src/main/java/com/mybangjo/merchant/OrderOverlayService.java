package com.mybangjo.merchant;

import android.annotation.SuppressLint;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public class OrderOverlayService extends Service {
    public static final String ACTION_SHOW_OVERLAY = "com.mybangjo.merchant.ACTION_SHOW_OVERLAY";
    public static final String ACTION_HIDE_OVERLAY = "com.mybangjo.merchant.ACTION_HIDE_OVERLAY";

    public static final String EXTRA_ORDER_ID = "extra_order_id";
    public static final String EXTRA_ORDER_NUMBER = "extra_order_number";
    public static final String EXTRA_CUSTOMER = "extra_customer";
    public static final String EXTRA_TOTAL = "extra_total";

    private WindowManager windowManager;
    private View floatingView;
    private WindowManager.LayoutParams params;

    public static void showOverlay(Context context, String orderId, String orderNumber, String customer, String total) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
            return;
        }
        Intent intent = new Intent(context, OrderOverlayService.class);
        intent.setAction(ACTION_SHOW_OVERLAY);
        intent.putExtra(EXTRA_ORDER_ID, orderId);
        intent.putExtra(EXTRA_ORDER_NUMBER, orderNumber);
        intent.putExtra(EXTRA_CUSTOMER, customer);
        intent.putExtra(EXTRA_TOTAL, total);
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
        if (intent != null && ACTION_HIDE_OVERLAY.equals(intent.getAction())) {
            removeFloatingView();
            stopSelf();
            return START_NOT_STICKY;
        }

        if (intent != null && ACTION_SHOW_OVERLAY.equals(intent.getAction())) {
            String orderId = intent.getStringExtra(EXTRA_ORDER_ID);
            String orderNumber = intent.getStringExtra(EXTRA_ORDER_NUMBER);
            String customer = intent.getStringExtra(EXTRA_CUSTOMER);
            String total = intent.getStringExtra(EXTRA_TOTAL);

            displayFloatingView(orderId, orderNumber, customer, total);
        }

        return START_NOT_STICKY;
    }

    @SuppressLint("ClickableViewAccessibility")
    private void displayFloatingView(String orderId, String orderNumber, String customer, String total) {
        removeFloatingView();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            return;
        }

        int layoutType;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            layoutType = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
        } else {
            layoutType = WindowManager.LayoutParams.TYPE_PHONE;
        }

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
        params.y = 120;

        floatingView = createFloatingCard(orderId, orderNumber, customer, total);
        attachTouchDragger(floatingView);

        try {
            windowManager.addView(floatingView, params);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private View createFloatingCard(String orderId, String orderNumber, String customer, String total) {
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
            removeFloatingView();
            Intent openIntent = new Intent(this, MainActivity.class);
            openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(openIntent);
            stopSelf();
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
            removeFloatingView();
            stopSelf();
        });
        btnRow.addView(btnDismiss);

        root.addView(btnRow);

        return root;
    }

    @SuppressLint("ClickableViewAccessibility")
    private void attachTouchDragger(View view) {
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
                        if (floatingView != null && floatingView.isAttachedToWindow()) {
                            windowManager.updateViewLayout(floatingView, params);
                        }
                        return true;
                }
                return false;
            }
        });
    }

    private void removeFloatingView() {
        if (floatingView != null) {
            try {
                if (floatingView.isAttachedToWindow()) {
                    windowManager.removeView(floatingView);
                }
            } catch (Exception ignored) {}
            floatingView = null;
        }
    }

    private int dp(int value) {
        float density = getResources().getDisplayMetrics().density;
        return Math.round(value * density);
    }

    @Override
    public void onDestroy() {
        removeFloatingView();
        super.onDestroy();
    }
}
