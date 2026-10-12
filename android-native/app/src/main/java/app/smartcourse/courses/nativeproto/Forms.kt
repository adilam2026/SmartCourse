@file:OptIn(ExperimentalMaterial3Api::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.material3.Icon
import androidx.compose.foundation.layout.size

@Composable
fun FormField(
    value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier,
    leading: ImageVector? = null, trailing: @Composable (() -> Unit)? = null,
    visual: VisualTransformation = VisualTransformation.None, keyboard: KeyboardOptions = KeyboardOptions.Default,
    focus: Boolean = false, label: String? = null,
) {
    val cmp = LocalCompact.current
    val fr = remember { FocusRequester() }
    if (focus) LaunchedEffect(Unit) { runCatching { fr.requestFocus() } }
    OutlinedTextField(
        value = value, onValueChange = onChange, singleLine = true,
        placeholder = { Text(placeholder, color = C.Muted, style = MaterialTheme.typography.bodyMedium) },
        label = label?.let { { Text(it) } },
        leadingIcon = leading?.let { { Icon(it, null, tint = C.Muted, modifier = Modifier.size(22.dp)) } },
        trailingIcon = trailing,
        visualTransformation = visual, keyboardOptions = keyboard,
        textStyle = MaterialTheme.typography.bodyLarge,
        shape = RoundedCornerShape(14.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = C.Teal, unfocusedBorderColor = C.Line,
            focusedContainerColor = Color.White, unfocusedContainerColor = Color.White,
            cursorColor = C.Teal, focusedLabelColor = C.TealDark,
        ),
        modifier = modifier.fillMaxWidth().then(if (cmp) Modifier else Modifier).focusRequester(fr),
    )
}

/** Panneau inférieur Android natif (Material 3 ModalBottomSheet), aux couleurs de la charte. */
@Composable
fun AppSheet(onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Color.White,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        // Poignée : même aspect que celle de Material (32 × 4 dp) dans une zone de 48 × 48 dp.
        dragHandle = {
            Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.size(width = 32.dp, height = 4.dp).clip(RoundedCornerShape(2.dp)).background(C.Line))
            }
        },
    ) {
        Column(Modifier.fillMaxWidth().imePadding().navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 16.dp), content = content)
    }
}
