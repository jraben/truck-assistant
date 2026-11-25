plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.jeffraben.tacompanion"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.jeffraben.tacompanion"
        minSdk = 26
        targetSdk = 34
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")
    }
    // One fixed key (android/keystore/companion.jks, a sideload-only key, not a Play Store one) so each
    // new build installs over the last without uninstalling. Its password is not a secret: anyone who
    // can read this repo could already build the app.
    signingConfigs {
        create("companion") {
            storeFile = file("../keystore/companion.jks")
            storePassword = "tacompanion"
            keyAlias = "companion"
            keyPassword = "tacompanion"
        }
    }
    buildTypes {
        getByName("debug") { signingConfig = signingConfigs.getByName("companion") }
        getByName("release") { signingConfig = signingConfigs.getByName("companion"); isMinifyEnabled = false }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
