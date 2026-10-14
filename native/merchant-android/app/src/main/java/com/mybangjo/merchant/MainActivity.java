package com.mybangjo.merchant;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.Toast;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends AppCompatActivity {
    private static final String TARGET_URL = "https://m.mybangjo.com/merchant/";

    private WebView webView;
    private ProgressBar progressBar;
    private SwipeRefreshLayout swipeRefreshLayout;
    private ValueCallback<Uri[]> filePathCallback;

    private final ActivityResultLauncher<String[]> permissionLauncher =
        registerForActivityResult(new ActivityResultContracts.RequestMultiplePermissions(), result -> {
            // Permissions handled gracefully
        });

    private final ActivityResultLauncher<String> fileChooserLauncher =
        registerForActivityResult(new ActivityResultContracts.GetMultipleContents(), uris -> {
            if (filePathCallback != null) {
                if (uris != null && !uris.isEmpty()) {
                    Uri[] uriArray = uris.toArray(new Uri[0]);
                    filePathCallback.onReceiveValue(uriArray);
                } else {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = null;
            }
        });

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webView);
        progressBar = findViewById(R.id.progressBar);
        swipeRefreshLayout = findViewById(R.id.swipeRefreshLayout);

        setupSwipeRefresh();
        setupWebView();
        requestNecessaryPermissions();
        checkOverlayPermission();
        checkBatteryOptimization();

        if (savedInstanceState == null) {
            webView.loadUrl(TARGET_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }

        handleIncomingIntent(getIntent());
    }

    private void checkOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !android.provider.Settings.canDrawOverlays(this)) {
            android.content.SharedPreferences prefs = getSharedPreferences("xentra_merchant_prefs", android.content.Context.MODE_PRIVATE);
            boolean alreadyAsked = prefs.getBoolean("overlay_prompt_shown", false);
            if (!alreadyAsked) {
                prefs.edit().putBoolean("overlay_prompt_shown", true).apply();
                new androidx.appcompat.app.AlertDialog.Builder(this)
                    .setTitle("🔔 Peringatan Pesanan Baru")
                    .setMessage("Tampilkan pop-up pesanan di layar agar orderan tidak terlewat saat membuka aplikasi lain.")
                    .setPositiveButton("Aktifkan", (dialog, which) -> {
                        android.content.Intent intent = new android.content.Intent(
                            android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            android.net.Uri.parse("package:" + getPackageName())
                        );
                        startActivity(intent);
                    })
                    .setNegativeButton("Nanti", null)
                    .show();
            }
        }
    }

    private void checkBatteryOptimization() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                SharedPreferences prefs = getSharedPreferences("xentra_merchant_prefs", Context.MODE_PRIVATE);
                boolean alreadyAsked = prefs.getBoolean("battery_prompt_shown", false);
                if (!alreadyAsked) {
                    prefs.edit().putBoolean("battery_prompt_shown", true).apply();
                    new androidx.appcompat.app.AlertDialog.Builder(this)
                        .setTitle("🔋 Izin Latar Belakang & Baterai")
                        .setMessage("Agar sirene pesanan tetap berbunyi saat layar HP mati atau terkunci, mohon izinkan aplikasi berjalan tanpa dibatasi penghemat baterai.")
                        .setPositiveButton("Izinkan", (dialog, which) -> {
                            try {
                                Intent intent = new Intent(
                                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                                    Uri.parse("package:" + getPackageName())
                                );
                                startActivity(intent);
                            } catch (Exception e) {
                                try {
                                    startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                                } catch (Exception ignored) {}
                            }
                        })
                        .setNegativeButton("Nanti", null)
                        .show();
                }
            }
        }
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    private void handleIncomingIntent(android.content.Intent intent) {
        if (intent == null) return;
        // User interacted with app or notification: stop loud siren and overlay
        OrderAlarmService.stopAlarm(this);
        OrderOverlayService.hideOverlay(this);

        Uri data = intent.getData();
        if (data != null && webView != null) {
            String url = data.toString();
            if (url.startsWith("https://m.mybangjo.com")) {
                webView.loadUrl(url);
            }
        }
    }

    private void setupSwipeRefresh() {
        swipeRefreshLayout.setColorSchemeResources(R.color.primary);
        swipeRefreshLayout.setOnRefreshListener(() -> webView.reload());
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // Enable Cookies and Third-Party Cookies (essential for cross-domain session & auth)
        android.webkit.CookieManager cookieManager = android.webkit.CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookieManager.setAcceptThirdPartyCookies(webView, true);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        // Customize user agent to identify as Native Android Shell
        String defaultUA = settings.getUserAgentString();
        settings.setUserAgentString(defaultUA + " XentraNativeShell/1.0.0 (Mybangjo; Android)");

        // Expose Native Bridge
        webView.addJavascriptInterface(new XentraNativeBridge(this), "XentraNative");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                progressBar.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progressBar.setVisibility(View.GONE);
                swipeRefreshLayout.setRefreshing(false);
                // Inject native flags and auto-sync auth credentials to native background service
                view.evaluateJavascript(
                    "window.IS_NATIVE_APP = true; window.__XENTRA_NATIVE_READY = true;" +
                    "(function() {" +
                    "  try {" +
                    "    var token = localStorage.getItem('xentra_merchant_token');" +
                    "    var user = null;" +
                    "    try { user = JSON.parse(localStorage.getItem('xentra_merchant_user')); } catch(_){}" +
                    "    var branchId = user ? (user.branch_id || user.branchId || '') : '';" +
                    "    if (token && window.XentraNative && typeof window.XentraNative.syncAuth === 'function') {" +
                    "      window.XentraNative.syncAuth(token, branchId);" +
                    "    }" +
                    "  } catch(e) {}" +
                    "})();",
                    null
                );
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    progressBar.setVisibility(View.GONE);
                    swipeRefreshLayout.setRefreshing(false);
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
                if (newProgress >= 100) {
                    progressBar.setVisibility(View.GONE);
                }
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                // Grant camera / audio permissions if requested by webview
                request.grant(request.getResources());
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = filePathCallback;
                fileChooserLauncher.launch("image/*");
                return true;
            }
        });
    }

    private void requestNecessaryPermissions() {
        List<String> needed = new ArrayList<>();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.POST_NOTIFICATIONS);
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.BLUETOOTH_CONNECT);
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.BLUETOOTH_SCAN);
            }
        }

        if (!needed.isEmpty()) {
            permissionLauncher.launch(needed.toArray(new String[0]));
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) {
            webView.saveState(outState);
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
