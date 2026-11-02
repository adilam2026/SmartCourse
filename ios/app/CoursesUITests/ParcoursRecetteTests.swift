import XCTest

/// Parcours de l'étape 1 sur simulateur iPhone, contre le serveur de recette jetable (jamais la production) :
/// connexion du personnel (marie), catalogue « Choisir mes articles » avec ses photos, ajout d'un produit à la liste.
/// Le serveur, le code famille et le produit sont fournis par le workflow (variables d'environnement du test).
final class ParcoursRecetteTests: XCTestCase {
    private var app: XCUIApplication!
    private let env = ProcessInfo.processInfo.environment

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchEnvironment["COURSES_SERVER"] = env["COURSES_SERVER"] ?? ""
        app.launch()
    }

    // ───── Aides ─────

    private func any(_ label: String) -> XCUIElementQuery {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@ OR value == %@ OR identifier == %@", label, label, label))
    }

    private func anyContaining(_ text: String) -> XCUIElementQuery {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text))
    }

    @discardableResult
    private func waitFor(_ label: String, _ timeout: TimeInterval = 20) -> XCUIElement {
        let e = any(label).firstMatch
        if !e.waitForExistence(timeout: timeout) {
            attach("absent-\(label)")
            print("Arborescence d'accessibilité :\n\(app.debugDescription)")
            XCTFail("« \(label) » introuvable après \(Int(timeout)) s")
        }
        return e
    }

    private func attach(_ name: String) {
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    /// Champs de saisie, dans l'ordre de l'écran (texte ou code masqué).
    private func fields() -> [XCUIElement] {
        let all = app.textFields.allElementsBoundByIndex + app.secureTextFields.allElementsBoundByIndex
        return all.sorted { $0.frame.minY < $1.frame.minY }
    }

    private func type(_ field: XCUIElement, _ text: String) {
        field.tap()
        if let v = field.value as? String, !v.isEmpty, v != field.placeholderValue {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: v.count))
        }
        field.typeText(text)
    }

    /// Saisie touche par touche sur le clavier iOS (Compose ne déclare pas le focus clavier au test : typeText est refusé).
    /// Minuscules et chiffres : le serveur compare le code famille sans tenir compte des majuscules.
    private func typeKeys(_ text: String) {
        let kb = app.keyboards.firstMatch
        if !kb.waitForExistence(timeout: 8) { attach("clavier-absent"); XCTFail("clavier absent après avoir touché le champ"); return }
        // Introduction du clavier iOS (première utilisation) : la fermer
        let intro = app.buttons["Continue"]
        if intro.waitForExistence(timeout: 1) { press(intro); sleep(1) }
        for ch in text.lowercased() {
            let s = String(ch)
            var tries = 0
            while !kb.keys[s].exists && tries < 4 {
                tries += 1
                if kb.keys[s.uppercased()].exists, let shift = [kb.buttons["shift"], kb.keys["shift"]].first(where: { $0.exists }) { press(shift); continue }
                if let more = [kb.keys["more"], kb.buttons["more"], kb.keys["numbers"], kb.keys["letters"]].first(where: { $0.exists }) { press(more) }
            }
            if !kb.keys[s].exists { attach("touche-absente-\(s)"); XCTFail("touche « \(s) » introuvable sur le clavier"); return }
            press(kb.keys[s])
        }
    }

    /// Toucher à l'emplacement de l'élément (comme un doigt), sans action d'accessibilité préalable.
    private func press(_ e: XCUIElement) {
        e.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        usleep(250_000)
    }

    private func fill(_ hint: String, _ text: String) {
        let e = waitFor(hint, 15)
        e.tap()
        sleep(1)
        app.typeText(text)
        sleep(1)
    }

    /// Une photo est affichée dans [frame] : l'image n'est pas une surface unie (le fond « photo à venir » est uni).
    private func hasPhoto(in frame: CGRect) -> Bool {
        let shot = XCUIScreen.main.screenshot().image
        guard let cg = shot.cgImage else { return false }
        let scale = CGFloat(cg.width) / shot.size.width
        let r = CGRect(x: frame.minX * scale, y: frame.minY * scale, width: frame.width * scale, height: frame.height * scale).integral
        guard let crop = cg.cropping(to: r), let data = crop.dataProvider?.data, let p = CFDataGetBytePtr(data) else { return false }
        let bpr = crop.bytesPerRow, bpp = crop.bitsPerPixel / 8
        var colors = Set<UInt32>()
        var y = 0
        while y < crop.height {
            var x = 0
            while x < crop.width {
                let o = y * bpr + x * bpp
                colors.insert(UInt32(p[o] >> 4) << 8 | UInt32(p[o + 1] >> 4) << 4 | UInt32(p[o + 2] >> 4))
                x += 4
            }
            y += 4
        }
        return colors.count > 40
    }

    // ───── Parcours ─────

    func testConnexionCatalogueAjout() throws {
        let family = try XCTUnwrap(env["COURSES_FAMILY"], "code famille de recette absent")
        let product = env["COURSES_PRODUCT"] ?? "Oignons"

        // 1. Écran de connexion (le même que sur Android)
        waitFor("Bienvenue", 40)
        attach("1-connexion")
        // Comme un utilisateur : toucher le champ (son indication), puis taper au clavier.
        // Compose Multiplatform expose chaque champ de saisie comme un élément touchable sans libellé, de la largeur de l'écran :
        // on les prend dans l'ordre de l'écran (identifiant famille, identifiant personnel, code), comme un utilisateur.
        let champs = app.buttons.allElementsBoundByIndex
            .filter { $0.label.isEmpty && $0.frame.height >= 48 && $0.frame.height <= 64 && $0.frame.width > 250 }
            .sorted { $0.frame.minY < $1.frame.minY }
        XCTAssertGreaterThanOrEqual(champs.count, 3, "champs de connexion : \(champs.count) trouvés")
        for (champ, texte) in zip(champs.prefix(3), [family, "marie", "573918"]) {
            champ.tap(); sleep(1); typeKeys(texte); sleep(1)
        }
        attach("2-connexion-remplie")
        let buttons = any("Se connecter").allElementsBoundByIndex.filter { $0.isHittable }
        try XCTUnwrap(buttons.last, "bouton « Se connecter » introuvable").tap()

        // 2. Personnel : accueil direct sur « Choisir mes articles », avec le catalogue de la famille
        waitFor("Choisir mes articles", 40)
        let card = waitFor(product, 30)
        sleep(4) // chargement des photos depuis le serveur (cookie de session)
        attach("3-catalogue")
        XCTAssertTrue(hasPhoto(in: card.frame.insetBy(dx: 0, dy: 0)) || hasPhoto(in: CGRect(x: card.frame.minX, y: card.frame.minY - card.frame.height, width: card.frame.width, height: card.frame.height * 2)),
                      "photo du produit « \(product) » non affichée")

        // 3. Ajout du produit à la liste : touché, puis « Terminer ma sélection » (envoi au serveur)
        card.tap()
        sleep(2)
        attach("4-produit-choisi")
        let done = anyContaining("Terminer ma sélection").allElementsBoundByIndex.filter { $0.isHittable }
        try XCTUnwrap(done.last, "« Terminer ma sélection » introuvable").tap()
        sleep(6)
        attach("5-selection-envoyee")
        XCTAssertFalse(anyContaining("Envoi en attente").firstMatch.exists, "la demande est restée en attente d'envoi")
    }
}
