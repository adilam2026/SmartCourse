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

    private func onScreen(_ e: XCUIElement) -> Bool {
        let f = e.frame, w = app.windows.firstMatch.frame
        return e.exists && f.height > 0 && f.minY >= w.minY + 60 && f.maxY <= w.maxY - 90
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

    /// Capture d'écran redessinée en RGBA 8 bits sRGB (le format natif des captures varie : 16 bits, Display P3…).
    private func screenPixels() -> (px: [UInt8], w: Int, h: Int, scale: CGFloat)? {
        let shot = XCUIScreen.main.screenshot().image
        guard let cg = shot.cgImage else { return nil }
        let w = cg.width, h = cg.height
        var px = [UInt8](repeating: 0, count: w * h * 4)
        let ok: Bool = px.withUnsafeMutableBytes { buf in
            guard let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        return ok ? (px, w, h, CGFloat(w) / shot.size.width) : nil
    }

    /// Centre (en points) du bandeau turquoise le plus bas au milieu de l'écran : le bouton principal « Se connecter ».
    private func lowestTealBand() -> CGFloat? {
        guard let s = screenPixels() else { return nil }
        let x = s.w / 4   // à gauche du texte blanc du bouton (au centre, le texte coupe le bandeau)
        func teal(_ y: Int) -> Bool {
            let o = (y * s.w + x) * 4
            let r = Int(s.px[o]), g = Int(s.px[o + 1]), b = Int(s.px[o + 2])
            return g > 110 && b > 100 && r < 100 && g - r > 50
        }
        var bands: [(Int, Int)] = [], start: Int? = nil
        for y in 0..<s.h {
            if teal(y) { if start == nil { start = y } } else if let s0 = start { bands.append((s0, y)); start = nil }
        }
        let ok = bands.filter { CGFloat($0.1 - $0.0) / s.scale >= 36 }
        print("Bandeaux turquoise (points) : " + ok.map { "\(CGFloat($0.0) / s.scale)–\(CGFloat($0.1) / s.scale)" }.joined(separator: ", "))
        guard let last = ok.last else { return nil }
        return CGFloat(last.0 + last.1) / 2 / s.scale
    }

    /// Une photo est affichée dans [frame] : l'image n'est pas une surface unie (le fond « photo à venir » est uni).
    private func hasPhoto(in frame: CGRect) -> Bool {
        guard let s = screenPixels() else { return false }
        var colors = Set<UInt32>()
        let x0 = max(0, Int(frame.minX * s.scale)), x1 = min(s.w, Int(frame.maxX * s.scale))
        let y0 = max(0, Int(frame.minY * s.scale)), y1 = min(s.h, Int(frame.maxY * s.scale))
        guard x1 > x0, y1 > y0 else { return false }
        for y in stride(from: y0, to: y1, by: 4) {
            for x in stride(from: x0, to: x1, by: 4) {
                let o = (y * s.w + x) * 4
                colors.insert(UInt32(s.px[o] >> 4) << 8 | UInt32(s.px[o + 1] >> 4) << 4 | UInt32(s.px[o + 2] >> 4))
            }
        }
        return colors.count > 40
    }

    // ───── Connexion (comme un utilisateur) ─────

    private func login(_ user: String, _ code: String) throws {
        let family = try XCTUnwrap(env["COURSES_FAMILY"], "code famille de recette absent")
        // 1. Écran de connexion (le même que sur Android)
        waitFor("Bienvenue", 40)
        attach("connexion-\(user)")
        // Comme un utilisateur : toucher le champ (son indication), puis taper au clavier.
        // Compose Multiplatform expose chaque champ de saisie comme un élément touchable sans libellé, de la largeur de l'écran :
        // on les prend dans l'ordre de l'écran (identifiant famille, identifiant personnel, code), comme un utilisateur.
        func champs() -> [XCUIElement] {
            app.buttons.allElementsBoundByIndex
                .filter { !["Se connecter", "Première connexion", "Besoin d'aide ?"].contains($0.label) && !$0.label.hasPrefix("Serveur")
                    && $0.frame.height >= 48 && $0.frame.height <= 64 && $0.frame.width > 250 }
                .sorted { $0.frame.minY < $1.frame.minY }
        }
        XCTAssertGreaterThanOrEqual(champs().count, 3, "champs de connexion : \(champs().count) trouvés")
        // Comme un utilisateur : toucher le premier champ, taper, puis « Retour » pour passer au champ suivant.
        press(champs()[0]); sleep(1)
        for (i, texte) in [family, user, code].enumerated() {
            if i > 0 && !app.keyboards.firstMatch.exists {
                // Pas de passage automatique au champ suivant : toucher le champ n° i+1.
                let c = champs()
                if c.count <= i {
                    print("Éléments touchables à l'écran :")
                    for b in app.buttons.allElementsBoundByIndex { print("  « \(b.label) » \(b.frame)") }
                    attach("champ-absent-\(i + 1)")
                    XCTFail("champ n° \(i + 1) introuvable"); return
                }
                press(c[i]); sleep(1)
            }
            typeKeys(texte); sleep(1)
            if i < 2, let ret = [app.keyboards.buttons["Return"], app.keyboards.buttons["Next"], app.keyboards.buttons["next"], app.keyboards.buttons["Suivant"]].first(where: { $0.exists }) { press(ret); sleep(1) }
            attach("saisie-\(i + 1)")
        }
        attach("2-connexion-remplie")
        // Le clavier recouvre le bas de l'écran : le fermer (toucher le titre), faire défiler, puis toucher « Se connecter ».
        press(waitFor("Bienvenue"))
        sleep(1)
        // Deux éléments s'appellent « Se connecter » : l'onglet en haut (demi-largeur) et le bouton du bas (pleine largeur).
        func boutonConnexion() -> XCUIElement? {
            any("Se connecter").allElementsBoundByIndex.filter { onScreen($0) && $0.frame.width > 250 }.first
        }
        for _ in 0..<4 where boutonConnexion() == nil { app.swipeUp(velocity: .slow); sleep(2) }
        // Position relevée APRÈS l'arrêt du défilement (relevée pendant, elle est périmée et le toucher tombe à côté).
        var ok = false
        for essai in 1...3 {
            sleep(2)
            attach("3-avant-connexion-\(essai)")
            if let bouton = boutonConnexion(), bouton.frame.height > 0 {
                print("Essai \(essai) : « Se connecter » (accessibilité) à \(bouton.frame)")
                press(bouton)
            } else if let y = lowestTealBand() {
                // Compose donne à ce bouton un cadre d'accessibilité vide : il est repéré à l'image (bandeau turquoise le plus bas).
                print("Essai \(essai) : « Se connecter » repéré à l'image, y = \(y)")
                app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: app.frame.width / 2, dy: y)).tap()
            } else {
                attach("bouton-absent"); XCTFail("bouton « Se connecter » introuvable (accessibilité et image)"); return
            }
            // Le toucher a pris si : « Connexion… », un message, ou l'écran suivant.
            for _ in 0..<8 {
                if anyContaining("Connexion…").firstMatch.exists || anyContaining("Choisir mes articles").firstMatch.exists
                    || anyContaining("Renseignez").firstMatch.exists || anyContaining("incorrect").firstMatch.exists { ok = true; break }
                usleep(500_000)
            }
            if ok { break }
        }
        XCTAssertTrue(ok, "le toucher sur « Se connecter » n'a rien déclenché (3 essais)")
        attach("4-apres-connexion")
    }

    // ───── Serveur commun (le même que celui d'Android) : attente de l'étape faite sur l'autre appareil ─────

    private func apiLogin(_ user: String, _ code: String) -> String? {
        guard let base = env["COURSES_SERVER"], let fam = env["COURSES_FAMILY"], let u = URL(string: base + "/api/auth/login") else { return nil }
        var r = URLRequest(url: u); r.httpMethod = "POST"; r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try? JSONSerialization.data(withJSONObject: ["familyCode": fam, "login": user, "secret": code, "clientFeatures": ["provisional"]])
        var cookie: String?
        let done = expectation(description: "connexion API")
        URLSession.shared.dataTask(with: r) { _, resp, _ in
            if let h = (resp as? HTTPURLResponse)?.value(forHTTPHeaderField: "Set-Cookie"), let c = h.components(separatedBy: ";").first, c.hasPrefix("sc_session=") { cookie = c }
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 30)
        return cookie
    }

    /// Liste en cours de la famille sur le serveur commun : (identifiant, noms des articles non retirés), ou nil s'il n'y en a pas.
    private func activeList(_ cookie: String) -> (id: String, items: [String])? {
        guard let base = env["COURSES_SERVER"], let u = URL(string: base + "/api/lists/active") else { return nil }
        var r = URLRequest(url: u); r.setValue(cookie, forHTTPHeaderField: "Cookie")
        var out: (String, [String])?
        let done = expectation(description: "liste API")
        URLSession.shared.dataTask(with: r) { data, _, _ in
            if let d = data, let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let l = o["list"] as? [String: Any], let id = l["id"] as? String {
                let items = (l["items"] as? [[String: Any]] ?? []).filter { ($0["status"] as? String) != "removed" }.compactMap { $0["name"] as? String }
                out = (id, items)
            }
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 30)
        return out
    }

    /// Attend (jusqu'à [minutes]) que le serveur commun vérifie [cond] : étape faite sur l'appareil Android.
    private func waitServer(_ what: String, minutes: Double = 35, _ cond: () -> Bool) {
        let end = Date().addingTimeInterval(minutes * 60)
        while Date() < end { if cond() { print("Serveur commun : \(what)"); return }; sleep(10) }
        XCTFail("serveur commun : « \(what) » pas observé en \(Int(minutes)) min")
    }

    /// Recherche dans « Choisir mes articles » / « Ajouter des articles », comme un utilisateur.
    private func search(_ text: String) {
        let field = anyContaining("Rechercher un produit").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 20), "champ de recherche absent")
        press(field); sleep(1)
        typeKeys(text.lowercased()); sleep(2)
    }

    /// Touche un bouton par son libellé ; s'il a un cadre d'accessibilité vide, il est repéré à l'image (bandeau turquoise le plus bas).
    private func tapButton(_ label: String) {
        let b = anyContaining(label).allElementsBoundByIndex.filter { $0.frame.height > 0 && onScreen($0) }.last
        if let b { press(b) } else if let y = lowestTealBand() {
            app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: app.frame.width / 2, dy: y)).tap()
        } else { attach("absent-\(label)"); XCTFail("bouton « \(label) » introuvable") }
        sleep(3)
    }

    private func relaunch(reset: Bool) {
        app.terminate()
        app.launchEnvironment["COURSES_RESET"] = reset ? "1" : "0"
        app.launch()
    }

    // ───── Sens 1 : liste créée sur Android, modifiée sur l'iPhone (personnel : marie) ─────

    func test1_ListeCreeeSurAndroid_ModifieeSurIPhone() throws {
        relaunch(reset: true)
        let api = try XCTUnwrap(apiLogin("marie", "573918"), "connexion API impossible")
        var list1 = ""
        waitServer("liste créée sur Android avec « Tomates »") {
            if let l = activeList(api), l.items.contains("Tomates") { list1 = l.id; return true }; return false
        }
        try login("marie", "573918")
        waitFor("Choisir mes articles", 40)
        search("Tomates")
        let tomates = waitFor("Tomates", 20)
        attach("sens1-iphone-tomates-android")
        XCTAssertTrue(anyContaining("Enregistré").firstMatch.waitForExistence(timeout: 20), "« Tomates » (ajouté sur Android) n'apparaît pas comme enregistré sur l'iPhone")
        _ = tomates
        // Ajout d'« Oignons » depuis l'iPhone, avec sa photo
        search("Oignons")
        let card = waitFor("Oignons", 20)
        sleep(4)
        attach("sens1-iphone-catalogue-oignons")
        XCTAssertTrue(hasPhoto(in: card.frame) || hasPhoto(in: CGRect(x: card.frame.minX, y: card.frame.minY - card.frame.height * 2, width: card.frame.width, height: card.frame.height * 3)),
                      "photo du produit « Oignons » non affichée")
        press(card); sleep(2)
        tapButton("Terminer ma sélection")
        attach("sens1-iphone-oignons-envoye")
        XCTAssertFalse(anyContaining("Envoi en attente").firstMatch.exists, "la demande est restée en attente d'envoi")
        waitServer("« Oignons » dans la liste créée sur Android", minutes: 2) {
            if let l = activeList(api), l.id == list1, l.items.contains("Oignons") { return true }; return false
        }
    }

    // ───── Sens 2 : liste créée sur l'iPhone, modifiée sur Android (administrateur : adil) ─────

    func test2_ListeCreeeSurIPhone_ModifieeSurAndroid() throws {
        relaunch(reset: true)
        let api = try XCTUnwrap(apiLogin("adil", "482913"), "connexion API impossible")
        waitServer("liste du sens 1 clôturée (aucune liste en cours)") { activeList(api) == nil }
        try login("adil", "482913")
        waitFor("Créer une liste", 40)
        attach("sens2-iphone-aucune-liste")
        tapButton("Créer une liste")
        search("Carottes")
        let card = waitFor("Carottes", 20)
        press(card); sleep(2)
        tapButton("Terminer ma sélection")
        attach("sens2-iphone-liste-creee")
        var list2 = ""
        waitServer("liste créée sur l'iPhone avec « Carottes »", minutes: 2) {
            if let l = activeList(api), l.items.contains("Carottes") { list2 = l.id; return true }; return false
        }
        // Android ajoute « Bananes » : il doit apparaître seul sur l'iPhone (sans action)
        let bananes = any("Bananes").firstMatch
        XCTAssertTrue(bananes.waitForExistence(timeout: 35 * 60), "« Bananes » (ajouté sur Android) n'apparaît pas sur l'iPhone")
        attach("sens2-iphone-bananes-android")
        XCTAssertEqual(activeList(api)?.id, list2, "« Bananes » n'est pas dans la liste créée sur l'iPhone")
    }
}
