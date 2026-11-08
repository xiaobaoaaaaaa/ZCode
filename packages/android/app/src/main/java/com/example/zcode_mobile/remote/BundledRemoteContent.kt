package com.example.zcode_mobile.remote

import android.content.Context
import android.webkit.MimeTypeMap
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import com.example.zcode_mobile.BuildConfig
import java.io.IOException

/** 保持生产 HTTPS origin，使 Web 的 OAuth、Cookie、API 与浏览器版使用相同语义。 */
object BundledRemoteContent {
    fun intercept(context: Context, request: WebResourceRequest): WebResourceResponse? {
        val uri = request.url
        if (request.method != "GET" || uri.scheme != "https" || uri.host != "zcode.z.ai" ||
            uri.userInfo != null || uri.port !in listOf(-1, 443)) return null
        val path = uri.path ?: return null
        val isEntry = path.trimEnd('/') == "/remote/v4"
        val requestedVersion = uri.getQueryParameter("app_version")
        // 其他桌面版本仍交给既有服务端版本路由，不能用本包覆盖不兼容的前端。
        if (isEntry && requestedVersion != null && requestedVersion != BuildConfig.REMOTE_FRONTEND_VERSION) return null
        val relative = if (isEntry) "index.html" else path.removePrefix("/remote/v4/")
        if (!isEntry && !path.startsWith("/remote/v4/")) return null
        if (relative.split('/').any { it == ".." || it == "." || it.isEmpty() } ||
            relative.contains('\\') || relative.endsWith(".map")) return null
        val stream = try { context.assets.open("remote/$relative") } catch (_: IOException) { return null }
        val extension = relative.substringAfterLast('.', "")
        val mime = when (extension) {
            "js", "mjs" -> "application/javascript"
            "css" -> "text/css"
            "html" -> "text/html"
            "json" -> "application/json"
            "svg" -> "image/svg+xml"
            "wasm" -> "application/wasm"
            else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) ?: "application/octet-stream"
        }
        return WebResourceResponse(mime, "UTF-8", 200, "OK",
            mapOf("Cache-Control" to "no-cache", "X-Content-Type-Options" to "nosniff"), stream)
    }
}
