package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object C {
    val Navy = Color(0xFF0B2A4A)
    val Ink = Color(0xFF12304F)
    val Teal = Color(0xFF14B5AE)
    val TealDark = Color(0xFF0C8F8A)
    val TealSoft = Color(0xFFDFF6F4)
    val Bg = Color(0xFFF2F7FB)
    val Card = Color.White
    val Line = Color(0xFFDDE7F0)
    val Muted = Color(0xFF64798D)
    val Danger = Color(0xFFD64545)
    val DangerSoft = Color(0xFFFCEBEB)
    val Amber = Color(0xFFB7791F)
    val AmberSoft = Color(0xFFFFF4DD)
    val Track = Color(0xFFDCE8F2)
}

/** Présentation : compacte pour l'administrateur, confortable pour le personnel. */
val LocalCompact = compositionLocalOf { true }

private val Sans = FontFamily.SansSerif

private val Type = Typography(
    headlineLarge = TextStyle(fontFamily = Sans, fontWeight = FontWeight.ExtraBold, fontSize = 30.sp, lineHeight = 34.sp, color = C.Ink),
    headlineMedium = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Bold, fontSize = 24.sp, lineHeight = 28.sp, color = C.Ink),
    titleLarge = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Bold, fontSize = 20.sp, lineHeight = 24.sp, color = C.Ink),
    titleMedium = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Bold, fontSize = 16.sp, lineHeight = 20.sp, color = C.Ink),
    titleSmall = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 18.sp, color = C.Ink),
    bodyLarge = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Normal, fontSize = 16.sp, lineHeight = 22.sp, color = C.Ink),
    bodyMedium = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 19.sp, color = C.Ink),
    bodySmall = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Normal, fontSize = 12.sp, lineHeight = 16.sp, color = C.Muted),
    labelLarge = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, lineHeight = 20.sp),
    labelMedium = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, lineHeight = 16.sp),
    labelSmall = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Medium, fontSize = 11.sp, lineHeight = 14.sp),
)

@Composable
fun CoursesTheme(content: @Composable () -> Unit) {
    @Suppress("UNUSED_VARIABLE") val dark = isSystemInDarkTheme() // thème clair unique pour ce prototype
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = C.Teal, onPrimary = Color.White,
            primaryContainer = C.TealSoft, onPrimaryContainer = C.TealDark,
            secondary = C.Navy, onSecondary = Color.White,
            background = C.Bg, onBackground = C.Ink,
            surface = C.Card, onSurface = C.Ink,
            surfaceVariant = Color(0xFFE8F0F7), onSurfaceVariant = C.Muted,
            outline = C.Line, error = C.Danger,
            surfaceContainerLow = Color.White, surfaceContainer = Color.White,
            surfaceContainerHigh = Color.White, surfaceContainerHighest = Color.White,
        ),
        typography = Type,
        shapes = Shapes(
            small = androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
            medium = androidx.compose.foundation.shape.RoundedCornerShape(14.dp),
            large = androidx.compose.foundation.shape.RoundedCornerShape(20.dp),
            extraLarge = androidx.compose.foundation.shape.RoundedCornerShape(28.dp),
        ),
        content = content,
    )
}
