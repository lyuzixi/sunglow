plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.sunglow.spectrum"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.sunglow.spectrum"
        minSdk = 26
        targetSdk = 36
        versionCode = (System.getenv("SUNGLOW_VERSION_CODE") ?: "1").toIntOrNull() ?: 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // 正式包签名从环境变量读取；没有配置时保持未签名，CI 只产出 debug 包
            val storePath = System.getenv("SUNGLOW_KEYSTORE_PATH")
            if (!storePath.isNullOrBlank()) {
                signingConfig = signingConfigs.create("release") {
                    storeFile = file(storePath)
                    storePassword = System.getenv("SUNGLOW_KEYSTORE_PASSWORD")
                    keyAlias = System.getenv("SUNGLOW_KEY_ALIAS")
                    keyPassword = System.getenv("SUNGLOW_KEY_PASSWORD")
                }
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

/* CI 需要拿到测试打印的 pack 原文，做一次网页侧反解校验 */
tasks.withType<org.gradle.api.tasks.testing.Test>().configureEach {
    testLogging { showStandardStreams = true }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)
    implementation("org.osmdroid:osmdroid-android:6.1.20")
    implementation("com.google.zxing:core:3.5.3")
    implementation("androidx.work:work-runtime-ktx:2.10.0")

    testImplementation(libs.junit)
}
