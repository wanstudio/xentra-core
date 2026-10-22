package com.mybangjo.owner;

import android.app.Notification;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * XENTRA OWNER — Automated External Channel Order Listener
 *
 * Captures real-time incoming delivery orders from GoBiz (GoFood), GrabMerchant (GrabFood),
 * and Shopee Partner (ShopeeFood), extracts financial metadata, and ingests them
 * directly into Xentra Core for automated bookkeeping and settlement calculations.
 */
public class ChannelNotificationListenerService extends NotificationListenerService {
    private static final String TAG = "OwnerChannelNotif";
    private static final String BACKEND_API = "https://m.mybangjo.com/api/v1/integrations/channel-order";

    private static final String PKG_GOFOOD = "com.gojek.gobiz";
    private static final String PKG_GRABFOOD = "com.grab.merchant";
    private static final String PKG_SHOPEEFOOD = "com.shopee.merchant";

    private static final Pattern ORDER_ID_PATTERN = Pattern.compile("(#?[A-Za-z0-9\\-]{5,20})");
    private static final Pattern PRICE_PATTERN = Pattern.compile("(?:Rp|IDR)\\s*([0-9\\.\\,]+)", Pattern.CASE_INSENSITIVE);

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || sbn.getNotification() == null) return;

        String packageName = sbn.getPackageName();
        String channel = null;

        if (PKG_GOFOOD.equalsIgnoreCase(packageName)) {
            channel = "gofood";
        } else if (PKG_GRABFOOD.equalsIgnoreCase(packageName)) {
            channel = "grabfood";
        } else if (PKG_SHOPEEFOOD.equalsIgnoreCase(packageName) || "com.shopee.id".equalsIgnoreCase(packageName)) {
            channel = "shopeefood";
        }

        if (channel == null) return;

        Notification notification = sbn.getNotification();
        Bundle extras = notification.extras;
        if (extras == null) return;

        CharSequence titleCs = extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence textCs = extras.getCharSequence(Notification.EXTRA_TEXT);
        CharSequence bigTextCs = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);

        String title = titleCs != null ? titleCs.toString() : "";
        String text = textCs != null ? textCs.toString() : "";
        String bigText = bigTextCs != null ? bigTextCs.toString() : "";

        String combinedText = (title + " " + text + " " + bigText).trim();
        Log.d(TAG, "Captured delivery notification from " + channel + ": " + combinedText);

        if (!isOrderNotification(combinedText)) {
            return;
        }

        String externalOrderId = extractOrderId(channel, combinedText, sbn.getId());
        double grossAmount = extractAmount(combinedText);

        if (externalOrderId == null || grossAmount <= 0) {
            Log.w(TAG, "Could not reliably extract order details: id=" + externalOrderId + ", amount=" + grossAmount);
            return;
        }

        final String finalChannel = channel;
        final String finalOrderId = externalOrderId;
        final double finalAmount = grossAmount;
        final String finalRawText = combinedText;

        new Thread(() -> forwardToXentraBackend(finalChannel, finalOrderId, finalAmount, finalRawText)).start();
    }

    private boolean isOrderNotification(String text) {
        String lower = text.toLowerCase();
        return lower.contains("pesanan baru") ||
               lower.contains("order baru") ||
               lower.contains("new order") ||
               lower.contains("pesanan masuk") ||
               lower.contains("siap diambil") ||
               lower.contains("driver menuju");
    }

    private String extractOrderId(String channel, String text, int notifId) {
        Matcher m = ORDER_ID_PATTERN.matcher(text);
        while (m.find()) {
            String candidate = m.group(1).replace("#", "").trim();
            if (!candidate.equalsIgnoreCase("pesanan") &&
                !candidate.equalsIgnoreCase("order") &&
                !candidate.equalsIgnoreCase("masuk") &&
                candidate.length() >= 4) {
                return candidate;
            }
        }
        return channel.toUpperCase() + "-" + Math.abs(notifId);
    }

    private double extractAmount(String text) {
        Matcher m = PRICE_PATTERN.matcher(text);
        if (m.find()) {
            String rawNumber = m.group(1).replace(".", "").replace(",", "");
            try {
                return Double.parseDouble(rawNumber);
            } catch (Exception ignored) {}
        }
        return 0.0;
    }

    private void forwardToXentraBackend(String channel, String externalOrderId, double grossAmount, String rawText) {
        HttpURLConnection conn = null;
        try {
            SharedPreferences prefs = getSharedPreferences("xentra_pos_prefs", Context.MODE_PRIVATE);
            String token = prefs.getString("auth_token", null);
            String branchId = prefs.getString("auth_branch_id", null);

            if (token == null || branchId == null) {
                Log.w(TAG, "Cannot forward order: Owner is not logged in / auth context missing");
                return;
            }

            URL url = new URL(BACKEND_API);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setDoOutput(true);

            JSONObject payload = new JSONObject();
            payload.put("channel", channel);
            payload.put("external_order_id", externalOrderId);
            payload.put("branch_id", branchId);
            payload.put("gross_amount", grossAmount);
            payload.put("order_note", "Auto-ingested from " + channel + " notification");

            JSONObject rawMeta = new JSONObject();
            rawMeta.put("captured_text", rawText);
            rawMeta.put("device_timestamp", System.currentTimeMillis());
            payload.put("raw_payload", rawMeta);

            byte[] out = payload.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(out);
            }

            int responseCode = conn.getResponseCode();
            Log.i(TAG, "Order forward result for " + externalOrderId + ": HTTP " + responseCode);
        } catch (Exception e) {
            Log.e(TAG, "Failed to send channel order to backend: " + e.getMessage(), e);
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }
}
