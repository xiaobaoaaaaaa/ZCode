package com.example.zcode_mobile

import android.content.Intent
import android.os.Bundle
import android.net.Uri
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.SideEffect
import androidx.core.view.WindowCompat
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.example.zcode_mobile.remote.RemoteControlUrlPolicy
import com.example.zcode_mobile.ui.RemoteControlApp
import com.example.zcode_mobile.ui.RemoteNavigation
import com.example.zcode_mobile.ui.theme.ZcodemobileTheme

class MainActivity : ComponentActivity() {
    private var pageDarkTheme by mutableStateOf<Boolean?>(null)
    private var navigation by mutableStateOf(RemoteNavigation(BuildConfig.REMOTE_CONTROL_DEFAULT_URL, 0))

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (BuildConfig.DEBUG) android.webkit.WebView.setWebContentsDebuggingEnabled(true)
        // Bugfix: 重建时不保存/重放 OAuth code 或旧 SID；最近电脑由 Web 的 MID 偏好恢复。
        if (savedInstanceState == null) resolveRemoteUrlFromIntent(intent)?.let(::openRemoteUrl)
        else savedInstanceState.getString("entryOrigin")?.let(::openRemoteUrl)
        setContent {
            val darkTheme = pageDarkTheme ?: isSystemInDarkTheme()
            SideEffect {
                WindowCompat.getInsetsController(window, window.decorView).apply {
                    isAppearanceLightStatusBars = !darkTheme
                    isAppearanceLightNavigationBars = !darkTheme
                }
            }
            ZcodemobileTheme(darkTheme = darkTheme) {
                RemoteControlApp(navigation = navigation, onOpenUrl = ::openRemoteUrl, onThemeChanged = { pageDarkTheme = it })
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        resolveRemoteUrlFromIntent(intent)?.let(::openRemoteUrl)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        // 只保存已校验入口的 origin/path，避免重建时重放 OAuth 或已失效的 SID；也保留本地调试入口。
        outState.putString("entryOrigin", Uri.parse(navigation.url).buildUpon().clearQuery().fragment(null).build().toString())
        super.onSaveInstanceState(outState)
    }

    private fun openRemoteUrl(raw: String): Boolean {
        val url = RemoteControlUrlPolicy.resolve(raw) ?: return false
        navigation = RemoteNavigation(url, navigation.generation + 1)
        return true
    }

    private fun resolveRemoteUrlFromIntent(intent: Intent?): String? {
        if (intent == null) return null
        return RemoteControlUrlPolicy.resolve(intent.data)
            ?: RemoteControlUrlPolicy.resolve(intent.getStringExtra(Intent.EXTRA_TEXT))
    }
}
