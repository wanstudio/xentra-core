package com.mybangjo.driver;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.tasks.Task;
import org.json.JSONObject;

public class MainActivity extends AppCompatActivity {
    private static final String DEFAULT_URL = "https://driver.mybangjo.com";
    private static final int PERMISSION_REQ_LOCATION = 1001;
    private static final int PERMISSION_REQ_BACKGROUND = 1002;
    public static volatile boolean isForeground = false;

    private WebView webView;
    private SwipeRefreshLayout swipeRefresh;
    private SharedPreferences prefs;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri cameraCaptureUri = null;
    private PermissionRequest pendingWebPermissionRequest = null;
    private GoogleSignInClient googleSignInClient;

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

    private final ActivityResultLauncher<Uri> cameraLauncher =
        registerForActivityResult(new ActivityResultContracts.TakePicture(), success -> {
            if (filePathCallback != null) {
                if (Boolean.TRUE.equals(success) && cameraCaptureUri != null) {
                    filePathCallback.onReceiveValue(new Uri[]{ cameraCaptureUri });
                } else {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = null;
            }
        });

    private final ActivityResultLauncher<String> cameraPermissionLauncher =
        registerForActivityResult(new ActivityResultContracts.RequestPermission(), isGranted -> {
            if (Boolean.TRUE.equals(isGranted)) {
                if (pendingWebPermissionRequest != null) {
                    try {
                        pendingWebPermissionRequest.grant(pendingWebPermissionRequest.getResources());
                    } catch (Exception ignored) {}
                    pendingWebPermissionRequest = null;
                } else if (filePathCallback != null) {
                    launchNativeCameraCapture();
                }
            } else {
                if (pendingWebPermissionRequest != null) {
                    try {
                        pendingWebPermissionRequest.deny();
                    } catch (Exception ignored) {}
                    pendingWebPermissionRequest = null;
                }
                cancelPendingFileChooser();
                Toast.makeText(this, "Izin kamera diperlukan untuk mengambil foto.", Toast.LENGTH_SHORT).show();
            }
        });

    private void launchNativeCameraCapture() {
        try {
            java.io.File photoFile = new java.io.File(getCacheDir(), "driver_cam_" + System.currentTimeMillis() + ".jpg");
            cameraCaptureUri = androidx.core.content.FileProvider.getUriForFile(
                MainActivity.this,
                getPackageName() + ".fileprovider",
                photoFile
            );
            cameraLauncher.launch(cameraCaptureUri);
        } catch (Exception e) {
            Toast.makeText(this, "Gagal membuka kamera: " + e.getMessage(), Toast.LENGTH_SHORT).show();
            cancelPendingFileChooser();
        }
    }

    private void cancelPendingFileChooser() {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
    }
    private final ActivityResultLauncher<Intent> googleSignInLauncher =
        registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            if (result.getResultCode() == RESULT_OK && result.getData() != null) {
                Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(result.getData());
                try {
                    GoogleSignInAccount account = task.getResult(ApiException.class);
                    if (account != null) {
                        String idToken = account.getIdToken();
                        String email = account.getEmail() != null ? account.getEmail() : "";
                        String displayName = account.getDisplayName() != null ? account.getDisplayName() : "";
                        notifyGoogleSignInSuccess(idToken, email, displayName);
                    } else {
                        notifyGoogleSignInError(12500, "Akun Google tidak ditemukan.");
                    }
                } catch (ApiException e) {
                    notifyGoogleSignInError(e.getStatusCode(), e.getMessage());
                }
            } else {
                notifyGoogleSignInError(12501, "Pemilihan akun Google dibatalkan.");
            }
        });

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        prefs = getSharedPreferences("xentra_driver_prefs", Context.MODE_PRIVATE);

        setupAdaptiveStatusBar();
        setupWebView();
        checkAndRequestPermissions();
        checkBatteryOptimization();
        checkOverlayPermission();

        // Auto-resume background task monitor if driver credentials exist (like Merchant OrderMonitorService)
        String savedToken = prefs.getString("auth_token", null);
        if (savedToken != null && !savedToken.trim().isEmpty()) {
            DriverGpsService.startService(this);
        }

        handleIncomingIntent(getIntent());
    }

    private void setupAdaptiveStatusBar() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Window window = getWindow();
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(Color.WHITE);
            window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        webView = findViewById(R.id.webView);
        swipeRefresh = findViewById(R.id.swipeRefresh);

        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setGeolocationEnabled(true);
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        XentraDriverBridge bridge = new XentraDriverBridge(this);
        webView.addJavascriptInterface(bridge, "XentraDriverNative");
        webView.addJavascriptInterface(bridge, "XentraNative");

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean needsCamera = false;
                    for (String res : request.getResources()) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) {
                            needsCamera = true;
                            break;
                        }
                    }
                    if (needsCamera && ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                        pendingWebPermissionRequest = request;
                        cameraPermissionLauncher.launch(Manifest.permission.CAMERA);
                    } else {
                        try {
                            request.grant(request.getResources());
                        } catch (Exception ignored) {}
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = filePathCallback;

                boolean isCapture = fileChooserParams != null && fileChooserParams.isCaptureEnabled();
                if (isCapture) {
                    if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        launchNativeCameraCapture();
                    } else {
                        cameraPermissionLauncher.launch(Manifest.permission.CAMERA);
                    }
                    return true;
                }

                try {
                    fileChooserLauncher.launch("image/*");
                } catch (Exception e) {
                    cancelPendingFileChooser();
                    return false;
                }
                return true;
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("tel:")) {
                    startActivity(new Intent(Intent.ACTION_DIAL, Uri.parse(url)));
                    return true;
                }
                if (url.startsWith("google.navigation:") || url.startsWith("geo:")) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                        return true;
                    } catch (Exception ignored) {}
                }
                if (url.contains("maps.google.com") || url.contains("google.com/maps")) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                        return true;
                    } catch (Exception ignored) {}
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                swipeRefresh.setRefreshing(false);
            }
        });

        swipeRefresh.setOnRefreshListener(() -> {
            webView.clearCache(true);
            webView.reload();
        });

        String targetUrl = getIntent() != null && getIntent().getData() != null
                ? getIntent().getData().toString()
                : DEFAULT_URL;

        webView.loadUrl(targetUrl);
    }

    public void clearWebViewCache() {
        if (webView != null) {
            webView.clearCache(true);
            webView.reload();
        }
    }

    private void checkAndRequestPermissions() {
        boolean needLocation = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED;
        boolean needCamera = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED;
        if (needLocation || needCamera) {
            String[] permissions = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                    ? new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.CAMERA, Manifest.permission.POST_NOTIFICATIONS}
                    : new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.CAMERA};
            ActivityCompat.requestPermissions(this, permissions, PERMISSION_REQ_LOCATION);
        } else {
            checkBackgroundLocation();
        }
    }

    private void checkBackgroundLocation() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, PERMISSION_REQ_BACKGROUND);
            }
        }
    }

    private void checkBatteryOptimization() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                try {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                } catch (Exception ignored) {}
            }
        }
    }

    private void checkOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            boolean alreadyAsked = prefs.getBoolean("overlay_prompt_shown", false);
            if (!alreadyAsked) {
                prefs.edit().putBoolean("overlay_prompt_shown", true).apply();
                new androidx.appcompat.app.AlertDialog.Builder(this)
                    .setTitle("🛵 Floating Notifikasi Order")
                    .setMessage("Aktifkan izin 'Tampilkan di atas aplikasi lain' agar kartu tugas baru dan shortcut dapat melayang saat Anda membuka Google Maps / Waze.")
                    .setPositiveButton("Aktifkan Sekarang", (dialog, which) -> {
                        try {
                            Intent intent = new Intent(
                                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                Uri.parse("package:" + getPackageName())
                            );
                            startActivity(intent);
                        } catch (Exception ignored) {}
                    })
                    .setNegativeButton("Nanti", null)
                    .show();
            }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        isForeground = true;
        OrderAlarmService.stop(this);
        OrderOverlayService.hideOverlay(this);
    }

    @Override
    protected void onPause() {
        super.onPause();
        isForeground = false;
        String savedToken = prefs.getString("auth_token", null);
        if (savedToken != null && !savedToken.trim().isEmpty()) {
            OrderOverlayService.showBall(this);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    private void handleIncomingIntent(Intent intent) {
        if (intent == null) return;
        OrderAlarmService.stop(this);
        OrderOverlayService.hideOverlay(this);

        if (intent.getStringExtra("target_order_id") != null) {
            String orderId = intent.getStringExtra("target_order_id");
            boolean autoAccept = intent.getBooleanExtra("auto_accept", false);
            if (webView != null && orderId != null) {
                String js = "if (typeof window.onSelectTargetOrder === 'function') { window.onSelectTargetOrder('" + orderId + "', " + (autoAccept ? "true" : "false") + "); }";
                webView.post(() -> webView.evaluateJavascript(js, null));
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQ_LOCATION) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                checkBackgroundLocation();
                boolean isOnline = prefs.getBoolean("is_online", false);
                if (isOnline) DriverGpsService.startService(this);
            }
        }
    }

    public void startGoogleSignIn(String clientId) {
        runOnUiThread(() -> {
            try {
                String targetClientId = (clientId != null && !clientId.trim().isEmpty())
                    ? clientId.trim()
                    : "72550286278-n12ssb6giqmt5b8vv8e6pebrv1cpgnrq.apps.googleusercontent.com";

                GoogleSignInOptions gso = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                    .requestIdToken(targetClientId)
                    .requestEmail()
                    .build();

                googleSignInClient = GoogleSignIn.getClient(this, gso);
                googleSignInClient.signOut().addOnCompleteListener(this, task -> {
                    Intent signInIntent = googleSignInClient.getSignInIntent();
                    googleSignInLauncher.launch(signInIntent);
                });
            } catch (Exception e) {
                notifyGoogleSignInError(-1, e.getMessage());
            }
        });
    }

    private void notifyGoogleSignInSuccess(String idToken, String email, String displayName) {
        if (webView == null) return;
        String js = String.format(
            "if (typeof window.onGoogleSignInNativeSuccess === 'function') { " +
            "  window.onGoogleSignInNativeSuccess(%s, %s, %s); " +
            "}",
            JSONObject.quote(idToken != null ? idToken : ""),
            JSONObject.quote(email != null ? email : ""),
            JSONObject.quote(displayName != null ? displayName : "")
        );
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    private void notifyGoogleSignInError(int code, String message) {
        if (webView == null) return;
        String js = String.format(
            "if (typeof window.onGoogleSignInNativeError === 'function') { " +
            "  window.onGoogleSignInNativeError(%d, %s); " +
            "}",
            code,
            JSONObject.quote(message != null ? message : "Google Sign-In failed")
        );
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
