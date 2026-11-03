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
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@ OR value CONTAINS[c] %@", text, text))
    }

    /// Fiche d'un article : Compose regroupe tout le texte de la fiche dans un libellé (« Tomates, au kilo, Dans la liste · 1 kg »).
    /// Le champ de recherche contient aussi le nom tapé : il est écarté (champ de saisie, ou libellé égal au seul nom), comme tout
    /// élément hors de l'écran ou sans cadre ; on garde la fiche la plus haute sous le champ de recherche.
    @discardableResult
    private func waitCard(_ name: String, _ timeout: TimeInterval = 20) -> XCUIElement {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            let field = anyContaining("Rechercher un produit").allElementsBoundByIndex.first { $0.frame.height > 0 }
            let top = field.map { $0.frame.maxY } ?? 0
            let cards = anyContaining(name).allElementsBoundByIndex.filter { e in
                guard onScreen(e), e.frame.height >= 40, e.frame.minY >= top - 1 else { return false }
                let skip: [XCUIElement.ElementType] = [.textField, .searchField, .secureTextField, .keyboard, .key]
                if skip.contains(e.elementType) { return false }
                return e.label.lowercased() != name.lowercased() || e.frame.height >= 80
            }
            // Une fiche est un bouton (cliquable) ; à défaut, tout élément restant.
            let buttons = cards.filter { $0.elementType == .button }
            if let c = (buttons.isEmpty ? cards : buttons).min(by: { $0.frame.minY < $1.frame.minY }) { return c }
            // Fiche sélectionnée : seul son texte peut être exposé (cadre plus petit) ; on le prend après quelques secondes.
            if Date() > deadline.addingTimeInterval(-timeout / 2) {
                let skip: [XCUIElement.ElementType] = [.textField, .searchField, .secureTextField, .keyboard, .key]
                let bottom = app.windows.firstMatch.frame.maxY
                let texts = anyContaining(name).allElementsBoundByIndex.filter { e in
                    e.frame.height > 0 && e.frame.minY > top + 1 && e.frame.maxY <= bottom && !skip.contains(e.elementType)
                }
                if let t = texts.min(by: { $0.frame.minY < $1.frame.minY }) { return t }
            }
            usleep(500_000)
        } while Date() < deadline
        attach("absent-\(name)")
        print("Arborescence d'accessibilité (fiche \(name)) :\n\(app.debugDescription)")
        XCTFail("fiche « \(name) » introuvable après \(Int(timeout)) s")
        return anyContaining(name).firstMatch
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

    /// Vide le champ qui a le clavier (l'application retient l'identifiant famille et l'identifiant personnel, comme sur Android).
    private func clearFocused(max: Int = 40) {
        let kb = app.keyboards.firstMatch
        guard kb.waitForExistence(timeout: 8) else { return }
        guard let del = [kb.keys["delete"], kb.buttons["delete"], kb.keys["Supprimer"], kb.buttons["Supprimer"], kb.keys["Delete"]].first(where: { $0.exists }) else { return }
        for _ in 0..<max { del.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap() }
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
            clearFocused(); typeKeys(texte); sleep(1)
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
    /// Renomme la liste en cours (signal pour l'autre appareil ou le Mac, par le serveur commun).
    private func renameList(_ cookie: String, _ id: String, _ name: String) {
        guard let base = env["COURSES_SERVER"], let u = URL(string: base + "/api/lists/" + id) else { return }
        var r = URLRequest(url: u); r.httpMethod = "PATCH"; r.setValue(cookie, forHTTPHeaderField: "Cookie")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try? JSONSerialization.data(withJSONObject: ["name": name])
        let done = expectation(description: "renommage")
        URLSession.shared.dataTask(with: r) { _, resp, _ in
            print("Signal « \(name) » : HTTP \((resp as? HTTPURLResponse)?.statusCode ?? 0)"); done.fulfill()
        }.resume()
        wait(for: [done], timeout: 30)
    }

    private func listName(_ cookie: String) -> String? {
        guard let base = env["COURSES_SERVER"], let u = URL(string: base + "/api/lists/active") else { return nil }
        var r = URLRequest(url: u); r.setValue(cookie, forHTTPHeaderField: "Cookie")
        var out: String?
        let done = expectation(description: "nom de liste")
        URLSession.shared.dataTask(with: r) { data, _, _ in
            if let d = data, let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let l = o["list"] as? [String: Any] { out = l["name"] as? String ?? "" }
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 30)
        return out
    }

    private func stamp() -> String { ISO8601DateFormatter().string(from: Date()) }

    /// Réseau du simulateur (recette) : fichier signal lu par scripts/ios-reseau.sh sur le Mac (pare-feu vers le serveur de recette).
    private func reseau(_ coupe: Bool) {
        let f = NSTemporaryDirectory() + (coupe ? "courses-reseau-coupe" : "courses-reseau-retablit")
        FileManager.default.createFile(atPath: f, contents: Data())
        print("\(stamp()) iPhone : réseau \(coupe ? "COUPÉ" : "RÉTABLI") demandé")
        sleep(6)
    }

    /// Ouvre une liste vide pour la famille (API, administrateur) ; ferme d'abord les listes en cours.
    private func freshList(_ cookie: String) -> String? {
        guard let base = env["COURSES_SERVER"] else { return nil }
        func call(_ method: String, _ path: String) -> [String: Any]? {
            var r = URLRequest(url: URL(string: base + path)!); r.httpMethod = method; r.setValue(cookie, forHTTPHeaderField: "Cookie")
            if method == "POST" { r.setValue("application/json", forHTTPHeaderField: "Content-Type"); r.httpBody = "{}".data(using: .utf8) }
            var out: [String: Any]?
            let done = expectation(description: path)
            URLSession.shared.dataTask(with: r) { d, _, _ in out = d.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }; done.fulfill() }.resume()
            wait(for: [done], timeout: 30)
            return out
        }
        for l in (call("GET", "/api/lists/open")?["lists"] as? [[String: Any]] ?? []) { if let id = l["id"] as? String { _ = call("POST", "/api/lists/\(id)/close") } }
        if let id = (call("GET", "/api/lists/active")?["list"] as? [String: Any])?["id"] as? String { _ = call("POST", "/api/lists/\(id)/close") }
        return (call("POST", "/api/lists")?["list"] as? [String: Any])?["id"] as? String
    }

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
        clearFocused()   // la recherche précédente reste dans le champ
        typeKeys(text.lowercased()); sleep(2)
    }

    /// Onglet de la barre du bas (Liste, Historique, Statistiques, Réglages).
    private func tapTab(_ label: String) {
        let w = app.windows.firstMatch.frame
        if let t = anyContaining(label).allElementsBoundByIndex.filter({ $0.frame.height > 0 && $0.frame.minY > w.maxY - 140 }).last { press(t) }
        else { app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: w.width * 0.875, dy: w.maxY - 50)).tap() }
        sleep(2)
    }

    /// Ajoute l'article à la sélection : touche le « + » (« Ajouter ») de sa fiche, sinon la fiche elle-même, puis vérifie que
    /// « Terminer ma sélection » devient actif (sélection réellement prise en compte).
    private func addToSelection(_ name: String, _ card: XCUIElement) {
        print("Fiche « \(name) » : \(card.label) \(card.frame)")
        for attempt in 0..<3 {
            let plus = any("Ajouter").allElementsBoundByIndex.filter { onScreen($0) }
                .min { abs($0.frame.midY - card.frame.midY) < abs($1.frame.midY - card.frame.midY) }
            if attempt < 2, let plus { press(plus) } else { press(card) }
            sleep(2)
            let done = anyContaining("Terminer ma sélection").allElementsBoundByIndex.filter { $0.frame.height > 0 }
            if done.contains(where: { $0.isEnabled }) { return }
        }
        attach("selection-\(name)-non-prise")
        print("Arborescence d'accessibilité (sélection \(name)) :\n\(app.debugDescription)")
        XCTFail("« \(name) » n'a pas pu être ajouté à la sélection")
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
        waitCard("Tomates", 20)
        attach("sens1-iphone-tomates-android")
        // Repère « Dans la liste · 1 kg » de la fiche : libellé regroupé de la fiche ou texte séparé selon la version de Compose.
        let enListe = anyContaining("Dans la liste").firstMatch.waitForExistence(timeout: 20)
        if !enListe { print("Arborescence d'accessibilité (fiche Tomates) :\n\(app.debugDescription)") }
        // Échec signalé sans arrêter le parcours : le reste du contrôle croisé (Android attend « Oignons ») doit se dérouler.
        continueAfterFailure = true
        XCTAssertTrue(enListe, "« Tomates » (ajouté sur Android) n'apparaît pas « Dans la liste » sur l'iPhone")
        continueAfterFailure = false
        // Ajout d'« Oignons » depuis l'iPhone, avec sa photo
        search("Oignons")
        let card = waitCard("Oignons", 20)
        sleep(4)
        attach("sens1-iphone-catalogue-oignons")
        XCTAssertTrue(hasPhoto(in: card.frame) || hasPhoto(in: CGRect(x: card.frame.minX, y: card.frame.minY - card.frame.height * 2, width: card.frame.width, height: card.frame.height * 3)),
                      "photo du produit « Oignons » non affichée")
        addToSelection("Oignons", card)
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
        let card = waitCard("Carottes", 20)
        addToSelection("Carottes", card)
        tapButton("Terminer ma sélection")
        attach("sens2-iphone-liste-creee")
        var list2 = ""
        waitServer("liste créée sur l'iPhone avec « Carottes »", minutes: 2) {
            if let l = activeList(api), l.items.contains("Carottes") { list2 = l.id; return true }; return false
        }
        // Android ajoute « Bananes » : il doit apparaître seul sur l'iPhone (sans action)
        let bananes = anyContaining("Bananes").firstMatch
        XCTAssertTrue(bananes.waitForExistence(timeout: 35 * 60), "« Bananes » (ajouté sur Android) n'apparaît pas sur l'iPhone")
        attach("sens2-iphone-bananes-android")
        XCTAssertEqual(activeList(api)?.id, list2, "« Bananes » n'est pas dans la liste créée sur l'iPhone")
    }
    // ───── Contrôle restant (service Railway de recette, HTTPS direct) : ajout sur Android visible SEUL sur l'iPhone,
    //       puis reconnexion automatique après une coupure réseau. Aucune actualisation manuelle. ─────

    func test3_AjoutAndroidVisibleSurIPhone_EtReconnexion() throws {
        relaunch(reset: true)
        let api = try XCTUnwrap(apiLogin("adil", "482913"), "connexion API impossible")
        var list = ""
        waitServer("liste vide ouverte par Android", minutes: 60) {
            if let l = activeList(api), l.items.isEmpty, (listName(api) ?? "x").isEmpty { list = l.id; return true }; return false
        }
        try login("adil", "482913")
        waitFor("Ajouter des articles", 40)
        sleep(5)   // flux en direct ouvert
        attach("r-iphone-liste-vide")
        XCTAssertFalse(anyContaining("Bananes").firstMatch.exists, "« Bananes » déjà présent avant l'ajout sur Android")
        renameList(api, list, "iphone-pret-1")
        print("\(stamp()) iPhone : liste affichée, signal envoyé à Android ; attente de « Bananes » sans aucune action")
        let bananes = anyContaining("Bananes").firstMatch.waitForExistence(timeout: 20 * 60)
        print("\(stamp()) iPhone : « Bananes » \(bananes ? "affiché" : "NON affiché")")
        attach("r-iphone-bananes")
        XCTAssertTrue(bananes, "« Bananes » (ajouté sur Android) n'apparaît pas seul sur l'iPhone")
        guard bananes else { return }
        // Coupure réseau : le Mac coupe l'accès au serveur ; Android ajoute « Oranges » pendant la coupure.
        renameList(api, list, "iphone-coupure")
        print("\(stamp()) iPhone : coupure réseau demandée ; attente de « Oranges » après rétablissement, sans aucune action")
        let oranges = anyContaining("Oranges").firstMatch.waitForExistence(timeout: 20 * 60)
        print("\(stamp()) iPhone : « Oranges » \(oranges ? "affiché" : "NON affiché")")
        attach("r-iphone-oranges-apres-reconnexion")
        XCTAssertTrue(oranges, "« Oranges » (ajouté sur Android pendant la coupure) n'apparaît pas seul après le rétablissement du réseau")
        XCTAssertFalse(anyContaining("Envoi en attente").firstMatch.exists, "message « Envoi en attente » restant après la reconnexion")
    }
    // ───── Hors connexion : ajout sans réseau, fermeture et réouverture hors connexion, session conservée, envoi au retour ─────

    func test4_HorsConnexion_ReouvertureEtSession() throws {
        relaunch(reset: true)
        let api = try XCTUnwrap(apiLogin("adil", "482913"), "connexion API impossible")
        let list = try XCTUnwrap(freshList(api), "liste de recette non ouverte")
        try login("adil", "482913")
        waitFor("Ajouter des articles", 40)
        // Session conservée : fermeture puis réouverture, sans nouvelle saisie du code.
        relaunch(reset: false)
        XCTAssertTrue(anyContaining("Ajouter des articles").firstMatch.waitForExistence(timeout: 30), "session perdue après fermeture et réouverture")
        XCTAssertFalse(any("Bienvenue").firstMatch.exists, "écran de connexion affiché après réouverture")
        attach("h1-session-conservee")
        // Hors connexion : ajout de « Citrons ».
        reseau(true)
        tapButton("Ajouter des articles")
        search("Citrons")
        addToSelection("Citrons", waitCard("Citrons", 20))
        tapButton("Terminer ma sélection")
        sleep(3)
        attach("h2-ajout-hors-connexion")
        XCTAssertTrue(anyContaining("attente").firstMatch.waitForExistence(timeout: 20), "aucune indication d'envoi en attente hors connexion")
        XCTAssertTrue(anyContaining("Citrons").firstMatch.exists, "« Citrons » absent de la liste hors connexion")
        // Fermeture et réouverture TOUJOURS hors connexion : session, liste et envoi en attente conservés.
        app.terminate()
        relaunch(reset: false)
        XCTAssertTrue(anyContaining("Citrons").firstMatch.waitForExistence(timeout: 30), "liste locale perdue après réouverture hors connexion")
        XCTAssertFalse(any("Bienvenue").firstMatch.exists, "session perdue après réouverture hors connexion")
        XCTAssertTrue(anyContaining("attente").firstMatch.waitForExistence(timeout: 15), "envoi en attente perdu après réouverture hors connexion")
        continueAfterFailure = true
        XCTAssertTrue(anyContaining("Hors connexion").firstMatch.waitForExistence(timeout: 45), "état « Hors connexion » non indiqué")
        continueAfterFailure = false
        attach("h3-reouverture-hors-connexion")
        // Retour du réseau : envoi automatique, sans action.
        reseau(false)
        var envoye = false
        for _ in 0..<60 { if !anyContaining("attente").firstMatch.exists { envoye = true; break }; sleep(2) }
        attach("h4-reseau-revenu")
        XCTAssertTrue(envoye, "l'envoi en attente n'est pas parti au retour du réseau")
        waitServer("« Citrons » reçu par le serveur après le retour du réseau", minutes: 3) {
            if let l = activeList(api), l.id == list, l.items.contains("Citrons") { return true }; return false
        }
    }

    // ───── Clavier et affichage (lancé sur un petit et un grand iPhone) ─────

    func test5_ClavierEtAffichage() throws {
        relaunch(reset: true)
        waitFor("Bienvenue", 40)
        let w = app.windows.firstMatch.frame
        func champs() -> [XCUIElement] {
            app.buttons.allElementsBoundByIndex
                .filter { !["Se connecter", "Première connexion", "Besoin d'aide ?"].contains($0.label) && !$0.label.hasPrefix("Serveur")
                    && $0.frame.height >= 48 && $0.frame.height <= 64 && $0.frame.width > 200 }
                .sorted { $0.frame.minY < $1.frame.minY }
        }
        // Un seul instantané de l'écran (parcourir les éléments un à un échoue si l'écran change pendant le parcours).
        func horsLargeur() -> [String] {
            guard let snap = try? app.snapshot() else { return [] }
            var out: [String] = []
            func walk(_ e: XCUIElementSnapshot) {
                let f = e.frame
                if f.width > 0 && (f.maxX > w.maxX + 1 || f.minX < w.minX - 1) { out.append("\(e.label) \(f)") }
                e.children.forEach(walk)
            }
            walk(snap)
            return out
        }
        XCTAssertEqual(horsLargeur(), [], "éléments qui débordent de l'écran (connexion)")
        attach("k0-connexion")
        // Comme un utilisateur : toucher le 1er champ, taper, « Retour » vers le champ suivant ; chaque champ en cours de saisie
        // doit rester visible au-dessus du clavier (le formulaire défile si besoin, en particulier sur petit écran).
        let family = try XCTUnwrap(env["COURSES_FAMILY"])
        let c = champs()
        XCTAssertGreaterThanOrEqual(c.count, 3, "champs de connexion")
        func suivant() {
            if let r = [app.keyboards.buttons["Return"], app.keyboards.buttons["Next"], app.keyboards.buttons["next"], app.keyboards.buttons["Suivant"]].first(where: { $0.exists }) { press(r); sleep(1) }
        }
        func visible(_ n: String, _ e: XCUIElement?) {
            let kb = app.keyboards.firstMatch
            XCTAssertTrue(kb.waitForExistence(timeout: 8), "clavier absent (\(n))")
            let f = e?.frame ?? .zero
            attach("k-clavier-\(n.replacingOccurrences(of: " ", with: "-"))")
            XCTAssertTrue(f.height > 0 && f.minY >= w.minY && f.maxY <= kb.frame.minY + 1, "« \(n) » caché par le clavier (champ \(f), clavier \(kb.frame))")
        }
        press(c[0]); sleep(1)
        clearFocused(); typeKeys(family); sleep(1)
        // Champ retrouvé par le texte tapé (la référence d'avant l'ouverture du clavier n'est plus fiable).
        visible("identifiant famille", anyContaining(family).allElementsBoundByIndex.first { $0.frame.height > 0 && $0.elementType != .key })
        suivant()
        clearFocused(); typeKeys("adil"); sleep(1)
        visible("identifiant personnel", anyContaining("adil").allElementsBoundByIndex.first { $0.frame.height > 0 && $0.elementType != .key })
        suivant()
        clearFocused(); typeKeys("482913"); sleep(1)
        visible("code", any("Afficher le code").allElementsBoundByIndex.first { $0.frame.height > 0 })
        press(waitFor("Bienvenue")); sleep(1)
        try login("adil", "482913")
        XCTAssertTrue(anyContaining("Ajouter des articles").firstMatch.waitForExistence(timeout: 40) || anyContaining("Créer une liste").firstMatch.exists, "écran de la liste")
        XCTAssertEqual(horsLargeur(), [], "éléments qui débordent de l'écran (liste)")
        attach("k4-liste")
        if anyContaining("Ajouter des articles").firstMatch.exists { tapButton("Ajouter des articles") } else { tapButton("Créer une liste") }
        let field = anyContaining("Rechercher un produit").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 20), "recherche absente")
        press(field); sleep(1); clearFocused(); typeKeys("courg"); sleep(2)
        let kb = app.keyboards.firstMatch
        XCTAssertTrue(kb.exists, "clavier absent (recherche)")
        let f = anyContaining("Rechercher un produit").allElementsBoundByIndex.first { $0.frame.height > 0 }?.frame ?? .zero
        XCTAssertTrue(f.maxY <= kb.frame.minY + 1, "champ de recherche caché par le clavier")
        // La fiche du résultat doit être ENTIÈREMENT visible au-dessus du clavier (nom compris), puis sélectionnable clavier ouvert.
        var fiche: XCUIElement? = nil
        for _ in 0..<30 where fiche == nil {
            fiche = anyContaining("Courgettes").allElementsBoundByIndex.first { e in
                let r = e.frame; return r.height >= 100 && r.minY > f.maxY && r.maxY <= kb.frame.minY + 1
            }
            if fiche == nil { usleep(500_000) }
        }
        attach("k5-recherche-clavier")
        if fiche == nil { for e in anyContaining("Courgettes").allElementsBoundByIndex { print("Courgettes : « \(e.label) » \(e.frame)") } }
        let carte = try XCTUnwrap(fiche, "fiche « Courgettes » pas entièrement visible au-dessus du clavier (clavier \(kb.frame))")
        press(carte); sleep(2)
        XCTAssertTrue(app.keyboards.firstMatch.exists, "le clavier s'est fermé en sélectionnant")
        attach("k6-selection-clavier-ouvert")
        // Clavier fermé : la barre « Terminer ma sélection » revient, avec l'article choisi.
        press(waitFor(app.staticTexts["Ajouter des articles"].exists ? "Ajouter des articles" : "Choisir mes articles")); sleep(2)
        XCTAssertTrue(anyContaining("Terminer ma sélection (").firstMatch.waitForExistence(timeout: 10), "article non sélectionné ou barre « Terminer ma sélection » absente après fermeture du clavier")
        attach("k7-clavier-ferme")
        XCTAssertEqual(horsLargeur(), [], "éléments qui débordent de l'écran (sélection)")
        attach("k5-recherche-clavier")
    }
    // ───── Notifications : autorisation, réception d'une notification de demande (APNs simulée), rappels programmés ─────

    func test6_NotificationsEtRappels() throws {
        relaunch(reset: true)
        let api = try XCTUnwrap(apiLogin("adil", "482913"), "connexion API impossible")
        _ = try XCTUnwrap(freshList(api), "liste de recette non ouverte")
        try login("adil", "482913")
        waitFor("Ajouter des articles", 40)
        // Un article à acheter (les rappels ne sont programmés que s'il reste quelque chose).
        tapButton("Ajouter des articles"); search("Carottes"); addToSelection("Carottes", waitCard("Carottes", 20)); tapButton("Terminer ma sélection"); sleep(3)
        // Réglages → Notifications et rappels
        tapTab("Réglages")
        press(waitFor("Notifications et rappels", 20)); sleep(2)
        attach("n1-ecran-notifications")
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        func autoriser() {
            for l in ["Allow", "Autoriser"] where springboard.buttons[l].waitForExistence(timeout: 6) { springboard.buttons[l].tap(); sleep(2); return }
        }
        // Lignes regroupées (titre + description dans un seul libellé) : recherche par « contient ».
        func ligne(_ t: String) -> XCUIElement {
            let e = anyContaining(t).firstMatch
            XCTAssertTrue(e.waitForExistence(timeout: 15), "« \(t) » introuvable")
            return e
        }
        press(ligne("Nouvelles demandes")); autoriser()
        press(ligne("Me rappeler les articles restants")); autoriser()
        sleep(2)
        attach("n2-notifications-activees")
        XCTAssertFalse(anyContaining("bloque les notifications").firstMatch.exists, "notifications bloquées malgré l'autorisation")
        XCTAssertTrue(anyContaining("Lun").firstMatch.exists, "jours des rappels non affichés")
        // Application quittée : rappels programmés (journal), puis notification de demande reçue et touchée.
        XCUIDevice.shared.press(.home); sleep(3)
        FileManager.default.createFile(atPath: NSTemporaryDirectory() + "courses-push", contents: Data())
        let banner = springboard.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Marie a ajouté 1 produit")).firstMatch
        XCTAssertTrue(banner.waitForExistence(timeout: 30), "notification de demande non affichée (application fermée)")
        attach("n3-notification-recue")
        banner.tap(); sleep(3)
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15), "le toucher n'ouvre pas l'application")
        attach("n4-application-ouverte")
        // Application ouverte : la notification s'affiche aussi.
        FileManager.default.createFile(atPath: NSTemporaryDirectory() + "courses-push", contents: Data())
        XCTAssertTrue(springboard.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Marie a ajouté 1 produit")).firstMatch.waitForExistence(timeout: 30), "notification non affichée application ouverte")
        attach("n5-notification-application-ouverte")
    }
}
