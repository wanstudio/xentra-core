package com.mybangjo.owner;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.View;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JsResult;
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
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.tasks.Task;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends AppCompatActivity {
    private static final String TARGET_URL = "https://m.mybangjo.com/owner/";

    private WebView webView;
    private ProgressBar progressBar;
    private SwipeRefreshLayout swipeRefreshLayout;
    private ValueCallback<Uri[]> filePathCallback;
    private GoogleSignInClient googleSignInClient;
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

    private Uri cameraCaptureUri = null;
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
                launchNativeCameraCapture();
            } else {
                if (!shouldShowRequestPermissionRationale(Manifest.permission.CAMERA)) {
                    showPermissionSettingsDialog(
                        "Izin Kamera Dinonaktifkan",
                        "Akses kamera telah dinonaktifkan di pengaturan perangkat. Silakan aktifkan izin kamera di Pengaturan Aplikasi agar dapat mengambil foto menu.",
                        R.drawable.ic_camera_dialog
                    );
                } else {
                    Toast.makeText(this, "Izin kamera diperlukan untuk mengambil foto menu.", Toast.LENGTH_SHORT).show();
                    cancelPendingFileChooser();
                }
            }
        });

    private void launchNativeCameraCapture() {
        try {
            java.io.File photoFile = new java.io.File(getCacheDir(), "camera_" + System.currentTimeMillis() + ".jpg");
            cameraCaptureUri = androidx.core.content.FileProvider.getUriForFile(
                MainActivity.this,
                getPackageName() + ".fileprovider",
                photoFile
            );
            cameraLauncher.launch(cameraCaptureUri);
        } catch (Exception e) {
            e.printStackTrace();
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

    private void showCameraPermissionBottomSheet() {
        showCustomBottomSheetDialog(
            "Izinkan Akses Kamera",
            "Mybangjo Owner membutuhkan izin kamera untuk mengambil foto menu dan produk secara langsung dari perangkat Anda.",
            "Izinkan Sekarang",
            "Nanti Saja",
            R.drawable.ic_camera_dialog,
            () -> cameraPermissionLauncher.launch(Manifest.permission.CAMERA),
            this::cancelPendingFileChooser
        );
    }

    private void showPermissionSettingsDialog(String title, String message, int iconRes) {
        showCustomBottomSheetDialog(
            title,
            message,
            "Buka Pengaturan",
            "Nanti Saja",
            iconRes,
            () -> {
                cancelPendingFileChooser();
                try {
                    Intent intent = new Intent(
                        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:" + getPackageName())
                    );
                    startActivity(intent);
                } catch (Exception e) {
                    try {
                        startActivity(new Intent(Settings.ACTION_SETTINGS));
                    } catch (Exception ignored) {}
                }
            },
            this::cancelPendingFileChooser
        );
    }

    private void showCustomBottomSheetDialog(
        String title,
        String message,
        String primaryText,
        String secondaryText,
        int iconRes,
        Runnable onPrimary,
        Runnable onSecondary
    ) {
        runOnUiThread(() -> {
            try {
                com.google.android.material.bottomsheet.BottomSheetDialog dialog =
                    new com.google.android.material.bottomsheet.BottomSheetDialog(this);
                View view = getLayoutInflater().inflate(R.layout.dialog_permission_bottom_sheet, null);
                dialog.setContentView(view);

                View bottomSheetContainer = dialog.findViewById(com.google.android.material.R.id.design_bottom_sheet);
                if (bottomSheetContainer != null) {
                    bottomSheetContainer.setBackgroundResource(android.R.color.transparent);
                }

                android.widget.ImageView iconView = view.findViewById(R.id.dialog_icon);
                android.widget.TextView titleView = view.findViewById(R.id.dialog_title);
                android.widget.TextView msgView = view.findViewById(R.id.dialog_message);
                com.google.android.material.button.MaterialButton btnPrimary = view.findViewById(R.id.dialog_btn_primary);
                com.google.android.material.button.MaterialButton btnSecondary = view.findViewById(R.id.dialog_btn_secondary);

                if (iconView != null && iconRes != 0) iconView.setImageResource(iconRes);
                if (titleView != null && title != null) titleView.setText(title);
                if (msgView != null && message != null) msgView.setText(message);

                if (btnPrimary != null) {
                    if (primaryText != null) btnPrimary.setText(primaryText);
                    btnPrimary.setOnClickListener(v -> {
                        dialog.dismiss();
                        if (onPrimary != null) onPrimary.run();
                    });
                }

                if (btnSecondary != null) {
                    if (secondaryText != null) {
                        btnSecondary.setText(secondaryText);
                        btnSecondary.setOnClickListener(v -> {
                            dialog.dismiss();
                            if (onSecondary != null) onSecondary.run();
                        });
                    } else {
                        btnSecondary.setVisibility(View.GONE);
                    }
                }

                dialog.setOnCancelListener(d -> {
                    if (onSecondary != null) onSecondary.run();
                });

                dialog.show();
            } catch (Exception e) {
                e.printStackTrace();
            }
        });
    }

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle savedInstanceState) {
        setTheme(R.style.AppTheme);
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // Keep cashier screen awake by default during shift
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView = findViewById(R.id.webView);
        progressBar = findViewById(R.id.progressBar);
        if (progressBar != null) {
            progressBar.setAlpha(0f);
            progressBar.setVisibility(View.GONE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                android.content.res.ColorStateList transparent = android.content.res.ColorStateList.valueOf(Color.TRANSPARENT);
                progressBar.setProgressTintList(transparent);
                progressBar.setProgressBackgroundTintList(transparent);
                progressBar.setIndeterminateTintList(transparent);
            }
        }
        swipeRefreshLayout = findViewById(R.id.swipeRefreshLayout);

        setupSwipeRefresh();
        setupWebView();
        updateStatusBar("#ffffff", true);
        updateNavigationBar("#ffffff", true);
        requestNecessaryPermissions();
        checkOverlayPermission();
        checkBatteryOptimization();

        if (savedInstanceState == null) {
            webView.loadUrl(TARGET_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }

        // Auto-resume background monitor if credentials exist
        SharedPreferences authPrefs = getSharedPreferences("xentra_pos_prefs", Context.MODE_PRIVATE);
        String savedToken = authPrefs.getString("auth_token", null);
        String savedBranch = authPrefs.getString("auth_branch_id", null);
        if (savedToken != null && !savedToken.isEmpty() && savedBranch != null && !savedBranch.isEmpty()) {
            OrderMonitorService.startMonitoring(this);
        }

        // Initial adaptive status bar & navigation bar: pure white with crisp dark icons
        updateStatusBar("#ffffff", true);
        updateNavigationBar("#ffffff", true);

        handleIncomingIntent(getIntent());
    }

    public void setKeepScreenOn(boolean keepOn) {
        runOnUiThread(() -> {
            if (keepOn) {
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } else {
                getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
        });
    }

    public void hideNativeSplash() {
        // Handled directly by Xentra Robot web splash overlay
    }

    public void updateStatusBar(String hexColor, boolean darkIcons) {
        runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                try {
                    int color = Color.parseColor(hexColor);
                    getWindow().setStatusBarColor(color);

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        WindowInsetsController controller = getWindow().getInsetsController();
                        if (controller != null) {
                            if (darkIcons) {
                                controller.setSystemBarsAppearance(
                                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS,
                                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                                );
                            } else {
                                controller.setSystemBarsAppearance(
                                    0,
                                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                                );
                            }
                        }
                    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        View decor = getWindow().getDecorView();
                        int flags = decor.getSystemUiVisibility();
                        if (darkIcons) {
                            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                        } else {
                            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                        }
                        decor.setSystemUiVisibility(flags);
                    }
                } catch (Exception ignored) {}
            }
        });
    }

    public void updateNavigationBar(String hexColor, boolean darkIcons) {
        runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                try {
                    int color = Color.parseColor(hexColor);
                    getWindow().setNavigationBarColor(color);

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        getWindow().setNavigationBarContrastEnforced(false);
                    }

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        WindowInsetsController controller = getWindow().getInsetsController();
                        if (controller != null) {
                            if (darkIcons) {
                                controller.setSystemBarsAppearance(
                                    WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                                    WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                                );
                            } else {
                                controller.setSystemBarsAppearance(
                                    0,
                                    WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                                );
                            }
                        }
                    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        View decor = getWindow().getDecorView();
                        int flags = decor.getSystemUiVisibility();
                        if (darkIcons) {
                            flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                        } else {
                            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                        }
                        decor.setSystemUiVisibility(flags);
                    }
                } catch (Exception ignored) {}
            }
        });
    }

    private void checkOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            SharedPreferences prefs = getSharedPreferences("xentra_pos_prefs", Context.MODE_PRIVATE);
            boolean alreadyAsked = prefs.getBoolean("overlay_prompt_shown", false);
            if (!alreadyAsked) {
                prefs.edit().putBoolean("overlay_prompt_shown", true).apply();
                showCustomBottomSheetDialog(
                    "Bola Melayang & Notifikasi Kasir",
                    "Aktifkan fitur tampil di atas aplikasi lain agar pesanan kasir baru dan bola pintasan kasir tetap terlihat saat membuka aplikasi lain.",
                    "Aktifkan Sekarang",
                    "Nanti Saja",
                    R.drawable.ic_bell_dialog,
                    () -> {
                        try {
                            Intent intent = new Intent(
                                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                Uri.parse("package:" + getPackageName())
                            );
                            startActivity(intent);
                        } catch (Exception ignored) {}
                    },
                    null
                );
            }
        }
    }

    private void checkBatteryOptimization() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                SharedPreferences prefs = getSharedPreferences("xentra_pos_prefs", Context.MODE_PRIVATE);
                boolean alreadyAsked = prefs.getBoolean("battery_prompt_shown", false);
                if (!alreadyAsked) {
                    prefs.edit().putBoolean("battery_prompt_shown", true).apply();
                    showCustomBottomSheetDialog(
                        "Izin Berjalan di Latar Belakang",
                        "Agar pesanan kasir baru tetap terpantau dan sirene pesanan berbunyi, mohon izinkan aplikasi berjalan tanpa dibatasi penghemat baterai.",
                        "Izinkan Sekarang",
                        "Nanti Saja",
                        R.drawable.ic_battery_dialog,
                        () -> {
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
                        },
                        null
                    );
                }
            }
        }
    }

    private void setupSwipeRefresh() {
        swipeRefreshLayout.setEnabled(false);
        swipeRefreshLayout.setColorSchemeColors(ContextCompat.getColor(this, R.color.primary));
        swipeRefreshLayout.setOnRefreshListener(() -> webView.reload());
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setGeolocationEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);

        String defaultUa = settings.getUserAgentString();
        settings.setUserAgentString(defaultUa + " MybangjoOwnerNative/1.0.0 (Linux; Android Owner)");

        XentraOwnerBridge bridge = new XentraOwnerBridge(this);
        webView.addJavascriptInterface(bridge, "XentraOwnerBridge");
        webView.addJavascriptInterface(bridge, "XentraNative");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                // Keep top progress bar hidden so SPA route transitions never flash a green bar above the topbar
                progressBar.setVisibility(View.GONE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                progressBar.setVisibility(View.GONE);
                swipeRefreshLayout.setRefreshing(false);
                view.evaluateJavascript(
                    "window.IS_NATIVE_APP = true; window.__XENTRA_NATIVE_READY = true;" +
                    "(function() {" +
                    "  try {" +
                    "    var token = localStorage.getItem('xentra_merchant_token');" +
                    "    var user = null;" +
                    "    try { user = JSON.parse(localStorage.getItem('xentra_merchant_user')); } catch(_){}" +
                    "    var branchId = user ? (user.branch_id || user.branchId || '') : '';" +
                    "    if (token && window.XentraOwnerBridge && typeof window.XentraOwnerBridge.syncAuth === 'function') {" +
                    "      window.XentraOwnerBridge.syncAuth(token, branchId);" +
                    "    }" +
                    "  } catch(e) {}" +
                    "})();",
                    null
                );
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame()) {
                    progressBar.setVisibility(View.GONE);
                    swipeRefreshLayout.setRefreshing(false);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                    return false;
                }
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                    startActivity(intent);
                    return true;
                } catch (Exception e) {
                    return false;
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                // Keep native top progress bar permanently hidden to prevent green flicker on SPA transitions
                progressBar.setVisibility(View.GONE);
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
                        showCameraPermissionBottomSheet();
                    }
                    return true;
                }

                fileChooserLauncher.launch("image/*");
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new com.google.android.material.dialog.MaterialAlertDialogBuilder(MainActivity.this)
                    .setTitle("Kasir POS")
                    .setMessage(message)
                    .setPositiveButton("OK", (dialog, which) -> result.confirm())
                    .setOnCancelListener(dialog -> result.confirm())
                    .setCancelable(true)
                    .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new com.google.android.material.dialog.MaterialAlertDialogBuilder(MainActivity.this)
                    .setTitle("Konfirmasi")
                    .setMessage(message)
                    .setPositiveButton("Ya", (dialog, which) -> result.confirm())
                    .setNegativeButton("Batal", (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel())
                    .setCancelable(true)
                    .show();
                return true;
            }
        });
    }

    private void requestNecessaryPermissions() {
        List<String> perms = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                perms.add(Manifest.permission.POST_NOTIFICATIONS);
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                perms.add(Manifest.permission.BLUETOOTH_CONNECT);
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                perms.add(Manifest.permission.BLUETOOTH_SCAN);
            }
        } else {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH) != PackageManager.PERMISSION_GRANTED) {
                perms.add(Manifest.permission.BLUETOOTH);
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_ADMIN) != PackageManager.PERMISSION_GRANTED) {
                perms.add(Manifest.permission.BLUETOOTH_ADMIN);
            }
        }
        if (!perms.isEmpty()) {
            permissionLauncher.launch(perms.toArray(new String[0]));
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
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

    private void handleIncomingIntent(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data != null && data.toString().startsWith("http")) {
            webView.loadUrl(data.toString());
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null) {
            webView.evaluateJavascript(
                "(function() {" +
                "  try {" +
                "    if (window.XentraPresentation && typeof window.XentraPresentation.stackSize === 'function' && window.XentraPresentation.stackSize() > 0) {" +
                "      window.XentraPresentation.closeTop();" +
                "      return 'handled';" +
                "    }" +
                "    if (window.XentraNavigationController && typeof window.XentraNavigationController.getSnapshot === 'function') {" +
                "      var snap = window.XentraNavigationController.getSnapshot();" +
                "      if (snap && Array.isArray(snap.stack) && snap.stack.length > 1) {" +
                "        window.XentraNavigationController.back();" +
                "        return 'handled';" +
                "      }" +
                "    }" +
                "  } catch(e) {}" +
                "  return 'fallback';" +
                "})()",
                value -> {
                    if (value != null && value.contains("handled")) {
                        return;
                    }
                    if (webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        MainActivity.super.onBackPressed();
                    }
                }
            );
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
}
