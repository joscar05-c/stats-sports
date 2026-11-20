package com.courtvision.stats;

import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import androidx.core.content.pm.PackageInfoCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.io.File;

public class MainActivity extends BridgeActivity {
    private static final String PREFS_NAME = "cv_app_prefs";
    private static final String KEY_LAST_VERSION_CODE = "last_webview_version_code";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        boolean versionChanged = clearStaleWebViewCacheOnUpgrade();
        registerPlugin(NativeGoogleAuthPlugin.class);
        super.onCreate(savedInstanceState);

        if (versionChanged && getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().clearCache(true);
        }

        int darkBgColor = Color.parseColor("#0b0d11");
        Window window = getWindow();
        if (window != null) {
            window.setBackgroundDrawable(new ColorDrawable(darkBgColor));
            window.setStatusBarColor(darkBgColor);
            window.setNavigationBarColor(darkBgColor);
            WindowCompat.setDecorFitsSystemWindows(window, false);

            View decorView = window.getDecorView();
            WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, decorView);
            if (controller != null) {
                // Keep status/navigation icons light against the dark #0b0d11 theme
                controller.setAppearanceLightStatusBars(false);
                controller.setAppearanceLightNavigationBars(false);
            }
        }

        // Pad the root content view by system bars + display cutout ("Dynamic Island" / punch-hole)
        // and IME keyboard height so Android 15/16 edge-to-edge never overlaps app headers/controls.
        View contentView = findViewById(android.R.id.content);
        if (contentView != null) {
            contentView.setBackgroundColor(darkBgColor);
            ViewCompat.setOnApplyWindowInsetsListener(contentView, (view, windowInsets) -> {
                Insets safeInsets = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                );
                Insets imeInsets = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
                int bottomPadding = Math.max(safeInsets.bottom, imeInsets.bottom);

                view.setPadding(safeInsets.left, safeInsets.top, safeInsets.right, bottomPadding);
                return WindowInsetsCompat.CONSUMED;
            });
            ViewCompat.requestApplyInsets(contentView);
        }
    }

    /**
     * Purges stale WebView Service Worker and HTTP/CacheStorage files when versionCode increases
     * so Play Store updates never stay pinned to an older cached JS bundle.
     */
    private boolean clearStaleWebViewCacheOnUpgrade() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            long currentCode = PackageInfoCompat.getLongVersionCode(info);
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            long lastCode = prefs.getLong(KEY_LAST_VERSION_CODE, -1L);
            if (lastCode == currentCode) {
                return false;
            }

            File dataDir = new File(getApplicationInfo().dataDir);
            File webViewRoot = new File(dataDir, "app_webview");
            File webViewDefault = new File(webViewRoot, "Default");
            String[] staleSubdirs = { "Service Worker", "Cache", "Code Cache" };
            for (String sub : staleSubdirs) {
                deleteRecursively(new File(webViewDefault, sub));
                deleteRecursively(new File(webViewRoot, sub));
            }
            deleteRecursively(new File(getCacheDir(), "WebView"));

            prefs.edit().putLong(KEY_LAST_VERSION_CODE, currentCode).apply();
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private void deleteRecursively(File target) {
        if (target == null || !target.exists()) return;
        File[] children = target.listFiles();
        if (children != null) {
            for (File child : children) {
                deleteRecursively(child);
            }
        }
        //noinspection ResultOfMethodCallIgnored
        target.delete();
    }
}
