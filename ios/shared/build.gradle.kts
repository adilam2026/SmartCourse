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
    "MainActivity.kt", "Notify.kt", "Reminders.kt", "AppUpdateAndroid.kt", "PlatformAndroid.kt", "NotificationsAndroid.kt",
    "net/HttpAndroid.kt", "net/StorageAndroid.kt", "BillingAndroid.kt",
)

// Variante : recette (par défaut) ou FINALE (-Pfinal=1, TestFlight / App Store) : serveur fixé à la compilation (HTTPS obligatoire),
// aucun accès de recette. Mêmes règles que la version finale Android. Fichier BuildConfig.kt généré (mêmes champs qu'Android).
val final = project.findProperty("final") == "1"
val serverUrl = (project.findProperty("serverUrl") as String?)?.trim().orEmpty()
if (final && !serverUrl.startsWith("https://")) throw GradleException("Version finale iPhone : -PserverUrl=https://… obligatoire")
val versionName = (project.findProperty("versionName") as String?)?.ifBlank { null } ?: "0.1-ios-recette"
val versionCode = (project.findProperty("versionCode") as String?)?.toIntOrNull() ?: 1
val buildConfigDir = layout.buildDirectory.dir("generated/buildconfig/iosMain")
val generateBuildConfig = tasks.register("generateBuildConfig") {
    inputs.property("final", final); inputs.property("serverUrl", serverUrl)
    inputs.property("versionName", versionName); inputs.property("versionCode", versionCode)
    outputs.dir(buildConfigDir)
    doLast {
        val f = buildConfigDir.get().file("app/smartcourse/courses/nativeproto/BuildConfig.kt").asFile
        f.parentFile.mkdirs()
        f.writeText(
            """
            |package app.smartcourse.courses.nativeproto
            |
            |/** Généré par ios/shared/build.gradle.kts (équivalent du BuildConfig Android, mêmes champs). Ne pas modifier. */
            |object BuildConfig {
            |    const val FINAL = $final
            |    const val RECETTE_HOOKS = false
            |    const val SERVER_URL = "${serverUrl.replace("\"", "")}"
            |    const val VERSION_NAME = "${versionName.replace("\"", "")}"
            |    const val VERSION_CODE = $versionCode
            |}
            |""".trimMargin()
        )
    }
}
tasks.matching { it.name.startsWith("compileKotlinIos") }.configureEach { dependsOn(generateBuildConfig) }

// Images fournies avec l'application : les fichiers Android (drawable-nodpi), copiés tels quels en ressources Compose.
val androidImages = tasks.register<Sync>("androidImages") {
    from(rootDir.resolve("../android-native/app/src/main/res/drawable-nodpi"))
    into(layout.buildDirectory.dir("androidRes/drawable"))
}

compose.resources {
    packageOfResClass = "app.smartcourse.courses.nativeproto.res"
    publicResClass = false
    generateResClass = always
    customDirectory("commonMain", androidImages.map { layout.buildDirectory.dir("androidRes").get() })
}
tasks.matching { it.name != "androidImages" && it.name.contains("Resource", ignoreCase = true) }
    .configureEach { dependsOn(androidImages) }

kotlin {
    val xcf = XCFramework("CoursesShared")
    listOf(iosArm64(), iosSimulatorArm64()).forEach {
        it.binaries.framework {
            baseName = "CoursesShared"
            isStatic = true
            xcf.add(this)
        }
    }

    sourceSets {
        commonMain {
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
            }
        }
        // Sources Android dans la partie iPhone (pas dans « commonMain ») : en Kotlin 2, le code commun ne voit pas les déclarations
        // propres à une plateforme ; ici une seule plateforme est compilée, ce qui évite d'imposer expect/actual à Android.
        iosMain {
            if (mesure) kotlin.setSrcDirs(listOf(androidSources)) else {
                kotlin.srcDir(androidSources)
                kotlin.srcDir(generateBuildConfig.map { buildConfigDir.get() })
                kotlin.exclude(androidOnly.map { "app/smartcourse/courses/nativeproto/$it" })
            }
            dependencies {
                implementation("io.ktor:ktor-client-darwin:3.0.3")
                implementation("com.liftric:kvault:1.12.0")
            }
        }
    }
}
