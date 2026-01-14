import XLSX from "xlsx";
import path from "path";

export class OraceService {
    constructor(dataPath) {
        this.dataPath = dataPath;
        this.ecoles = [];
    }

    loadEcoles() {
        const filePath = path.join(this.dataPath, "orace", "CIRCO_ecoles.ods");

        try {
            const workbook = XLSX.readFile(filePath);
            console.log(
                `   📄 Feuilles trouvées: ${workbook.SheetNames.join(", ")}`
            );

            // Ignorer la première feuille (Aide à la lecture)
            const feuillesResultats = workbook.SheetNames.slice(1);

            // Map pour stocker les écoles (clé = UAI)
            const ecolesMap = new Map();

            feuillesResultats.forEach((sheetName) => {
                console.log(`\n   📊 Traitement feuille: ${sheetName}`);
                console.log("   " + "─".repeat(58));

                // Extraire niveau et matière (ex: CPFR -> CP + Français)
                const niveau = this.extraireNiveau(sheetName);
                const matiere = this.extraireMatiere(sheetName);

                const sheet = workbook.Sheets[sheetName];
                const range = XLSX.utils.decode_range(sheet["!ref"]);

                console.log(
                    `      🔍 Range: ${sheet["!ref"]} (${
                        range.e.c + 1
                    } colonnes)`
                );

                // Lire les compétences avec analyse automatique basée sur les fusions
                const competences = this.extraireCompetencesLigne3(sheet);

                if (competences.length === 0) {
                    console.warn(
                        `      ⚠️  Aucune compétence trouvée - feuille ignorée`
                    );
                    return;
                }

                // Lire les données à partir de la ligne 11 (index 10)
                const rangeData = XLSX.utils.sheet_to_json(sheet, {
                    range: 10, // Ligne 11 = index 10
                    header: 1, // Utiliser les indices numériques
                    defval: null,
                    raw: false, // Ne pas utiliser raw pour avoir les valeurs formatées
                });

                console.log(
                    `      ✓ ${rangeData.length} lignes de données à traiter`
                );

                let nbEcolesTraitees = 0;

                // Traiter chaque ligne (école)
                rangeData.forEach((row) => {
                    // Colonne 0 = UAI, Colonne 1 = Nom école
                    const uai = row[0] ? row[0].toString().trim() : "";
                    const nom = row[1] ? row[1].toString().trim() : "";

                    // Ignorer les lignes vides, totaux, ou sans UAI valide
                    if (
                        !uai ||
                        uai === "" ||
                        uai.toLowerCase().includes("total") ||
                        uai.toLowerCase().includes("circonscription")
                    ) {
                        return;
                    }

                    // Créer l'école si elle n'existe pas encore
                    if (!ecolesMap.has(uai)) {
                        ecolesMap.set(uai, {
                            uai: uai,
                            nom: nom,
                            resultats: {},
                        });
                    }

                    const ecole = ecolesMap.get(uai);

                    // Extraire les résultats pour chaque compétence
                    const resultats = this.extraireResultats(
                        row,
                        competences,
                        niveau,
                        matiere
                    );

                    // Fusionner avec les résultats existants
                    Object.assign(ecole.resultats, resultats);

                    nbEcolesTraitees++;
                });

                console.log(
                    `      ✓ ${nbEcolesTraitees} écoles traitées pour cette feuille`
                );
            });

            this.ecoles = Array.from(ecolesMap.values());
            console.log(
                `\n   ✅ ${this.ecoles.length} écoles uniques chargées depuis ORACE`
            );

            // Afficher un exemple de compétences extraites
            if (this.ecoles.length > 0) {
                const nbCompetences = Object.keys(
                    this.ecoles[0].resultats
                ).length;
                console.log(`   ✅ ~${nbCompetences} résultats par école`);
            }

            return this.ecoles;
        } catch (error) {
            console.error("❌ Erreur chargement ORACE:", error.message);
            console.error("   Stack:", error.stack);
            console.error("   Vérifiez que le fichier existe:", filePath);
            return [];
        }
    }

    /**
     * Convertit un index de colonne en lettre Excel (0 → A, 25 → Z, 26 → AA)
     */
    colIndexToLetter(col) {
        let letter = "";
        while (col >= 0) {
            letter = String.fromCharCode((col % 26) + 65) + letter;
            col = Math.floor(col / 26) - 1;
        }
        return letter;
    }

    /**
     * VERSION ULTRA-ULTIME : Prend en compte les fusions de lignes ET de colonnes
     */
    analyserStructureAvecFusions(sheet) {
        const range = XLSX.utils.decode_range(sheet["!ref"]);

        console.log(
            `\n      🔍 ANALYSE DE LA STRUCTURE (basée sur les fusions):\n`
        );
        console.log(`         Range total : ${sheet["!ref"]}\n`);

        // Vérifier que les fusions existent
        if (!sheet["!merges"] || sheet["!merges"].length === 0) {
            console.warn(
                `         ⚠️  Aucune fusion détectée, utilisation méthode classique\n`
            );
            return this.analyserStructureClassique(sheet);
        }

        console.log(
            `         🔗 ${sheet["!merges"].length} fusions de cellules détectées\n`
        );

        // 🎯 ÉTAPE 0 : Analyser les fusions de LIGNES (verticales) pour comprendre le décalage
        const fusionsVerticales = sheet["!merges"]
            .filter((m) => m.s.c === m.e.c && m.s.r < m.e.r) // Même colonne, lignes différentes
            .filter((m) => m.s.r <= 5 && m.e.r >= 5); // Qui touchent la ligne 6

        console.log(`         📐 Fusions verticales affectant l'en-tête :\n`);

        fusionsVerticales.forEach((f) => {
            const col = f.s.c;
            const colLetter = this.colIndexToLetter(col);
            const ligneDebut = f.s.r + 1;
            const ligneFin = f.e.r + 1;

            // Lire le contenu de la cellule
            const cellAddress = XLSX.utils.encode_cell({ r: f.s.r, c: col });
            const cell = sheet[cellAddress];
            const texte = cell && cell.v ? cell.v.toString().trim() : "";

            console.log(
                `            ${colLetter}${ligneDebut}:${colLetter}${ligneFin} "${texte.substring(
                    0,
                    30
                )}"`
            );
        });

        // 🎯 ÉTAPE 1 : Trouver les fusions sur la ligne 3 (compétences)
        const fusionsLigne3 = sheet["!merges"]
            .filter((m) => m.s.r === 2 && m.s.c !== m.e.c) // Ligne 3, fusion horizontale
            .sort((a, b) => a.s.c - b.s.c); // Trier par colonne

        console.log(
            `\n         📋 Fusions horizontales sur la ligne 3 (compétences) :\n`
        );

        const competences = [];

        fusionsLigne3.forEach((fusion, idx) => {
            const colDebut = fusion.s.c;
            const colFin = fusion.e.c;
            const largeur = colFin - colDebut + 1;

            const colDebutLetter = this.colIndexToLetter(colDebut);
            const colFinLetter = this.colIndexToLetter(colFin);

            // Lire le contenu de la première cellule de la fusion
            const cellAddress = XLSX.utils.encode_cell({ r: 2, c: colDebut });
            const cell = sheet[cellAddress];
            const texte = cell && cell.v ? cell.v.toString().trim() : "";

            // Ignorer si c'est pas une compétence
            const estCompetence =
                texte.length >= 10 &&
                !texte.toLowerCase().includes("compétence") &&
                !texte.toLowerCase().includes("exercice") &&
                !texte.toLowerCase().includes("participation") &&
                !texte.toLowerCase().includes("scores");

            if (estCompetence) {
                console.log(
                    `            ${
                        competences.length + 1
                    }. ${colDebutLetter}3:${colFinLetter}3 (${largeur} col, index ${colDebut}-${colFin})`
                );
                console.log(
                    `               "${texte.substring(0, 50)}${
                        texte.length > 50 ? "..." : ""
                    }"`
                );

                competences.push({
                    nom: texte,
                    colDebut: colDebut,
                    colFin: colFin,
                    largeur: largeur,
                    colDebutLetter: colDebutLetter,
                    colFinLetter: colFinLetter,
                });
            } else {
                console.log(
                    `            ⏭️  ${colDebutLetter}3:${colFinLetter}3 ignoré ("${texte.substring(
                        0,
                        30
                    )}")`
                );
            }
        });

        if (competences.length === 0) {
            console.warn(
                `\n         ⚠️  Aucune compétence valide trouvée dans les fusions\n`
            );
            return this.analyserStructureClassique(sheet);
        }

        console.log(
            `\n         ✅ ${competences.length} compétences détectées`
        );

        // 🎯 ÉTAPE 2 : Calculer l'espacement
        let espacement = 6;
        if (competences.length >= 2) {
            espacement = competences[1].colDebut - competences[0].colDebut;
            console.log(
                `\n         📏 Espacement entre compétences : ${espacement} colonnes`
            );
            console.log(
                `            (${competences[0].colDebutLetter} → ${competences[1].colDebutLetter})`
            );
        }

        // 🎯 ÉTAPE 3 : Pour chaque compétence, chercher "Groupe satisfaisant"
        //             dans TOUTES les cellules de sa plage (en tenant compte des fusions verticales)
        console.log(
            `\n         📊 Analyse détaillée de la structure de données :\n`
        );

        const competencesAvecOffsets = [];

        competences.forEach((comp, idx) => {
            console.log(
                `         Compétence ${idx + 1} : ${comp.colDebutLetter}3:${
                    comp.colFinLetter
                }3`
            );
            console.log(`         Recherche dans les lignes 4, 5, 6...\n`);

            let offsetPourcentageSatisfaisant = null;

            // Parcourir toutes les colonnes de cette compétence
            for (let col = comp.colDebut; col <= comp.colFin; col++) {
                const colLetter = this.colIndexToLetter(col);

                // Lire les lignes 4, 5, 6 pour cette colonne (en tenant compte des fusions)
                for (let row = 3; row <= 5; row++) {
                    // Lignes 4, 5, 6 (index 3, 4, 5)
                    const cellAddress = XLSX.utils.encode_cell({
                        r: row,
                        c: col,
                    });
                    const cell = sheet[cellAddress];
                    const valeur =
                        cell && cell.v
                            ? cell.v.toString().toLowerCase().trim()
                            : "";

                    if (valeur && valeur.length > 2) {
                        const rowLabel = row + 1;
                        console.log(
                            `            ${colLetter}${rowLabel} : "${valeur}"`
                        );

                        // Détecter "Groupe satisfaisant"
                        if (
                            valeur.includes("satisfaisant") ||
                            valeur.includes("satisf") ||
                            valeur.includes("satis")
                        ) {
                            console.log(
                                `                ↳ 🎯 Groupe satisfaisant détecté !`
                            );

                            // Si c'est "Nombre d'élèves", le % est à la colonne suivante
                            if (valeur.includes("nombre")) {
                                offsetPourcentageSatisfaisant =
                                    col + 1 - comp.colDebut;
                                const colPctLetter = this.colIndexToLetter(
                                    col + 1
                                );
                                console.log(
                                    `                ↳ ✅ % satisfaisant à ${colPctLetter}${rowLabel} (offset +${offsetPourcentageSatisfaisant})\n`
                                );
                                break;
                            } else if (
                                valeur.includes("%") ||
                                valeur.includes("sur le nombre")
                            ) {
                                // C'est directement la colonne du %
                                offsetPourcentageSatisfaisant =
                                    col - comp.colDebut;
                                console.log(
                                    `                ↳ ✅ % satisfaisant à ${colLetter}${rowLabel} (offset +${offsetPourcentageSatisfaisant})\n`
                                );
                                break;
                            }
                        }
                    }
                }

                if (offsetPourcentageSatisfaisant !== null) break;
            }

            // Si pas trouvé, utiliser heuristique (dernière colonne de la fusion)
            if (offsetPourcentageSatisfaisant === null) {
                console.warn(
                    `            ⚠️  "Groupe satisfaisant" non trouvé`
                );
                offsetPourcentageSatisfaisant = comp.largeur - 1;
                console.warn(
                    `            ℹ️  Utilisation heuristique : offset = +${offsetPourcentageSatisfaisant} (largeur - 1)\n`
                );
            }

            competencesAvecOffsets.push({
                ...comp,
                offsetPourcentage: offsetPourcentageSatisfaisant,
                colonnePourcentage:
                    comp.colDebut + offsetPourcentageSatisfaisant,
            });
        });

        // 🎯 ÉTAPE 4 : Vérification de cohérence entre compétences
        if (competencesAvecOffsets.length >= 2) {
            console.log(`\n         🔍 Vérification de cohérence :\n`);

            const offsets = competencesAvecOffsets.map(
                (c) => c.offsetPourcentage
            );
            const offsetsUniques = [...new Set(offsets)];

            if (offsetsUniques.length === 1) {
                console.log(
                    `            ✅ Structure cohérente ! Tous les offsets = +${offsets[0]}`
                );
            } else {
                console.warn(
                    `            ⚠️  Structure IRRÉGULIÈRE détectée !`
                );
                competencesAvecOffsets.forEach((c, idx) => {
                    const colPctLetter = this.colIndexToLetter(
                        c.colonnePourcentage
                    );
                    console.log(
                        `               Compétence ${idx + 1} : offset +${
                            c.offsetPourcentage
                        } (${colPctLetter})`
                    );
                });
            }
        }

        const offsetFinal = competencesAvecOffsets[0].offsetPourcentage;
        console.log(
            `\n         ✅ Configuration finale : espacement=${espacement}, offset=+${offsetFinal}\n`
        );

        // Construire le résultat
        const competencesAvecDonnees = competencesAvecOffsets.map((c) => ({
            nom: c.nom,
            colonneDebut: c.colonnePourcentage, // Colonne du % satisfaisant
        }));

        return {
            competences: competencesAvecDonnees,
            espacement: espacement,
            offsetPourcentageSatisfaisant: offsetFinal,
        };
    }

    /**
     * Méthode classique (fallback si pas de fusions)
     */
    analyserStructureClassique(sheet) {
        const range = XLSX.utils.decode_range(sheet["!ref"]);

        // Lire ligne 3 (compétences) et ligne 6 (groupes)
        const ligne3 = [];
        const ligne6 = [];

        for (let col = 0; col <= range.e.c; col++) {
            const cell3 = sheet[XLSX.utils.encode_cell({ r: 2, c: col })];
            const cell6 = sheet[XLSX.utils.encode_cell({ r: 5, c: col })];

            ligne3.push(cell3 ? (cell3.v || "").toString().trim() : "");
            ligne6.push(cell6 ? (cell6.v || "").toString().trim() : "");
        }

        console.log(`         📋 Méthode classique (sans fusions)\n`);

        // Trouver la colonne "Compétence"
        let colonneCompetence = ligne3.findIndex((v) =>
            v.toLowerCase().includes("compétence")
        );

        if (colonneCompetence === -1) {
            console.warn(
                `         ⚠️  Mot "Compétence" non trouvé dans la ligne 3`
            );
            return {
                competences: [],
                espacement: 6,
                offsetPourcentageSatisfaisant: 5,
            };
        }

        const colCompetenceLetter = this.colIndexToLetter(colonneCompetence);
        console.log(
            `         🎯 Marqueur "Compétence" : ${colCompetenceLetter}3 (index ${colonneCompetence})`
        );

        // Trouver toutes les compétences
        const competences = [];
        for (let col = colonneCompetence + 1; col < ligne3.length; col++) {
            if (ligne3[col] && ligne3[col].length >= 10) {
                competences.push({
                    col: col,
                    nom: ligne3[col],
                });
            }
        }

        console.log(`         ${competences.length} compétences détectées`);

        if (competences.length < 1) {
            return {
                competences: [],
                espacement: 6,
                offsetPourcentageSatisfaisant: 5,
            };
        }

        // Calculer espacement
        let espacement = 6;
        if (competences.length >= 2) {
            espacement = competences[1].col - competences[0].col;
        }

        // Chercher "satisfaisant" dans toute la ligne 6
        const groupesSatisfaisants = [];
        for (let col = 0; col < ligne6.length; col++) {
            const valeurGroupe = ligne6[col].toLowerCase();
            if (
                valeurGroupe.includes("satisfaisant") ||
                valeurGroupe.includes("satisf")
            ) {
                let colPourcentage = col;
                if (
                    valeurGroupe.includes("nombre") ||
                    !valeurGroupe.includes("%")
                ) {
                    colPourcentage = col + 1;
                }
                groupesSatisfaisants.push({ colPourcentage: colPourcentage });
            }
        }

        let offsetPourcentageSatisfaisant = 5;
        if (groupesSatisfaisants.length > 0) {
            offsetPourcentageSatisfaisant =
                groupesSatisfaisants[0].colPourcentage - competences[0].col;
        }

        console.log(
            `         ✅ Configuration : espacement=${espacement}, offset=+${offsetPourcentageSatisfaisant}\n`
        );

        const competencesAvecDonnees = competences.map((c) => ({
            nom: c.nom,
            colonneDebut: c.col + offsetPourcentageSatisfaisant,
        }));

        return {
            competences: competencesAvecDonnees,
            espacement: espacement,
            offsetPourcentageSatisfaisant: offsetPourcentageSatisfaisant,
        };
    }

    /**
     * Point d'entrée : essaie d'abord avec les fusions, puis fallback classique
     */
    extraireCompetencesLigne3(sheet) {
        const structure = this.analyserStructureAvecFusions(sheet);

        if (structure.competences.length === 0) {
            return [];
        }

        console.log(
            `      📋 ${structure.competences.length} compétences extraites avec colonnes de données:\n`
        );

        structure.competences.forEach((c, idx) => {
            const nomCourt =
                c.nom.length > 50 ? c.nom.substring(0, 47) + "..." : c.nom;
            const colLetter = this.colIndexToLetter(c.colonneDebut);
            console.log(
                `         ${(idx + 1)
                    .toString()
                    .padStart(2)}. ${colLetter} (index ${c.colonneDebut
                    .toString()
                    .padStart(2)}) : ${nomCourt}`
            );
        });

        console.log("");
        return structure.competences;
    }

    /**
     * Extrait les résultats pour toutes les compétences d'une ligne (école)
     * colonneDebut pointe directement vers la colonne du % satisfaisant
     */
    extraireResultats(row, competences, niveau, matiere) {
        const resultats = {};

        competences.forEach((comp) => {
            const pctSatisfaisant = this.parsePourcentage(
                row[comp.colonneDebut]
            );

            if (pctSatisfaisant !== null) {
                const nomCompetenceNormalise = this.normaliserNomCompetence(
                    comp.nom
                );
                const cleCompetence = `${niveau}_${matiere}_${nomCompetenceNormalise}`;
                resultats[cleCompetence] = pctSatisfaisant;
            }
        });

        return resultats;
    }

    /**
     * Parse un pourcentage (gère "50 %", "50%", "50,5 %", 0.5, etc.)
     */
    parsePourcentage(valeur) {
        if (valeur === null || valeur === undefined || valeur === "") {
            return null;
        }

        let valeurStr = valeur.toString().trim();

        // Enlever le symbole %
        valeurStr = valeurStr.replace("%", "").trim();

        // Remplacer la virgule par un point (format français)
        valeurStr = valeurStr.replace(",", ".");

        const valeurNum = parseFloat(valeurStr);

        if (isNaN(valeurNum)) {
            return null;
        }

        // Si la valeur est entre 0 et 1, c'est une fraction (0.5 = 50%)
        if (valeurNum > 0 && valeurNum < 1) {
            return valeurNum * 100;
        }

        return valeurNum;
    }

    /**
     * Normalise le nom d'une compétence
     */
    normaliserNomCompetence(nom) {
        return nom
            .trim()
            .replace(/\s+/g, "_")
            .replace(/[()]/g, "")
            .replace(/[éèê]/g, "e")
            .replace(/[àâ]/g, "a")
            .replace(/[îï]/g, "i")
            .replace(/[ôö]/g, "o")
            .replace(/[ùû]/g, "u")
            .replace(/ç/g, "c")
            .replace(/'/g, "")
            .substring(0, 100);
    }

    extraireNiveau(sheetName) {
        const match = sheetName.match(/^(CP|CE1|CE2|CM1|CM2)/i);
        return match
            ? match[1].toUpperCase()
            : sheetName.substring(0, 3).toUpperCase();
    }

    extraireMatiere(sheetName) {
        if (sheetName.toUpperCase().includes("FR")) return "francais";
        if (sheetName.toUpperCase().includes("MA")) return "maths";
        return "inconnu";
    }

    getEcoles() {
        return this.ecoles;
    }

    getCompetencesParNiveauMatiere() {
        const competences = {};

        this.ecoles.forEach((ecole) => {
            Object.keys(ecole.resultats).forEach((comp) => {
                const parts = comp.split("_");
                const niveau = parts[0];
                const matiere = parts[1];
                const key = `${niveau}_${matiere}`;

                if (!competences[key]) {
                    competences[key] = new Set();
                }
                competences[key].add(comp);
            });
        });

        Object.keys(competences).forEach((key) => {
            competences[key] = Array.from(competences[key]);
        });

        return competences;
    }

    afficherResume() {
        console.log("\n📋 RÉSUMÉ DES DONNÉES ORACE:\n");

        const competencesParNM = this.getCompetencesParNiveauMatiere();

        Object.keys(competencesParNM)
            .sort()
            .forEach((key) => {
                const [niveau, matiere] = key.split("_");
                const matiereLabel =
                    matiere === "francais" ? "Français" : "Maths";
                console.log(
                    `   ${niveau} ${matiereLabel}: ${competencesParNM[key].length} compétences`
                );

                if (competencesParNM[key].length > 0) {
                    const exemple = competencesParNM[key][0]
                        .split("_")
                        .slice(2)
                        .join("_")
                        .replace(/_/g, " ");
                    console.log(`      Ex: ${exemple.substring(0, 60)}...`);
                }
            });

        console.log(`\n   Total: ${this.ecoles.length} écoles\n`);
    }

    afficherDetailEcole(uai) {
        const ecole = this.ecoles.find((e) => e.uai === uai);

        if (!ecole) {
            console.log(`\n❌ École ${uai} non trouvée dans les données ORACE`);
            console.log(`   Écoles disponibles:`);
            this.ecoles.slice(0, 5).forEach((e) => {
                console.log(`      - ${e.uai}: ${e.nom}`);
            });
            console.log("");
            return;
        }

        console.log("\n" + "═".repeat(80));
        console.log(`🔍 DÉTAILS ÉCOLE: ${ecole.nom} (${ecole.uai})`);
        console.log("═".repeat(80));

        console.log(`\n📋 Informations générales:`);
        console.log(`   UAI: ${ecole.uai}`);
        console.log(`   Nom: ${ecole.nom}`);
        console.log(
            `   Nombre total de résultats: ${
                Object.keys(ecole.resultats).length
            }`
        );

        const parNiveauMatiere = {};
        Object.keys(ecole.resultats).forEach((comp) => {
            const parts = comp.split("_");
            const niveau = parts[0];
            const matiere = parts[1];
            const key = `${niveau}_${matiere}`;

            if (!parNiveauMatiere[key]) {
                parNiveauMatiere[key] = [];
            }

            parNiveauMatiere[key].push({
                competence: parts.slice(2).join(" ").replace(/_/g, " "),
                valeur: ecole.resultats[comp],
            });
        });

        console.log(
            `\n📊 Résultats par niveau et matière (% groupe SATISFAISANT):\n`
        );

        Object.keys(parNiveauMatiere)
            .sort()
            .forEach((key) => {
                const [niveau, matiere] = key.split("_");
                const matiereLabel =
                    matiere === "francais" ? "Français" : "Maths";
                const competences = parNiveauMatiere[key];

                console.log(
                    `\n   ${niveau} ${matiereLabel} (${competences.length} compétences):`
                );
                console.log("   " + "─".repeat(76));

                competences.forEach((c, idx) => {
                    const competenceAffichee =
                        c.competence.length > 55
                            ? c.competence.substring(0, 52) + "..."
                            : c.competence;
                    console.log(
                        `   ${(idx + 1)
                            .toString()
                            .padStart(2)}. ${competenceAffichee.padEnd(
                            56
                        )} ${c.valeur.toFixed(1)}%`
                    );
                });
            });

        console.log("\n" + "═".repeat(80) + "\n");
    }

    listerEcoles() {
        console.log("\n📋 LISTE DES ÉCOLES CHARGÉES:\n");
        this.ecoles.forEach((e, idx) => {
            const nbResultats = Object.keys(e.resultats).length;
            console.log(
                `   ${(idx + 1).toString().padStart(2)}. ${e.uai} - ${
                    e.nom
                } (${nbResultats} résultats)`
            );
        });
        console.log("");
    }
}
