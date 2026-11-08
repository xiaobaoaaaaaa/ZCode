package com.example.zcode_mobile

import android.net.Uri
import android.webkit.WebResourceRequest
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.example.zcode_mobile.remote.BundledRemoteContent
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Verifies the actual APK assets and WebView request interception boundary on Android. */
@RunWith(AndroidJUnit4::class)
class BundledRemoteContentTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun packagedEntryAndItsScriptAreReadableWithoutNetwork() {
        val entry = BundledRemoteContent.intercept(context, Request("https://zcode.z.ai/remote/v4"))
        assertNotNull("APK contains the v4 entry", entry)
        assertEquals("text/html", entry!!.mimeType)
        // Personal APK 版本与远控页面兼容版本不同；桌面二维码的兼容版本仍必须命中内置页面。
        val versioned = BundledRemoteContent.intercept(context, Request("https://zcode.z.ai/remote/v4?app_version=${BuildConfig.REMOTE_FRONTEND_VERSION}"))
        assertNotNull("Compatible desktop QR uses bundled page", versioned)
        versioned!!.data.close()
        val html = entry.data.bufferedReader().use { it.readText() }
        assertTrue(html.contains("<html"))
        val script = Regex("src=\"(/remote/v4/[^\"]+\\.js)\"").find(html)?.groupValues?.get(1)
        assertNotNull("Bundled HTML references a bundled script", script)
        val js = BundledRemoteContent.intercept(context, Request("https://zcode.z.ai$script"))
        assertNotNull(js)
        assertEquals("application/javascript", js!!.mimeType)
        js.data.use { assertTrue("Script has content", it.read() >= 0) }
    }

    @Test fun apiOtherVersionsAndUntrustedPathsStayOutsideBundle() {
        listOf(
            "https://zcode.z.ai/api/v1/remote/device",
            "https://zcode.z.ai/remote/v4?app_version=0.0.0-not-this-build",
            "https://other.example/remote/v4",
            "https://zcode.z.ai:444/remote/v4",
            "http://zcode.z.ai/remote/v4",
            "https://user:password@zcode.z.ai/remote/v4",
            "https://zcode.z.ai/remote/v4/../index.html",
            "https://zcode.z.ai/remote/v4/%2e%2e/index.html",
            "https://zcode.z.ai/remote/v4/assets/private.js.map",
        ).forEach { assertNull("Intercepted non-bundle request: $it", BundledRemoteContent.intercept(context, Request(it))) }
        assertNull(BundledRemoteContent.intercept(context, Request("https://zcode.z.ai/remote/v4", "POST")))
    }

    private class Request(private val value: String, private val verb: String = "GET") : WebResourceRequest {
        override fun getUrl() = Uri.parse(value)
        override fun isForMainFrame() = true
        override fun isRedirect() = false
        override fun hasGesture() = false
        override fun getMethod() = verb
        override fun getRequestHeaders() = emptyMap<String, String>()
    }
}
