package com.example.zcode_mobile.remote

import android.net.Uri
import com.example.zcode_mobile.BuildConfig

/** 导航白名单只表达可信入口，不承担设备身份或账号鉴权。 */
object RemoteControlUrlPolicy {
    fun resolve(raw: String?): String? = runCatching {
        raw?.trim()?.takeIf { it.isNotEmpty() && it.length <= 8192 }?.let { resolve(Uri.parse(it)) }
    }.getOrNull()

    fun resolve(uri: Uri?): String? {
        uri ?: return null
        if (uri.scheme == "zcode" && uri.host == "remote" && uri.userInfo == null && uri.port == -1) {
            return Uri.parse(BuildConfig.REMOTE_CONTROL_DEFAULT_URL).buildUpon()
                .encodedQuery(uri.encodedQuery).encodedFragment(uri.encodedFragment).build().toString()
        }
        if (!isAllowedRemoteUrl(uri)) return null
        // Bugfix: 旧二维码 /remote 是遗留路由，统一进入已有账号和 MID 恢复机制的 v4。
        return if (uri.path?.trimEnd('/') == "/remote") uri.buildUpon().path("/remote/v4").build().toString()
        else uri.toString()
    }

    fun isAllowedRemoteUrl(raw: String?): Boolean = resolve(raw) != null

    fun isAllowedInWebView(uri: Uri): Boolean {
        if (resolve(uri) != null) return true
        // Bugfix: OAuth 必须与发起方保留相同 WebView 存储，外部浏览器无法读取 pending nonce。
        return uri.scheme == "https" && uri.userInfo == null && uri.port in listOf(-1, 443) &&
            uri.host?.lowercase() in setOf("chat.z.ai", "bigmodel.cn", "open.bigmodel.cn")
    }

    private fun isAllowedRemoteUrl(uri: Uri): Boolean {
        if (uri.userInfo != null || (uri.fragment?.length ?: 0) > 4096) return false
        val path = uri.path?.trimEnd('/')
        // Bugfix: startsWith 接受 /remote-evil；私网前缀匹配会错误信任 10.attacker.example。
        if (path !in setOf("/remote", "/remote/v4", "/remote/__test__")) return false
        val host = uri.host?.lowercase() ?: return false
        if (uri.scheme == "https" && host == "zcode.z.ai" && uri.port in listOf(-1, 443)) return true
        return BuildConfig.DEBUG && uri.scheme in setOf("http", "https") && isDebugHost(host)
    }

    private fun isDebugHost(host: String): Boolean {
        if (host == "localhost" || host == "::1" || host == "[::1]") return true
        if (host.endsWith(".local") && host.matches(Regex("[a-z0-9.-]+"))) return true
        val bytes = host.split('.').map { it.toIntOrNull() ?: return false }
        if (bytes.size != 4 || bytes.any { it !in 0..255 }) return false
        return bytes[0] == 127 || bytes[0] == 10 ||
            (bytes[0] == 192 && bytes[1] == 168) ||
            (bytes[0] == 172 && bytes[1] in 16..31)
    }
}
