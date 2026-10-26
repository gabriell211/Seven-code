plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.seven.code"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.seven.code"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0-preview.1"
        if (providers.gradleProperty("sevenPreviewIsolated").orNull == "true") {
            versionCode = 5
            versionName = "0.2.0-preview.5"
        }
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // The app label is materialized by Gradle so isolated preview builds
        // are visibly distinguishable from an installed Seven Code release.
        manifestPlaceholders["sevenAppLabel"] = "Seven Code"
    }

    // Android's nativeLibraryDir must contain an executable Bionic
    // libnode.so file for ProcessBuilder; unextracted APK ELF is unusable.
    packaging {
        jniLibs {
            useLegacyPackaging = true
            // Keep original GNU ELF bytes intact in the experimental APK.
            // Their SHA-256 hashes are verified again by the Android runtime.
            keepDebugSymbols.add("**/libseven-gnu-node.so")
            keepDebugSymbols.add("**/libseven-gnu-loader.so")
        }
    }

    buildTypes {
        debug {
            // GitHub runners generate a different DEBUG signing key each time.
            // Do not pretend that an APK signed on a new runner can safely
            // replace a prior preview with the same application ID. These
            // disposable Android Web previews install next to the user's
            // existing Seven Code without touching its documents or settings.
            if (providers.gradleProperty("sevenPreviewIsolated").orNull == "true") {
                applicationIdSuffix = ".preview5"
                versionNameSuffix = "-isolated"
                manifestPlaceholders["sevenAppLabel"] = "Seven Code Preview 5"
            }
            // Debug-only GNU/glibc research must install alongside the real
            // Seven Code without changing its private files or OAuth session.
            // Never use this package ID for a published release.
            if (providers.gradleProperty("sevenGnuExperiment").orNull == "true") {
                check(providers.gradleProperty("sevenPreviewIsolated").orNull != "true") {
                    "GNU diagnostic and Web preview packages cannot share one APK"
                }
                applicationIdSuffix = ".gnu"
                versionNameSuffix = "-gnu-test"
                manifestPlaceholders["sevenAppLabel"] = "Seven Code GNU Test"
            }
        }
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(project(":terminal"))
    implementation("androidx.webkit:webkit:1.15.0")
    implementation("androidx.documentfile:documentfile:1.0.1")
    androidTestImplementation("androidx.test:core:1.6.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}
