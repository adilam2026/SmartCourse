@file:OptIn(ExperimentalMaterial3Api::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Email
import androidx.compose.material.icons.rounded.Group
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.ShoppingBasket
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp

@Composable
fun LoginScreen(onLogin: (Role) -> Unit) {
    val demo = LocalDemo.current
    var tab by remember { mutableIntStateOf(if (Launch.str("tab") == "first") 1 else 0) }
    var sub by remember { mutableIntStateOf(if (Launch.str("sub") == "create") 1 else 0) }
    var help by remember { mutableStateOf(Launch.once("help")) }
    var family by remember { mutableStateOf("") }
    var login by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var show by remember { mutableStateOf(false) }
    var famName by remember { mutableStateOf("") }
    var city by remember { mutableStateOf("Casablanca") }
    val focus = remember { Launch.once("keyboard") }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        // En-tête : logo, accroche et photos de produits
        Box(Modifier.fillMaxWidth().height(176.dp)) {
            Row(Modifier.padding(start = 20.dp, top = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(52.dp).shadow(6.dp, RoundedCornerShape(16.dp), ambientColor = C.Navy, spotColor = C.Navy)
                        .clip(RoundedCornerShape(16.dp)).background(Brush.verticalGradient(listOf(Color(0xFF123B66), C.Navy))),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Rounded.ShoppingBasket, null, tint = C.Teal, modifier = Modifier.size(30.dp)) }
                Spacer(Modifier.width(12.dp))
                Column {
                    Text("Courses", style = MaterialTheme.typography.headlineMedium)
                    Text("Les courses en famille", style = MaterialTheme.typography.bodySmall)
                }
            }
            val ring = Modifier.shadow(8.dp, CircleShape, ambientColor = C.Navy, spotColor = C.Navy).clip(CircleShape)
            Box(Modifier.align(Alignment.TopEnd).padding(end = 16.dp, top = 6.dp)) {
                Photo(R.drawable.p_tomates, 92.dp, ring.offset(x = (-34).dp, y = 4.dp), radius = 46.dp)
                Photo(R.drawable.p_carottes, 76.dp, ring.offset(x = (-96).dp, y = 78.dp), radius = 38.dp)
                Photo(R.drawable.p_pain, 70.dp, ring.offset(x = 0.dp, y = 92.dp), radius = 35.dp)
            }
        }
        Column(Modifier.padding(horizontal = 20.dp)) {
            Text("Bienvenue", style = MaterialTheme.typography.headlineLarge)
            Text("Accédez à votre liste de courses familiale", style = MaterialTheme.typography.bodyMedium, color = C.Muted)
            Spacer(Modifier.height(16.dp))
            SegTabs(listOf("Se connecter", "Première connexion"), tab, { tab = it })
            Spacer(Modifier.height(14.dp))

            if (tab == 0) {
                FormField(family, { family = it }, "Code famille", leading = Icons.Rounded.Group, focus = focus,
                    keyboard = KeyboardOptions(keyboardType = KeyboardType.Ascii))
                Spacer(Modifier.height(10.dp))
                FormField(login, { login = it }, "Identifiant", leading = Icons.Rounded.Person)
                Spacer(Modifier.height(10.dp))
                FormField(
                    code, { code = it }, "Code d'accès", leading = Icons.Rounded.Lock,
                    visual = if (show) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboard = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    trailing = { IconButton({ show = !show }) { Icon(if (show) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility, if (show) "Masquer le code" else "Afficher le code", tint = C.Ink) } },
                )
                Spacer(Modifier.height(16.dp))
                PrimaryButton("Se connecter", {
                    demo.simulated("connexion (aucun serveur contacté)")
                    onLogin(if (login.trim().lowercase() == "marie") Role.STAFF else Role.ADMIN)
                }, Modifier.fillMaxWidth(), trailing = Icons.AutoMirrored.Rounded.ArrowForward)
                Spacer(Modifier.height(12.dp))
                Text(
                    "Besoin d'aide ?", color = C.TealDark, style = MaterialTheme.typography.labelLarge, textDecoration = TextDecoration.Underline,
                    modifier = Modifier.align(Alignment.CenterHorizontally).clip(RoundedCornerShape(8.dp)).clickable { help = true }.padding(horizontal = 12.dp, vertical = 10.dp),
                )
            } else {
                SegTabs(listOf("Rejoindre une famille", "Créer ma famille"), sub, { sub = it })
                Spacer(Modifier.height(12.dp))
                if (sub == 0) {
                    FormField(family, { family = it }, "Code famille", leading = Icons.Rounded.Group)
                    Spacer(Modifier.height(10.dp))
                    FormField(login, { login = it }, "Votre prénom", leading = Icons.Rounded.Person)
                    Spacer(Modifier.height(10.dp))
                    FormField(code, { code = it }, "Code d'accès à choisir", leading = Icons.Rounded.Lock,
                        visual = PasswordVisualTransformation(), keyboard = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
                    Spacer(Modifier.height(16.dp))
                    PrimaryButton("Rejoindre la famille", { demo.simulated("demande pour rejoindre une famille") }, Modifier.fillMaxWidth())
                } else {
                    FormField(famName, { famName = it }, "Nom de la famille", leading = Icons.Rounded.Group)
                    Spacer(Modifier.height(10.dp))
                    SecondaryButton("Ville : $city", {
                        city = when (city) { "Casablanca" -> "Rabat"; "Rabat" -> "Marrakech"; else -> "Casablanca" }
                    }, Modifier.fillMaxWidth(), height = 54.dp)
                    Spacer(Modifier.height(10.dp))
                    FormField(login, { login = it }, "Votre identifiant (administrateur)", leading = Icons.Rounded.Person)
                    Spacer(Modifier.height(10.dp))
                    FormField(code, { code = it }, "Code d'accès", leading = Icons.Rounded.Lock,
                        visual = PasswordVisualTransformation(), keyboard = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
                    Spacer(Modifier.height(16.dp))
                    PrimaryButton("Créer ma famille", { demo.simulated("création d'une famille") }, Modifier.fillMaxWidth())
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    if (help) {
        AppSheet({ help = false }) {
            Text("Besoin d'aide ?", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(4.dp))
            Text("Choisissez ce qui vous correspond.", style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(10.dp))
            HelpRow(Icons.Rounded.Key, "J'ai oublié mon code d'accès", "Demander un nouveau code à l'administrateur") { help = false; demo.simulated("demande de nouveau code") }
            HelpRow(Icons.Rounded.Email, "Récupérer ma famille", "Recevoir un lien par e-mail") { help = false; demo.simulated("envoi du lien de récupération") }
            HelpRow(Icons.Rounded.Group, "Je ne connais pas le code famille", "Le demander à un administrateur de la famille") { help = false; demo.simulated("aide code famille") }
        }
    }
}

@Composable
private fun HelpRow(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, sub: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(42.dp).clip(CircleShape).background(C.TealSoft), contentAlignment = Alignment.Center) { Icon(icon, null, tint = C.TealDark) }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(sub, style = MaterialTheme.typography.bodySmall)
        }
        Icon(Icons.Rounded.ChevronRight, null, tint = C.Muted)
    }
}
