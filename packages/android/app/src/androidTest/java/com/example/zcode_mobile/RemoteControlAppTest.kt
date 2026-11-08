package com.example.zcode_mobile

import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import android.view.View
import android.view.MotionEvent
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.Espresso.pressBackUnconditionally
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.example.zcode_mobile.remote.RemoteControlUrlPolicy
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/** Runs the native shell against a loopback page, including real navigation and Android lifecycle. */
@RunWith(AndroidJUnit4::class)
class RemoteControlAppTest {
    @get:Rule val compose = createEmptyComposeRule()

    @Test fun remoteLinksRejectLookalikeHostsAndRoutes() {
        assertNotNull(RemoteControlUrlPolicy.resolve("https://zcode.z.ai/remote/v4?sid=a&mid=computer-a"))
        assertNotNull(RemoteControlUrlPolicy.resolve("http://127.0.0.1:18080/remote/v4"))
        assertEquals("https://zcode.z.ai/remote/v4?sid=a", RemoteControlUrlPolicy.resolve("zcode://remote?sid=a"))
        listOf(
            "https://zcode.z.ai/remote-not-zcode",
            "https://zcode.z.ai.attacker.example/remote/v4",
            "http://10.attacker.example/remote/v4",
            "http://192.168.attacker.example/remote/v4",
            "http://172.16.attacker.example/remote/v4",
            "http://192.168.999.2/remote/v4",
            "https://user:password@zcode.z.ai/remote/v4",
            "file:///remote/v4",
            "javascript:alert(1)",
        ).forEach { assertNull("Accepted untrusted URL: $it", RemoteControlUrlPolicy.resolve(it)) }
    }

    @Test fun webNavigationSurvivesNativeRecompositionAndStorageSurvivesRelaunch() {
        FixtureServer().use { server ->
            launch(server.url).use { scenario ->
                awaitPage(scenario)
                val marker = js(scenario, "window.bootMarker")
                js(scenario, "localStorage.setItem('android-e2e-draft','computer-a draft'); history.replaceState({}, '', '/remote/v4?sid=computer-a'); document.querySelector('textarea').value='unsent text'; true")
                compose.onNodeWithTag("remote-link").performClick()
                pressBackUnconditionally()
                compose.waitForIdle()
                assertEquals(marker, js(scenario, "window.bootMarker"))
                assertEquals("?sid=computer-a", js(scenario, "location.search"))
                assertEquals("unsent text", js(scenario, "document.querySelector('textarea').value"))
                scenario.recreate()
            }
            // 冷启动不恢复可能过期的 SID/OAuth URL；显式回到同源 fixture 后验证存储仍在。
            launch(server.url).use { scenario ->
                awaitPage(scenario)
                assertEquals("computer-a draft", js(scenario, "localStorage.getItem('android-e2e-draft')"))
            }
        }
    }

    @Test fun mainFrameHttpFailureCanRetryWithoutClearingStorage() {
        FixtureServer().use { server ->
            launch(server.url).use { scenario ->
                awaitPage(scenario)
                js(scenario, "localStorage.setItem('android-e2e-retry','kept'); true")
                server.fail.set(true)
                compose.onNodeWithTag("remote-reload").performClick()
                waitFor("fixture returned HTTP 500") { server.failures.get() > 0 }
                try {
                    compose.waitUntil(10_000) { compose.onAllNodesWithTag("remote-retry").fetchSemanticsNodes().isNotEmpty() }
                } catch (error: AssertionError) {
                    throw AssertionError("Missing HTTP error UI after ${server.lastRequest}; page=" + js(scenario, "location.href+' '+document.body.innerText"), error)
                }
                server.fail.set(false)
                compose.onNodeWithTag("remote-retry").performClick()
                awaitPage(scenario)
                assertEquals("kept", js(scenario, "localStorage.getItem('android-e2e-retry')"))
            }
        }
    }

    @Test fun filePickerCanBeCancelledAndOpenedAgain() {
        FixtureServer().use { server ->
            launch(server.url).use { scenario ->
                awaitPage(scenario)
                repeat(2) {
                    tapFileInput(scenario)
                    val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
                    waitFor("Android file picker") {
                        automation.rootInActiveWindow?.packageName?.toString()?.endsWith("documentsui") == true
                    }
                    automation.executeShellCommand("input keyevent KEYCODE_BACK").use { descriptor ->
                        android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { it.readBytes() }
                    }
                    waitFor("return from picker") {
                        automation.rootInActiveWindow?.packageName?.toString() == "com.example.zcode_mobile"
                    }
                }
                assertEquals("ready", js(scenario, "document.body.dataset.state"))
            }
        }
    }

    private fun tapFileInput(scenario: ActivityScenario<MainActivity>) {
        // 浏览器要求文件选择具有用户激活；真实触摸覆盖原生 chooser，而非绕过安全检查的 JS click。
        val point = JSONObject(js(scenario, "JSON.stringify((()=>{ const r=document.querySelector('input[type=file]').getBoundingClientRect(); return {x:r.left+20,y:r.top+r.height/2,width:innerWidth}; })())")!!)
        var x = 0f
        var y = 0f
        scenario.onActivity {
            val web = findWebView(it.window.decorView)!!
            val origin = IntArray(2)
            web.getLocationOnScreen(origin)
            val scale = web.width / point.getDouble("width")
            x = (origin[0] + point.getDouble("x") * scale).toFloat()
            y = (origin[1] + point.getDouble("y") * scale).toFloat()
        }
        val time = SystemClock.uptimeMillis()
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val down = MotionEvent.obtain(time, time, MotionEvent.ACTION_DOWN, x, y, 0)
        val up = MotionEvent.obtain(time, time + 50, MotionEvent.ACTION_UP, x, y, 0)
        try {
            assertTrue(automation.injectInputEvent(down, true))
            assertTrue(automation.injectInputEvent(up, true))
        } finally { down.recycle(); up.recycle() }
    }

    private fun launch(url: String): ActivityScenario<MainActivity> {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        return ActivityScenario.launch(Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse(url)
        })
    }

    private fun awaitPage(scenario: ActivityScenario<MainActivity>) = waitFor("fixture ready") {
        js(scenario, "document.body && document.body.dataset.state") == "ready"
    }

    private fun waitFor(description: String, check: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 15_000
        while (SystemClock.uptimeMillis() < deadline) {
            if (check()) return
            SystemClock.sleep(100)
        }
        fail("Timed out waiting for $description")
    }

    private fun js(scenario: ActivityScenario<MainActivity>, source: String): String? {
        var answer: String? = null
        val latch = CountDownLatch(1)
        scenario.onActivity { activity ->
            val web = findWebView(activity.window.decorView)
            if (web == null) latch.countDown()
            else web.evaluateJavascript(source) { result ->
                answer = runCatching { JSONTokener(result).nextValue()?.toString() }.getOrNull()
                latch.countDown()
            }
        }
        assertTrue("JavaScript evaluation completed", latch.await(5, TimeUnit.SECONDS))
        return answer
    }

    private fun findWebView(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) for (i in 0 until view.childCount) findWebView(view.getChildAt(i))?.let { return it }
        return null
    }
}

private class FixtureServer : AutoCloseable {
    val fail = AtomicBoolean(false)
    val failures = AtomicInteger(0)
    @Volatile var lastRequest = ""
    private val clients = Executors.newCachedThreadPool()
    private val running = AtomicBoolean(true)
    private val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
    val url = "http://127.0.0.1:${server.localPort}/remote/v4"
    private val worker = thread(name = "android-remote-fixture", isDaemon = true) {
        while (running.get()) {
            val socket = runCatching { server.accept() }.getOrNull() ?: break
            // WebView 可预连接后暂不发请求；每个 socket 独立处理，不能阻塞后续真实 reload。
            clients.execute { runCatching { socket.use {
                it.soTimeout = 5_000
                val reader = it.getInputStream().bufferedReader()
                val request = reader.readLine() ?: return@use
                while (!reader.readLine().isNullOrEmpty()) { /* Consume headers. */ }
                val isFailure = fail.get() && request.contains("/remote/v4")
                val body = if (isFailure) "Fixture unavailable" else """
                    <!doctype html><html><body data-state="ready">
                    <h1>Android remote fixture</h1><textarea aria-label="Draft"></textarea>
                    <input type="file"><script>window.bootMarker=String(Math.random());</script>
                    </body></html>
                """.trimIndent()
                val bytes = body.toByteArray(Charsets.UTF_8)
                val headers = "HTTP/1.1 ${if (isFailure) "500 Internal Server Error" else "200 OK"}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n"
                it.getOutputStream().write(headers.toByteArray() + bytes)
                lastRequest = request
                if (isFailure) failures.incrementAndGet()
            } } }
        }
    }
    override fun close() {
        running.set(false)
        server.close()
        clients.shutdownNow()
        worker.join(1_000)
    }
}
