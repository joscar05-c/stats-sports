package com.courtvision.stats;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

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
}
