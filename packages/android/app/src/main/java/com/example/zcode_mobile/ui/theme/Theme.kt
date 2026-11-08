package com.example.zcode_mobile.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val DarkColorScheme = darkColorScheme(
    primary = BrandBlueDark,
    secondary = NeutralDarkSubtle,
    background = NeutralDarkBackground,
    surface = NeutralDarkSurface,
    onPrimary = NeutralDarkBackground,
    onSecondary = NeutralDarkBackground,
    onBackground = NeutralDarkText,
    onSurface = NeutralDarkText,
    onSurfaceVariant = NeutralDarkSubtle,
    outlineVariant = NeutralDarkText.copy(alpha = 0.1f),
)

private val LightColorScheme = lightColorScheme(
    primary = BrandBlue,
    secondary = NeutralLightSubtle,
    background = NeutralLightBackground,
    surface = NeutralLightSurface,
    onPrimary = NeutralLightSurface,
    onSecondary = NeutralLightSurface,
    onBackground = NeutralLightText,
    onSurface = NeutralLightText,
    onSurfaceVariant = NeutralLightSubtle,
    outlineVariant = NeutralLightText.copy(alpha = 0.1f),
)

@Composable
fun ZcodemobileTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        shapes = Shapes(small = RoundedCornerShape(6.dp), medium = RoundedCornerShape(8.dp), large = RoundedCornerShape(12.dp), extraLarge = RoundedCornerShape(16.dp)),
        content = content
    )
}
