import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

val repositoryRoot = rootProject.projectDir.resolve("../..")
val appVersion = (groovy.json.JsonSlurper().parse(repositoryRoot.resolve("package.json")) as Map<*, *>)["version"] as String
// 与桌面二维码/Bootstrap 使用同一个公开解析器，Personal 版本不能回退到官方远控前端。
val remoteFrontendVersion = providers.exec {
    workingDir(repositoryRoot)
    commandLine("pnpm", "--filter", "@zcode/web", "exec", "tsx", "-e",
        "import { resolveWebRemoteControlPageVersion } from '@zcode/shared'; console.log(resolveWebRemoteControlPageVersion(${groovy.json.JsonOutput.toJson(appVersion)}));")
}.standardOutput.asText.get().trim()

val androidVersion = Properties().apply {
    rootProject.file("version.properties").inputStream().use { load(it) }
}
val signingPath = System.getenv("ANDROID_KEYSTORE_PATH")
val isReleaseRequested = gradle.startParameter.taskNames.any { it.contains("release", ignoreCase = true) }
if (isReleaseRequested) {
    listOf("ANDROID_KEYSTORE_PATH", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD").forEach {
        require(!System.getenv(it).isNullOrBlank()) { "Missing release signing variable: $it" }
    }
}

android {
    namespace = "com.example.zcode_mobile"
    buildToolsVersion = "36.1.0"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "io.github.xiaobaoaaaaaa.zcode"
        minSdk = 24
        targetSdk = 36
        versionCode = androidVersion.getProperty("VERSION_CODE").toInt().also { require(it > 0) }
        versionName = appVersion
        buildConfigField("String", "REMOTE_FRONTEND_VERSION", groovy.json.JsonOutput.toJson(remoteFrontendVersion))

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        buildConfigField("String", "REMOTE_CONTROL_DEFAULT_URL", "\"https://zcode.z.ai/remote/v4\"")
    }

    signingConfigs {
        create("personalRelease") {
            if (!signingPath.isNullOrBlank()) {
                storeFile = file(signingPath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            buildConfigField("String", "REMOTE_CONTROL_DEFAULT_URL", "\"https://zcode.z.ai/remote/v4\"")
        }
        release {
            signingConfig = signingConfigs.getByName("personalRelease")
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)
    implementation(libs.mlkit.barcode.scanning)
    testImplementation(libs.junit)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.junit)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
    debugImplementation(libs.androidx.compose.ui.tooling)
}

// APK 与桌面共享 React 入口。前端资源作为构建产物，不提交复制源码。

val webOutput = layout.buildDirectory.dir("generated/remoteAssets/remote")
val bundleRemoteWeb by tasks.registering(Exec::class) {
    workingDir(repositoryRoot)
    environment("ZCODE_ENV", "production")
    environment("WEB_REMOTE_FRONTEND_VERSION", remoteFrontendVersion)
    inputs.property("remoteFrontendVersion", remoteFrontendVersion)
    commandLine("pnpm", "--filter", "@zcode/web", "exec", "vite", "build",
        "--base=/remote/v4/", "--outDir=${webOutput.get().asFile.absolutePath}", "--emptyOutDir")
    inputs.files(fileTree(repositoryRoot.resolve("packages")) {
        include("**/src/**", "**/vite/**", "**/public/**", "**/package.json", "web/vite.config.ts", "web/index.html")
        exclude("**/node_modules/**", "**/build/**", "**/dist/**", "android/**")
    })
    inputs.files(repositoryRoot.resolve("pnpm-lock.yaml"), repositoryRoot.resolve("package.json"))
    outputs.dir(webOutput)
    doLast {
        // 隐藏 sourcemap 不应随 APK 发布。
        delete(fileTree(webOutput) { include("**/*.map") })
    }
}
android.sourceSets.getByName("main").assets.srcDir(layout.buildDirectory.dir("generated/remoteAssets").get().asFile)
tasks.named("preBuild").configure { dependsOn(bundleRemoteWeb) }
