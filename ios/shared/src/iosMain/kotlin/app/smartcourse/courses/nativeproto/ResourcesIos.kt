package app.smartcourse.courses.nativeproto

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.painter.Painter
import app.smartcourse.courses.nativeproto.res.Res
import app.smartcourse.courses.nativeproto.res.ic_splash
import app.smartcourse.courses.nativeproto.res.p_baguette
import app.smartcourse.courses.nativeproto.res.p_bananes
import app.smartcourse.courses.nativeproto.res.p_cafe
import app.smartcourse.courses.nativeproto.res.p_carottes
import app.smartcourse.courses.nativeproto.res.p_citrons
import app.smartcourse.courses.nativeproto.res.p_concombres
import app.smartcourse.courses.nativeproto.res.p_courgettes
import app.smartcourse.courses.nativeproto.res.p_eau_minerale
import app.smartcourse.courses.nativeproto.res.p_fromage_blanc
import app.smartcourse.courses.nativeproto.res.p_huile_d_olive
import app.smartcourse.courses.nativeproto.res.p_lait
import app.smartcourse.courses.nativeproto.res.p_lentilles
import app.smartcourse.courses.nativeproto.res.p_menthe
import app.smartcourse.courses.nativeproto.res.p_oeufs
import app.smartcourse.courses.nativeproto.res.p_oignons
import app.smartcourse.courses.nativeproto.res.p_oranges
import app.smartcourse.courses.nativeproto.res.p_pain
import app.smartcourse.courses.nativeproto.res.p_pates
import app.smartcourse.courses.nativeproto.res.p_persil
import app.smartcourse.courses.nativeproto.res.p_poivrons_rouges
import app.smartcourse.courses.nativeproto.res.p_poivrons_verts
import app.smartcourse.courses.nativeproto.res.p_pommes
import app.smartcourse.courses.nativeproto.res.p_pommes_de_terre
import app.smartcourse.courses.nativeproto.res.p_poulet
import app.smartcourse.courses.nativeproto.res.p_riz
import app.smartcourse.courses.nativeproto.res.p_sucre
import app.smartcourse.courses.nativeproto.res.p_the
import app.smartcourse.courses.nativeproto.res.p_tomates
import org.jetbrains.compose.resources.painterResource

/*
 * Images fournies avec l'application : les MÊMES fichiers que l'application Android (android-native/app/src/main/res/drawable-nodpi,
 * copiés à la compilation). [R] reprend les noms Android pour que les écrans communs restent identiques.
 * Fichier généré par scripts/ios-gen-resources.py : à régénérer si une image est ajoutée côté Android (contrôlé en CI).
 */

object R {
    object drawable {
        const val ic_splash = 1
        const val p_baguette = 2
        const val p_bananes = 3
        const val p_cafe = 4
        const val p_carottes = 5
        const val p_citrons = 6
        const val p_concombres = 7
        const val p_courgettes = 8
        const val p_eau_minerale = 9
        const val p_fromage_blanc = 10
        const val p_huile_d_olive = 11
        const val p_lait = 12
        const val p_lentilles = 13
        const val p_menthe = 14
        const val p_oeufs = 15
        const val p_oignons = 16
        const val p_oranges = 17
        const val p_pain = 18
        const val p_pates = 19
        const val p_persil = 20
        const val p_poivrons_rouges = 21
        const val p_poivrons_verts = 22
        const val p_pommes = 23
        const val p_pommes_de_terre = 24
        const val p_poulet = 25
        const val p_riz = 26
        const val p_sucre = 27
        const val p_the = 28
        const val p_tomates = 29
    }
}

private val DRAWABLES = mapOf(
    R.drawable.ic_splash to Res.drawable.ic_splash,
    R.drawable.p_baguette to Res.drawable.p_baguette,
    R.drawable.p_bananes to Res.drawable.p_bananes,
    R.drawable.p_cafe to Res.drawable.p_cafe,
    R.drawable.p_carottes to Res.drawable.p_carottes,
    R.drawable.p_citrons to Res.drawable.p_citrons,
    R.drawable.p_concombres to Res.drawable.p_concombres,
    R.drawable.p_courgettes to Res.drawable.p_courgettes,
    R.drawable.p_eau_minerale to Res.drawable.p_eau_minerale,
    R.drawable.p_fromage_blanc to Res.drawable.p_fromage_blanc,
    R.drawable.p_huile_d_olive to Res.drawable.p_huile_d_olive,
    R.drawable.p_lait to Res.drawable.p_lait,
    R.drawable.p_lentilles to Res.drawable.p_lentilles,
    R.drawable.p_menthe to Res.drawable.p_menthe,
    R.drawable.p_oeufs to Res.drawable.p_oeufs,
    R.drawable.p_oignons to Res.drawable.p_oignons,
    R.drawable.p_oranges to Res.drawable.p_oranges,
    R.drawable.p_pain to Res.drawable.p_pain,
    R.drawable.p_pates to Res.drawable.p_pates,
    R.drawable.p_persil to Res.drawable.p_persil,
    R.drawable.p_poivrons_rouges to Res.drawable.p_poivrons_rouges,
    R.drawable.p_poivrons_verts to Res.drawable.p_poivrons_verts,
    R.drawable.p_pommes to Res.drawable.p_pommes,
    R.drawable.p_pommes_de_terre to Res.drawable.p_pommes_de_terre,
    R.drawable.p_poulet to Res.drawable.p_poulet,
    R.drawable.p_riz to Res.drawable.p_riz,
    R.drawable.p_sucre to Res.drawable.p_sucre,
    R.drawable.p_the to Res.drawable.p_the,
    R.drawable.p_tomates to Res.drawable.p_tomates,
)

/** Image fournie avec l'application (écrans de démonstration et de connexion). */
@Composable
fun localPainter(res: Int): Painter = painterResource(DRAWABLES.getValue(res))
