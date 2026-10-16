package com.mybangjo.driver;

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
import android.widget.FrameLayout;
import android.widget.ImageView;

import androidx.annotation.Nullable;

public class OrderOverlayService extends Service {
    private WindowManager windowManager;
    private View floatingView;

    public static void show(Context context, String orderId) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
            return;
        }
        Intent intent = new Intent(context, OrderOverlayService.class);
        intent.putExtra("order_id", orderId);
        context.startService(intent);
    }

    public static void hide(Context context) {
        Intent intent = new Intent(context, OrderOverlayService.class);
        context.stopService(intent);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            stopSelf();
            return;
        }

        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);

        FrameLayout root = new FrameLayout(this);
        int pad = dp(6);
        root.setPadding(pad, pad, pad, pad);

        // Circular background (Dark Slate with Emerald green accent)
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(Color.parseColor("#0f172a")); // Dark Slate
        bg.setStroke(dp(2.5f), Color.parseColor("#059669")); // Emerald green accent
        bg.setSize(dp(54), dp(54));

        FrameLayout ball = new FrameLayout(this);
        ball.setBackground(bg);
        ball.setLayoutParams(new FrameLayout.LayoutParams(dp(54), dp(54)));

        // App Icon inside the ball (Proportional round launcher icon with 7dp padding)
        ImageView iconView = new ImageView(this);
        iconView.setImageResource(R.mipmap.ic_launcher_round);
        int iconPadding = dp(7);
        iconView.setPadding(iconPadding, iconPadding, iconPadding, iconPadding);
        FrameLayout.LayoutParams iconLp = new FrameLayout.LayoutParams(dp(54), dp(54));
        iconLp.gravity = Gravity.CENTER;
        ball.addView(iconView, iconLp);

        root.addView(ball);

        int layoutType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                layoutType,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT
        );

        params.gravity = Gravity.TOP | Gravity.START;
        params.x = 20;
        params.y = 200;

        root.setOnTouchListener(new View.OnTouchListener() {
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
                        windowManager.updateViewLayout(root, params);
                        return true;
                    case MotionEvent.ACTION_UP:
                        float deltaX = Math.abs(event.getRawX() - initialTouchX);
                        float deltaY = Math.abs(event.getRawY() - initialTouchY);
                        if (deltaX < 10 && deltaY < 10) {
                            // Clicked: Bring Driver App to front
                            Intent intent = new Intent(OrderOverlayService.this, MainActivity.class);
                            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                            startActivity(intent);
                        }
                        return true;
                }
                return false;
            }
        });

        floatingView = root;
        windowManager.addView(floatingView, params);
    }

    private int dp(float val) {
        return (int) (val * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (floatingView != null && windowManager != null) {
            windowManager.removeView(floatingView);
            floatingView = null;
        }
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
