package app.smartcourse.courses.nativeproto

import androidx.annotation.DrawableRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Remove
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Relief discret commun aux cartes et boutons. */
fun Modifier.soft(shape: Shape, elevation: Dp = 3.dp): Modifier = this.shadow(
    elevation, shape, clip = false,
    ambientColor = C.Navy.copy(alpha = 0.10f), spotColor = C.Navy.copy(alpha = 0.20f),
)

private val TealBrush = Brush.verticalGradient(listOf(Color(0xFF2CCBC4), Color(0xFF0FA8A2)))

@Composable
fun SCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    padding: PaddingValues = PaddingValues(0.dp),
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(18.dp)
    Column(
        modifier.soft(shape, 3.dp).clip(shape).background(C.Card)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(padding),
        content = content,
    )
}

@Composable
fun PrimaryButton(
    text: String, onClick: () -> Unit, modifier: Modifier = Modifier,
    trailing: ImageVector? = null, leading: ImageVector? = null, enabled: Boolean = true,
) {
    val cmp = LocalCompact.current
    val shape = RoundedCornerShape(16.dp)
    Row(
        modifier.height(if (cmp) 48.dp else 56.dp)
            .then(if (enabled) Modifier.shadow(7.dp, shape, ambientColor = C.Teal, spotColor = C.TealDark) else Modifier)
            .clip(shape)
            .background(if (enabled) TealBrush else SolidColor(Color(0xFFC9D6E1)))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) { Icon(leading, null, tint = Color.White, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(8.dp)) }
        Text(text, color = Color.White, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (trailing != null) { Spacer(Modifier.width(8.dp)); Icon(trailing, null, tint = Color.White, modifier = Modifier.size(20.dp)) }
    }
}

@Composable
fun SecondaryButton(
    text: String, onClick: () -> Unit, modifier: Modifier = Modifier,
    leading: ImageVector? = null, danger: Boolean = false, height: Dp? = null,
) {
    val cmp = LocalCompact.current
    val shape = RoundedCornerShape(16.dp)
    val fg = if (danger) C.Danger else C.TealDark
    Row(
        modifier.height(height ?: if (cmp) 48.dp else 56.dp).soft(shape, 2.dp).clip(shape).background(Color.White)
            .border(BorderStroke(1.dp, if (danger) C.Danger.copy(alpha = 0.35f) else C.Line), shape)
            .clickable(onClick = onClick).padding(horizontal = 14.dp),
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) { Icon(leading, null, tint = fg, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(8.dp)) }
        Text(text, color = fg, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Petit bouton d'action de ligne : Ajouter (plein) / Retirer (contour). */
@Composable
fun RowAction(text: String, onClick: () -> Unit, filled: Boolean, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(14.dp)
    Box(
        modifier.heightIn(min = 40.dp).widthIn(min = 84.dp)
            .then(if (filled) Modifier.shadow(5.dp, shape, ambientColor = C.Teal, spotColor = C.TealDark) else Modifier.soft(shape, 1.dp))
            .clip(shape)
            .then(if (filled) Modifier.background(TealBrush) else Modifier.background(Color.White).border(BorderStroke(1.dp, C.Line), shape))
            .clickable(onClick = onClick).padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = if (filled) Color.White else C.Ink, style = MaterialTheme.typography.labelLarge, maxLines = 1)
    }
}

@Composable
fun SegTabs(options: List<String>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    val cmp = LocalCompact.current
    val h = if (cmp) 40.dp else 48.dp
    Row(
        modifier.fillMaxWidth().height(h + 8.dp).clip(RoundedCornerShape(16.dp)).background(Color(0xFFE4EDF5)).padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        options.forEachIndexed { i, label ->
            val sel = i == selected
            val shape = RoundedCornerShape(12.dp)
            Box(
                Modifier.weight(1f).fillMaxHeight()
                    .then(if (sel) Modifier.shadow(4.dp, shape, ambientColor = C.Teal, spotColor = C.TealDark) else Modifier)
                    .clip(shape)
                    .background(if (sel) TealBrush else SolidColor(Color.Transparent))
                    .clickable { onSelect(i) }.padding(horizontal = 4.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label, color = if (sel) Color.White else C.Muted, textAlign = TextAlign.Center,
                    fontSize = 13.sp, lineHeight = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
fun ToggleChip(text: String, selected: Boolean, onClick: () -> Unit) {
    val cmp = LocalCompact.current
    val shape = RoundedCornerShape(50)
    // Zone tactile : 48 dp au moins pour le personnel ; la pastille garde son aspect (36 dp).
    Box(Modifier.heightIn(min = if (cmp) 36.dp else 48.dp).widthIn(min = if (cmp) 0.dp else 48.dp).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Box(
            Modifier.heightIn(min = 36.dp).clip(shape)
                .background(if (selected) C.Navy else Color.White)
                .border(BorderStroke(1.dp, if (selected) C.Navy else C.Line), shape)
                .padding(horizontal = 14.dp),
            contentAlignment = Alignment.Center,
        ) { Text(text, color = if (selected) Color.White else C.Ink, style = MaterialTheme.typography.labelMedium, maxLines = 1) }
    }
}

@Composable
fun SearchBox(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier) {
    val cmp = LocalCompact.current
    val shape = RoundedCornerShape(14.dp)
    Row(
        modifier.fillMaxWidth().height(if (cmp) 46.dp else 52.dp).soft(shape, 2.dp).clip(shape).background(Color.White).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.Search, null, tint = C.Muted, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            if (value.isEmpty()) Text(placeholder, color = C.Muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
            BasicTextField(
                value = value, onValueChange = onChange, singleLine = true,
                textStyle = MaterialTheme.typography.bodyLarge, cursorBrush = SolidColor(C.Teal),
                // Le texte indicatif est annoncé par les lecteurs d'écran (TalkBack) même quand le champ est rempli.
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = placeholder },
            )
        }
        if (value.isNotEmpty()) {
            Icon(Icons.Rounded.Close, "Effacer la recherche", tint = C.Muted, modifier = Modifier.size(22.dp).clickable { onChange("") })
        }
    }
}

@Composable
fun Photo(@DrawableRes res: Int, size: Dp, modifier: Modifier = Modifier, radius: Dp = 12.dp) {
    Image(
        painterResource(res), contentDescription = null,
        modifier = modifier.size(size).clip(RoundedCornerShape(radius)).background(Color(0xFFEFF4F8)),
        contentScale = ContentScale.Crop,
    )
}

@Composable
fun TopBar(title: String, subtitle: String? = null, onBack: (() -> Unit)? = null, actions: @Composable RowScope.() -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().padding(start = if (onBack != null) 4.dp else 20.dp, end = 8.dp, top = 6.dp, bottom = 4.dp).heightIn(min = 52.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) IconButton(onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Retour", tint = C.Ink) }
        Column(Modifier.weight(1f).padding(end = 4.dp)) {
            Text(title, style = MaterialTheme.typography.headlineMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        actions()
    }
}

data class NavItem(val route: String, val label: String, val icon: ImageVector)

@Composable
fun BottomNav(items: List<NavItem>, selectedRoute: String, onSelect: (String) -> Unit) {
    Column(
        Modifier.fillMaxWidth()
            .shadow(10.dp, RectangleShape, ambientColor = C.Navy.copy(alpha = 0.12f), spotColor = C.Navy.copy(alpha = 0.25f))
            .background(Color.White).navigationBarsPadding(),
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp)) {
            items.forEach { it ->
                val sel = it.route == selectedRoute
                Column(
                    Modifier.weight(1f).clip(RoundedCornerShape(14.dp)).clickable { onSelect(it.route) }
                        .semantics { contentDescription = it.label }.padding(vertical = 4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(
                        Modifier.height(30.dp).width(58.dp).clip(RoundedCornerShape(15.dp)).background(if (sel) C.TealSoft else Color.Transparent),
                        contentAlignment = Alignment.Center,
                    ) { Icon(it.icon, null, tint = if (sel) C.TealDark else C.Muted, modifier = Modifier.size(24.dp)) }
                    Text(it.label, style = MaterialTheme.typography.labelSmall, color = if (sel) C.TealDark else C.Muted, maxLines = 1)
                }
            }
        }
    }
}

@Composable
fun Pill(text: String, fg: Color, bg: Color, modifier: Modifier = Modifier) {
    Box(modifier.clip(RoundedCornerShape(50)).background(bg).padding(horizontal = 9.dp, vertical = 3.dp)) {
        Text(text, color = fg, style = MaterialTheme.typography.labelSmall, maxLines = 1)
    }
}

@Composable
fun ProgressBar(fraction: Float, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)).background(C.Track)) {
        Box(
            Modifier.fillMaxHeight().fillMaxWidth(fraction.coerceIn(0f, 1f)).clip(RoundedCornerShape(4.dp))
                .background(Brush.horizontalGradient(listOf(C.Teal, Color(0xFF45D6CF)))),
        )
    }
}

@Composable
fun Avatar(initials: String, color: Color, size: Dp = 40.dp, dim: Boolean = false) {
    Box(Modifier.size(size).clip(CircleShape).background(if (dim) Color(0xFFB9C7D4) else color), contentAlignment = Alignment.Center) {
        Text(initials, color = Color.White, fontWeight = FontWeight.Bold, fontSize = (size.value * 0.4f).sp)
    }
}

@Composable
fun TealSwitch(checked: Boolean, onChange: (Boolean) -> Unit, enabled: Boolean = true) {
    Switch(
        checked = checked, onCheckedChange = onChange, enabled = enabled,
        colors = SwitchDefaults.colors(
            checkedTrackColor = C.Teal, checkedThumbColor = Color.White, checkedBorderColor = Color.Transparent,
            uncheckedTrackColor = Color(0xFFD3DFEA), uncheckedThumbColor = Color.White, uncheckedBorderColor = Color.Transparent,
        ),
    )
}

@Composable
fun CheckBox(checked: Boolean, onChange: (Boolean) -> Unit, size: Dp = 28.dp, enabled: Boolean = true) {
    val shape = RoundedCornerShape(9.dp)
    Box(
        Modifier.size(size).clip(shape)
            .then(if (checked) Modifier.background(TealBrush) else Modifier.background(Color.White).border(BorderStroke(2.dp, Color(0xFFC3D2DF)), shape))
            .clickable(enabled = enabled) { onChange(!checked) },
        contentAlignment = Alignment.Center,
    ) { if (checked) Icon(Icons.Rounded.Check, null, tint = Color.White, modifier = Modifier.size(size * 0.7f)) }
}

@Composable
fun RoundBtn(icon: ImageVector, desc: String, onClick: () -> Unit, filled: Boolean = false, size: Dp = 44.dp, enabled: Boolean = true) {
    Box(
        Modifier.size(size).then(if (filled && enabled) Modifier.shadow(5.dp, CircleShape, ambientColor = C.Teal, spotColor = C.TealDark) else Modifier.soft(CircleShape, 1.dp))
            .clip(CircleShape)
            .then(if (filled && enabled) Modifier.background(TealBrush) else Modifier.background(Color.White).border(BorderStroke(1.dp, C.Line), CircleShape))
            .clickable(enabled = enabled, onClick = onClick).semantics { contentDescription = desc },
        contentAlignment = Alignment.Center,
    ) { Icon(icon, null, tint = if (filled && enabled) Color.White else if (enabled) C.Ink else C.Line, modifier = Modifier.size(size * 0.5f)) }
}

@Composable
fun Stepper(text: String, onMinus: () -> Unit, onPlus: () -> Unit, size: Dp = 40.dp, canMinus: Boolean = true) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        RoundBtn(Icons.Rounded.Remove, "Diminuer", onMinus, size = size, enabled = canMinus)
        Text(text, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center, modifier = Modifier.widthIn(min = 56.dp), maxLines = 1)
        RoundBtn(Icons.Rounded.Add, "Augmenter", onPlus, filled = true, size = size)
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier, trailing: (@Composable () -> Unit)? = null) {
    Row(modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        trailing?.invoke()
    }
}

@Composable
fun ConfirmDialog(
    title: String, text: String, confirm: String, onConfirm: () -> Unit, onDismiss: () -> Unit, danger: Boolean = false,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color.White,
        shape = RoundedCornerShape(24.dp),
        title = { Text(title, style = MaterialTheme.typography.titleLarge) },
        text = { Text(text, style = MaterialTheme.typography.bodyMedium) },
        confirmButton = { TextButton(onConfirm) { Text(confirm, color = if (danger) C.Danger else C.TealDark, fontWeight = FontWeight.Bold) } },
        dismissButton = { TextButton(onDismiss) { Text("Annuler", color = C.Muted, fontWeight = FontWeight.SemiBold) } },
    )
}
