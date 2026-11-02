import org.jetbrains.kotlin.gradle.plugin.mpp.apple.XCFramework

plugins {
    id("org.jetbrains.kotlin.multiplatform")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.compose")
}

// Sources de l'application Android, compilées TELLES QUELLES pour iOS (aucune copie) : un seul code pour les écrans et les règles.
val androidSources = rootDir.resolve("../android-native/app/src/main/java")

// -Pmesure=1 : compile pour iOS TOUS les fichiers de l'application Android, sans aucune adaptation, pour relever ce qui est
// réellement réutilisable (erreurs du compilateur par fichier). Sans ce drapeau : fichiers communs + adaptations iOS (src/iosMain).
val mesure = project.findProperty("mesure") == "1"

// Fichiers propres à Android, remplacés pour iOS par leur équivalent dans src/iosMain (même nom de classes et de fonctions).
val androidOnly = listOf(
    "MainActivity.kt", "Notify.kt", "Reminders.kt", "AppUpdate.kt", "PlatformAndroid.kt", "NotificationsAndroid.kt",
    "net/HttpAndroid.kt", "net/StorageAndroid.kt",
)

// Images fournies avec l'application : les fichiers Android (drawable-nodpi), copiés tels quels en ressources Compose.
val androidImages = tasks.register<Sync>("androidImages") {
    from(rootDir.resolve("../android-native/app/src/main/res/drawable-nodpi"))
    into(layout.buildDirectory.dir("androidRes/drawable"))
}

compose.resources {
    packageOfResClass = "app.smartcourse.courses.nativeproto.res"
    publicResClass = false
    generateResClass = always
    customDirectory("commonMain", provider { layout.buildDirectory.dir("androidRes").get() })
}
tasks.matching { it.name.contains("ComposeResources", ignoreCase = true) || it.name.contains("ResourceAccessors", ignoreCase = true) }
    .configureEach { dependsOn(androidImages) }

kotlin {
    val xcf = XCFramework("Courses")
    listOf(iosArm64(), iosSimulatorArm64()).forEach {
        it.binaries.framework {
            baseName = "Courses"
            isStatic = true
            xcf.add(this)
        }
    }

    sourceSets {
        commonMain {
            kotlin.srcDir(androidSources)
            if (!mesure) kotlin.exclude(androidOnly.map { "app/smartcourse/courses/nativeproto/$it" })
            dependencies {
                implementation(compose.runtime)
                implementation(compose.foundation)
                implementation(compose.material3)
                implementation(compose.materialIconsExtended)
                implementation(compose.ui)
                implementation(compose.components.resources)
                implementation("org.jetbrains.androidx.navigation:navigation-compose:2.8.0-alpha10")
                implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
                implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.1")
                implementation("io.ktor:ktor-client-core:3.0.3")
                implementation("androidx.annotation:annotation:1.9.1")
            }
        }
        iosMain {
            if (mesure) kotlin.setSrcDirs(emptyList<String>())
            dependencies {
                implementation("io.ktor:ktor-client-darwin:3.0.3")
                implementation("com.liftric:kvault:1.12.0")
            }
        }
    }
}
