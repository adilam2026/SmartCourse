package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp

/** Un code d'accès numérique : 6 à 8 chiffres. C'est un texte, jamais un nombre : les zéros du début sont conservés. */
fun codeDigits(s: String): String = s.filter(Char::isDigit).take(8)

/** Consigne affichée partout où un NOUVEAU code est choisi (même règle que le serveur). */
const val CODE_RULE = "Entre 6 et 8 chiffres."

/** Nouveau code valable : 6 à 8 chiffres. */
fun isNewCode(s: String): Boolean = s.length in 6..8 && s.all(Char::isDigit)

/** Code saisi pour PROUVER son identité (code existant) : 6 à 8 chiffres, ou ancien code de 6 caractères avec lettres ou symboles. */
fun isEnteredCode(s: String): Boolean = isNewCode(s) || (s.length == 6 && s.none(Char::isWhitespace))

/** Message précis pour un nouveau code invalide (rien si le champ est vide ou valide). */
fun newCodeError(s: String): String? = if (s.isEmpty() || isNewCode(s)) null else "Le code doit contenir entre 6 et 8 chiffres (${s.length} saisi${if (s.length > 1) "s" else ""})."

/**
 * Champ de code d'accès : clavier numérique, y compris quand le code est affiché ; 6 à 8 chiffres ; bouton Afficher / Masquer.
 * [rule] : code CHOISI (création, changement, réinitialisation) — la consigne « Entre 6 et 8 chiffres » et l'erreur précise sont affichées.
 * [legacy] (vérification d'un code EXISTANT seulement) : un lien permet de taper un ancien code de 6 caractères avec des lettres ou des
 * symboles, que le serveur accepte encore. Un nouveau code est toujours numérique.
 */
@Composable
fun CodeField(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier, legacy: Boolean = false, focus: Boolean = false, rule: Boolean = false) {
    var show by remember { mutableStateOf(false) }
    var letters by remember { mutableStateOf(false) }
    Column(modifier) {
        FormField(
            value, { v -> onChange(if (letters) v.filter { !it.isWhitespace() }.take(6) else codeDigits(v)) }, placeholder,
            leading = Icons.Rounded.Lock,
            visual = if (show) VisualTransformation.None else PasswordVisualTransformation(),
            keyboard = KeyboardOptions(keyboardType = if (letters) KeyboardType.Password else KeyboardType.NumberPassword),
            trailing = { IconButton({ show = !show }) { Icon(if (show) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility, if (show) "Masquer le code" else "Afficher le code", tint = C.Ink) } },
            focus = focus,
        )
        if (rule) {
            val err = newCodeError(value)
            Text(err ?: CODE_RULE, style = MaterialTheme.typography.bodySmall, color = if (err != null) C.Danger else C.TealDark,
                modifier = Modifier.padding(start = 4.dp, top = 4.dp))
        }
        if (legacy) Text(
            if (letters) "Revenir au clavier numérique" else "Mon code contient des lettres ou des symboles",
            style = MaterialTheme.typography.bodySmall, color = C.TealDark,
            modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { letters = !letters; if (!letters) onChange(codeDigits(value)) }
                .heightIn(min = 40.dp).padding(horizontal = 4.dp).wrapContentHeight(Alignment.CenterVertically),
        )
    }
}
