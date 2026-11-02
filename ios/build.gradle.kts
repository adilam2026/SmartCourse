plugins {
    // Mêmes versions de Kotlin et de sérialisation que l'application Android (android-native/build.gradle.kts).
    id("org.jetbrains.kotlin.multiplatform") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.0.21" apply false
    // Compose Multiplatform 1.7 = Compose 1.7 (même génération que le BOM Android 2024.12.01).
    id("org.jetbrains.compose") version "1.7.3" apply false
}
