package com.example.zcode_mobile.ui

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.view.ViewGroup
import android.view.MotionEvent
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.example.zcode_mobile.BuildConfig
import com.example.zcode_mobile.R
import com.example.zcode_mobile.remote.BundledRemoteContent
import com.example.zcode_mobile.remote.RemoteControlUrlPolicy
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

data class RemoteNavigation(val url: String, val generation: Long)

@Composable
fun RemoteControlApp(navigation: RemoteNavigation, onOpenUrl: (String) -> Boolean, onThemeChanged: (Boolean?) -> Unit) {
    val context = LocalContext.current
    var scannerOpen by rememberSaveable { mutableStateOf(false) }
    var linkOpen by rememberSaveable { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    val denied = stringResource(R.string.remote_scan_permission_denied)
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        if (it) scannerOpen = true else notice = denied
    }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Box(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
            // 扫码覆盖现有页面而不是切走 composition，避免销毁 WebView 中的登录与连接上下文。
            RemoteControlWebViewScreen(
                navigation = navigation,
                onThemeChanged = onThemeChanged,
                onComputers = { onOpenUrl(BuildConfig.REMOTE_CONTROL_DEFAULT_URL + "?devices=1") },
                onScan = {
                    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        scannerOpen = true
                    } else permission.launch(Manifest.permission.CAMERA)
                },
                onLink = { linkOpen = true },
            )
            if (scannerOpen) Surface(Modifier.fillMaxSize()) {
                RemoteControlQrScanner(onClose = { scannerOpen = false }, onScanned = {
                    onOpenUrl(it).also { accepted -> if (accepted) scannerOpen = false }
                })
            }
        }
    }
    if (linkOpen) RemoteLinkDialog(onDismiss = { linkOpen = false }, onOpen = {
        onOpenUrl(it).also { accepted -> if (accepted) linkOpen = false }
    })
    notice?.let {
        AlertDialog(onDismissRequest = { notice = null }, text = { Text(it) },
            confirmButton = { TextButton(onClick = { notice = null }) { Text(stringResource(R.string.remote_close_button)) } })
    }
}

@Composable
private fun RemoteLinkDialog(onDismiss: () -> Unit, onOpen: (String) -> Boolean) {
    var input by rememberSaveable { mutableStateOf("") }
    var invalid by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.remote_url_label), style = MaterialTheme.typography.titleMedium) },
        text = { OutlinedTextField(value = input, onValueChange = { input = it; invalid = false },
            modifier = Modifier.testTag("remote-link-input"), minLines = 2, maxLines = 5,
            isError = invalid, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            supportingText = { if (invalid) Text(stringResource(R.string.remote_url_invalid)) }) },
        confirmButton = { TextButton(modifier = Modifier.testTag("remote-link-open"), onClick = { invalid = !onOpen(input) }) { Text(stringResource(R.string.remote_open_button)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.remote_close_button)) } },
    )
}

@Composable
private fun RemoteControlQrScanner(
    onClose: () -> Unit,
    onScanned: (String) -> Boolean,
) {
    var scanError by rememberSaveable { mutableStateOf<String?>(null) }

    BackHandler(onBack = onClose)

    Box(modifier = Modifier.fillMaxSize()) {
        RemoteQrCameraPreview(
            onScanned = onScanned,
            onCameraError = {
                scanError = it
            },
        )
        Surface(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .statusBarsPadding(),
            color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = stringResource(R.string.remote_scan_title),
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Text(
                        text = stringResource(R.string.remote_scan_hint),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                TextButton(onClick = onClose) {
                    Text(stringResource(R.string.remote_close_button))
                }
            }
        }
        scanError?.let { message ->
            Surface(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(16.dp),
                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f),
                tonalElevation = 2.dp,
            ) {
                Text(
                    text = message,
                    modifier = Modifier.padding(14.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}

@Composable
private fun RemoteQrCameraPreview(
    onScanned: (String) -> Boolean,
    onCameraError: (String) -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val scanner = remember {
        BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .build(),
        )
    }
    val cameraExecutor = remember { Executors.newSingleThreadExecutor() }
    val consumed = remember { AtomicBoolean(false) }
    val disposed = remember { AtomicBoolean(false) }
    var cameraProvider by remember { mutableStateOf<ProcessCameraProvider?>(null) }
    val invalidQrMessage = stringResource(R.string.remote_scan_invalid)

    DisposableEffect(Unit) {
        onDispose {
            disposed.set(true)
            cameraProvider?.unbindAll()
            scanner.close()
            cameraExecutor.shutdown()
        }
    }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { viewContext ->
            PreviewView(viewContext).apply {
                scaleType = PreviewView.ScaleType.FILL_CENTER
                implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                bindRemoteQrCamera(
                    context = context,
                    lifecycleOwner = lifecycleOwner,
                    previewView = this,
                    scanner = scanner,
                    cameraExecutor = cameraExecutor,
                    consumed = consumed,
                    disposed = disposed,
                    onProviderReady = { provider ->
                        cameraProvider = provider
                    },
                    onScanned = { raw ->
                        val accepted = onScanned(raw)
                        if (!accepted) {
                            onCameraError(invalidQrMessage)
                            consumed.set(false)
                        }
                    },
                    onCameraError = onCameraError,
                )
            }
        },
    )
}

private fun bindRemoteQrCamera(
    context: Context,
    lifecycleOwner: LifecycleOwner,
    previewView: PreviewView,
    scanner: BarcodeScanner,
    cameraExecutor: ExecutorService,
    consumed: AtomicBoolean,
    disposed: AtomicBoolean,
    onProviderReady: (ProcessCameraProvider) -> Unit,
    onScanned: (String) -> Unit,
    onCameraError: (String) -> Unit,
) {
    val providerFuture = ProcessCameraProvider.getInstance(context)
    providerFuture.addListener(
        {
            val provider = runCatching { providerFuture.get() }
                .getOrElse { error ->
                    previewView.post {
                        if (!disposed.get()) onCameraError(error.message ?: context.getString(R.string.remote_scan_camera_failed))
                    }
                    return@addListener
                }
            if (disposed.get()) {
                provider.unbindAll()
                return@addListener
            }

            onProviderReady(provider)
            val preview = Preview.Builder().build().also {
                it.surfaceProvider = previewView.surfaceProvider
            }
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
                .also { imageAnalysis ->
                    imageAnalysis.setAnalyzer(cameraExecutor) { imageProxy ->
                        analyzeRemoteQrImage(
                            scanner = scanner,
                            imageProxy = imageProxy,
                            consumed = consumed,
                            disposed = disposed,
                            previewView = previewView,
                            onScanned = onScanned,
                        )
                    }
                }

            runCatching {
                provider.unbindAll()
                provider.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    analysis,
                )
            }.onFailure { error ->
                previewView.post {
                    if (!disposed.get()) onCameraError(error.message ?: context.getString(R.string.remote_scan_camera_failed))
                }
            }
        },
        ContextCompat.getMainExecutor(context),
    )
}

@androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
private fun analyzeRemoteQrImage(
    scanner: BarcodeScanner,
    imageProxy: ImageProxy,
    consumed: AtomicBoolean,
    disposed: AtomicBoolean,
    previewView: PreviewView,
    onScanned: (String) -> Unit,
) {
    if (disposed.get() || consumed.get()) {
        imageProxy.close()
        return
    }

    val mediaImage = imageProxy.image
    if (mediaImage == null) {
        imageProxy.close()
        return
    }

    val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
    scanner.process(image)
        .addOnSuccessListener { barcodes ->
            val rawValue = barcodes.firstNotNullOfOrNull { barcode ->
                barcode.rawValue?.takeIf { it.isNotBlank() }
            }
            if (!disposed.get() && rawValue != null && consumed.compareAndSet(false, true)) {
                previewView.post {
                    // Bugfix: 扫码页关闭后 ML Kit 仍可能返回结果，不能让迟到结果切换正在使用的电脑。
                    if (!disposed.get()) onScanned(rawValue)
                }
            }
        }
        .addOnFailureListener {
            // Bugfix: ML Kit 失败后释放本帧，下一帧可以继续扫码。
            consumed.set(false)
        }
        .addOnCompleteListener {
            imageProxy.close()
        }
}


@Composable
private fun RemoteControlWebViewScreen(
    navigation: RemoteNavigation,
    onComputers: () -> Unit,
    onThemeChanged: (Boolean?) -> Unit,
    onScan: () -> Unit,
    onLink: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var webView by remember { mutableStateOf<WebView?>(null) }
    var progress by remember { mutableIntStateOf(100) }
    var pageError by remember { mutableStateOf(false) }
    var rendererEpoch by remember { mutableIntStateOf(0) }
    var rendererGone by remember { mutableStateOf(false) }
    var chooserCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
    var chooserInFlight by remember { mutableStateOf(false) }
    val chooser = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = chooserCallback
        chooserCallback = null
        chooserInFlight = false
        callback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
    }
    LaunchedEffect(navigation.generation) {
        // 切换电脑不能把旧页面的文件选择结果送给新页面；renderer 崩溃后的显式导航也需重建。
        chooserCallback?.onReceiveValue(null)
        chooserCallback = null
        if (rendererGone) { rendererGone = false; rendererEpoch++ }
    }
    val retry = {
        pageError = false
        if (rendererGone) { rendererGone = false; rendererEpoch++ } else webView?.reload()
        Unit
    }
    BackHandler(enabled = true) {
        if (webView?.canGoBack() == true) webView?.goBack() else (context as? Activity)?.moveTaskToBack(true)
    }
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> webView?.let { it.onResume(); readPageTheme(it, onThemeChanged) }
                Lifecycle.Event.ON_PAUSE -> { webView?.onPause(); CookieManager.getInstance().flush() }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            chooserCallback?.onReceiveValue(null)
            chooserCallback = null
            webView?.let { (it.parent as? ViewGroup)?.removeView(it); it.destroy() }
            webView = null
        }
    }
    Column(Modifier.fillMaxSize()) {
        Surface(color = MaterialTheme.colorScheme.surface) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onComputers, modifier = Modifier.testTag("remote-computers")) { Text(stringResource(R.string.remote_computers)) }
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onScan, modifier = Modifier.testTag("remote-scan")) { Text(stringResource(R.string.remote_scan_button)) }
                TextButton(onClick = onLink, modifier = Modifier.testTag("remote-link")) { Text(stringResource(R.string.remote_link_button)) }
                TextButton(onClick = retry, modifier = Modifier.testTag("remote-reload")) { Text(stringResource(R.string.remote_reload_button)) }
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        if (progress < 100 && !pageError) LinearProgressIndicator(progress = { progress / 100f }, modifier = Modifier.fillMaxWidth().height(2.dp))
        Box(Modifier.weight(1f)) {
            key(rendererEpoch) {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { createRemoteControlWebView(context,
                        onProgress = { progress = it },
                        onThemeChanged = onThemeChanged,
                        onError = { pageError = true },
                        // Bugfix: API 36.1 WebView 实测 HTTP 500 先回调错误、再回调 pageStarted。
                        // 开始通知不能清除同一导航的失败，只有显式重试/新导航可以清错。
                        onPageStarted = { progress = 0 },
                        onRendererGone = { gone ->
                            // Bugfix: 崩溃的 renderer 不可 reload；移除并等待用户重试创建全新 WebView。
                            (gone.parent as? ViewGroup)?.removeView(gone)
                            gone.destroy()
                            webView = null
                            rendererGone = true
                            pageError = true
                            chooserCallback?.onReceiveValue(null)
                            chooserCallback = null
                        },
                        onFileChooser = { callback, params ->
                            // 旧 picker 尚未返回时拒绝新请求，避免旧 ActivityResult 被交给新页面。
                            if (chooserInFlight) callback.onReceiveValue(null)
                            else {
                                chooserCallback = callback
                                chooserInFlight = true
                                runCatching { chooser.launch(params.createIntent()) }.onFailure {
                                    chooserCallback?.onReceiveValue(null)
                                    chooserCallback = null
                                    chooserInFlight = false
                                }
                            }
                        },
                    ).also { webView = it } },
                    update = { view ->
                        // Bugfix: 页面自己会更新 SID/history/OAuth URL。只比较原生导航代次，不能拿 view.url 回写初始地址。
                        if (!rendererGone && view.tag != navigation.generation) {
                            view.tag = navigation.generation
                            pageError = false
                            view.loadUrl(navigation.url)
                        }
                    },
                )
            }
            if (pageError) Surface(Modifier.fillMaxSize()) {
                Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.Center) {
                    Text(stringResource(R.string.remote_load_failed_title), style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(8.dp))
                    Text(stringResource(R.string.remote_load_failed_description), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(16.dp))
                    Row {
                        Button(onClick = retry, modifier = Modifier.testTag("remote-retry"), shape = MaterialTheme.shapes.medium) { Text(stringResource(R.string.remote_retry_button)) }
                        TextButton(onClick = onComputers) { Text(stringResource(R.string.remote_computers)) }
                    }
                }
            }
        }
    }
}

// onTouch 只观察主题变化并始终返回 false，点击与可访问性仍交给 WebView 原生处理。
@SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
private fun createRemoteControlWebView(
    context: Context,
    onProgress: (Int) -> Unit,
    onThemeChanged: (Boolean?) -> Unit,
    onError: () -> Unit,
    onPageStarted: () -> Unit,
    onRendererGone: (WebView) -> Unit,
    onFileChooser: (ValueCallback<Array<Uri>>, WebChromeClient.FileChooserParams) -> Unit,
): WebView = WebView(context).apply {
    layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    overScrollMode = WebView.OVER_SCROLL_NEVER
    CookieManager.getInstance().setAcceptCookie(true)
    settings.apply {
        javaScriptEnabled = true
        domStorageEnabled = true
        cacheMode = WebSettings.LOAD_DEFAULT
        setSupportZoom(false)
        allowFileAccess = false
        allowContentAccess = true
        mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        userAgentString = "$userAgentString ZCodeAndroid/${BuildConfig.VERSION_NAME}"
    }
    setOnTouchListener { view, event ->
        if (event.action == MotionEvent.ACTION_UP) view.post { readPageTheme(this, onThemeChanged) }
        false
    }
    webChromeClient = object : WebChromeClient() {
        override fun onProgressChanged(view: WebView?, newProgress: Int) = onProgress(newProgress)
        override fun onShowFileChooser(view: WebView?, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            onFileChooser(callback, params)
            return true
        }
    }
    webViewClient = object : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest): WebResourceResponse? =
            BundledRemoteContent.intercept(context, request)
        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) = onPageStarted()
        override fun onPageFinished(view: WebView?, url: String?) { view?.let { readPageTheme(it, onThemeChanged) } }
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (!request.isForMainFrame) return false
            if (request.url.scheme == "zcode") {
                RemoteControlUrlPolicy.resolve(request.url)?.let(view::loadUrl)
                return true
            }
            if (RemoteControlUrlPolicy.isAllowedInWebView(request.url)) return false
            // 普通外链只能使用浏览器的 HTTP(S)；不允许任意 intent/file/content scheme。
            if (request.url.scheme in listOf("https", "http")) {
                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
            }
            return true
        }
        override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
            if (request?.isForMainFrame == true) onError()
        }
        override fun onReceivedHttpError(view: WebView?, request: WebResourceRequest?, errorResponse: WebResourceResponse?) {
            if (request?.isForMainFrame == true) onError()
        }
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            onRendererGone(view)
            return true
        }
    }
}

private fun readPageTheme(view: WebView, onThemeChanged: (Boolean?) -> Unit) {
    val sampledUrl = view.url
    if (RemoteControlUrlPolicy.resolve(sampledUrl) == null) return
    // 只读取受信远控页面的主题枚举，不注入原生 JS bridge，不读取账号或凭据。
    view.evaluateJavascript("""(() => {
      const classes = document.documentElement.classList;
      if (classes.contains('theme-zai-dark') || classes.contains('dark')) return 'dark';
      if (classes.contains('theme-zai-light')) return 'light';
      const theme = localStorage.getItem('zcode-theme');
      if (theme === 'zai-dark' || theme === 'dark') return 'dark';
      if (theme === 'zai-light' || theme === 'light') return 'light';
      return 'system';
    })()""") { value ->
        if (view.url != sampledUrl) return@evaluateJavascript
        onThemeChanged(when (value) { "\"dark\"" -> true; "\"light\"" -> false; else -> null })
    }
}
