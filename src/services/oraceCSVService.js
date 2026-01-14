import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";

/**
 * Service de lecture des données ORACE depuis des fichiers CSV exportés
 *
 * Structure attendue des CSV :
 * - Ligne 1  : Identification (ex: "Evaluation cm2fr")
 * - Ligne 3  : Titres des compétences (avec colonnes vides dues aux fusions)
 * - Ligne 7  : Groupes ("Groupe à besoins", "Groupe fragile", "Groupe satisfaisant")
 * - Ligne 11+: Données des écoles (UAI, Nom, puis valeurs)
 *
 * @class OraceCSVService
 */
export class OraceCSVService {
    constructor(dataPath) {
        this.dataPath = dataPath;
        this.ecoles = [];
    }

    /**
     * Charge toutes les écoles depuis les fichiers CSV
     * @returns {Array} Tableau d'écoles avec leurs résultats
     */
    loadEcoles() {
        console.log("   📂 Chargement depuis fichiers CSV...\n");

        // Configurations des fichiers à charger
        const configs = [
            { niveau: "CP", matiere: "francais", prefix: "cpfr" },
            { niveau: "CP", matiere: "maths", prefix: "cpma" },
            { niveau: "CE1", matiere: "francais", prefix: "ce1fr" },
            { niveau: "CE1", matiere: "maths", prefix: "ce1ma" },
            { niveau: "CE2", matiere: "francais", prefix: "ce2fr" },
            { niveau: "CE2", matiere: "maths", prefix: "ce2ma" },
            { niveau: "CM1", matiere: "francais", prefix: "cm1fr" },
            { niveau: "CM1", matiere: "maths", prefix: "cm1ma" },
            { niveau: "CM2", matiere: "francais", prefix: "cm2fr" },
            { niveau: "CM2", matiere: "maths", prefix: "cm2ma" },
        ];

        // Map pour stocker les écoles (clé = UAI)
        const ecolesMap = new Map();

        configs.forEach((config) => {
            const fichier = `CIRCO_ecoles_${config.prefix.toUpperCase()}.csv`;
            const resultatsFichier = this.chargerFichierCSV(
                fichier,
                config.niveau,
                config.matiere
            );

            // Fusionner les résultats dans la map
            resultatsFichier.forEach((ecole) => {
                if (!ecolesMap.has(ecole.uai)) {
                    ecolesMap.set(ecole.uai, {
                        uai: ecole.uai,
                        nom: ecole.nom,
                        resultats: {},
                    });
                }

                const ecoleExistante = ecolesMap.get(ecole.uai);
                Object.assign(ecoleExistante.resultats, ecole.resultats);
            });
        });

        this.ecoles = Array.from(ecolesMap.values());

        console.log(
            `\n   ✅ ${this.ecoles.length} écoles uniques chargées depuis CSV`
        );

        if (this.ecoles.length > 0) {
            const nbCompetences = Object.keys(this.ecoles[0].resultats).length;
            console.log(`   ✅ ~${nbCompetences} résultats par école`);
        }

        return this.ecoles;
    }

    /**
     * Charge un fichier CSV spécifique
     * @param {string} nomFichier - Nom du fichier CSV
     * @param {string} niveau - Niveau scolaire (CP, CE1, etc.)
     * @param {string} matiere - Matière (francais, maths)
     * @returns {Array} Tableau d'écoles avec résultats pour ce fichier
     */
    chargerFichierCSV(nomFichier, niveau, matiere) {
        const cheminComplet = path.join(
            this.dataPath,
            "orace",
            "csv",
            nomFichier
        );

        console.log(`   📊 Traitement: ${nomFichier}`);
        console.log("   " + "─".repeat(58));

        try {
            // Vérifier que le fichier existe
            if (!fs.existsSync(cheminComplet)) {
                console.warn(
                    `      ⚠️  Fichier non trouvé: ${cheminComplet} - ignoré`
                );
                return [];
            }

            // Lire le contenu du fichier
            const contenu = fs.readFileSync(cheminComplet, "utf-8");

            // Parser le CSV avec les bons paramètres
            const lignes = parse(contenu, {
                delimiter: ";",
                skip_empty_lines: false,
                relax_column_count: true, // Important pour gérer les fusions
                trim: true,
            });

            // Validation: vérifier la première ligne
            if (!this.validerIdentification(lignes[0], niveau, matiere)) {
                console.warn(
                    `      ❌ Identification invalide - fichier ignoré`
                );
                return [];
            }

            console.log(`      ✓ Identification validée`);

            // Détecter automatiquement la ligne contenant les groupes
            const ligneGroupes = this.trouverLigneGroupes(lignes);

            if (ligneGroupes === null) {
                console.warn(
                    `      ⚠️  Ligne des groupes ("Groupe satisfaisant") non trouvée - fichier ignoré`
                );
                return [];
            }

            console.log(
                `      ✓ Ligne des groupes détectée: ligne ${ligneGroupes + 1}`
            );

            // Détecter la ligne des pourcentages (après la ligne des groupes)
            const lignePourcentages = this.trouverLignePourcentages(
                lignes,
                ligneGroupes
            );

            if (lignePourcentages === null) {
                console.warn(
                    `      ⚠️  Ligne des pourcentages ("%" ou "nombre d'élèves répondants") non trouvée - fichier ignoré`
                );
                return [];
            }

            console.log(
                `      ✓ Ligne des pourcentages détectée: ligne ${
                    lignePourcentages + 1
                }`
            );

            // Extraire les compétences (ligne 3, index 2)
            const competences = this.extraireCompetences(
                lignes[2],
                lignes[ligneGroupes],
                lignes[lignePourcentages] // Passer aussi la ligne des pourcentages
            );

            if (competences.length === 0) {
                console.warn(
                    `      ⚠️  Aucune compétence trouvée - fichier ignoré`
                );
                return [];
            }

            console.log(
                `      ✓ ${competences.length} compétences identifiées`
            );

            // Trouver automatiquement la première ligne de données d'écoles
            const premiereLigneEcole = this.trouverPremiereEcole(
                lignes,
                lignePourcentages
            );

            console.log(
                `      ✓ Première école détectée: ligne ${
                    premiereLigneEcole + 1
                }`
            );

            // Extraire les données des écoles (à partir de la ligne détectée)
            const ecoles = this.extraireEcoles(
                lignes.slice(premiereLigneEcole),
                competences,
                niveau,
                matiere
            );

            console.log(`      ✓ ${ecoles.length} écoles extraites`);

            return ecoles;
        } catch (error) {
            console.error(
                `      ❌ Erreur lors du chargement de ${nomFichier}:`,
                error.message
            );
            return [];
        }
    }

    /**
     * Valide que la première ligne contient la bonne identification
     * @param {Array} ligne1 - Première ligne du CSV
     * @param {string} niveau - Niveau attendu
     * @param {string} matiere - Matière attendue
     * @returns {boolean} true si valide
     */
    validerIdentification(ligne1, niveau, matiere) {
        if (!ligne1 || ligne1.length === 0) {
            return false;
        }

        // Construire le pattern attendu: "Evaluation cm2fr"
        const matiereCode = matiere === "francais" ? "fr" : "ma";
        const patternAttendu = `evaluation ${niveau.toLowerCase()}${matiereCode}`;

        // Vérifier dans toutes les cellules de la ligne 1
        const trouve = ligne1.some((cellule) => {
            if (!cellule) return false;
            const normalise = cellule.toLowerCase().trim();
            return normalise.includes(patternAttendu);
        });

        if (!trouve) {
            console.warn(`      ⚠️  Pattern attendu: "${patternAttendu}"`);
            console.warn(`      ⚠️  Trouvé: ${ligne1.slice(0, 3).join(" | ")}`);
        }

        return trouve;
    }

    /**
     * Trouve automatiquement la ligne contenant "Groupe satisfaisant"
     * Scanne les lignes 3 à 10 (indices 2 à 9)
     * @param {Array} lignes - Toutes les lignes du CSV
     * @returns {number|null} Index de la ligne des groupes, ou null si non trouvée
     */
    trouverLigneGroupes(lignes) {
        // Scanner les lignes 3 à 10 (indices 2 à 9)
        for (let i = 2; i < Math.min(10, lignes.length); i++) {
            const ligne = lignes[i];

            // Vérifier si cette ligne contient "Groupe satisfaisant"
            const contientGroupe = ligne.some((cellule) => {
                if (!cellule) return false;
                const normalise = cellule.toLowerCase().trim();
                return normalise.includes("satisfaisant");
            });

            if (contientGroupe) {
                return i;
            }
        }

        return null;
    }

    /**
     * Trouve la ligne contenant les pourcentages (après la ligne des groupes)
     * Cette ligne contient "%" ou "nombre d'élèves répondants"
     * @param {Array} lignes - Toutes les lignes du CSV
     * @param {number} ligneGroupes - Index de la ligne des groupes
     * @returns {number|null} Index de la ligne des pourcentages, ou null si non trouvée
     */
    trouverLignePourcentages(lignes, ligneGroupes) {
        // Scanner les 3 lignes après la ligne des groupes
        for (
            let i = ligneGroupes + 1;
            i < Math.min(ligneGroupes + 4, lignes.length);
            i++
        ) {
            const ligne = lignes[i];

            // Vérifier si cette ligne contient "%" ou "répondants"
            const contientPourcentage = ligne.some((cellule) => {
                if (!cellule) return false;
                const normalise = cellule.toLowerCase().trim();
                return (
                    normalise.includes("%") ||
                    normalise.includes("répondants") ||
                    normalise.includes("repondants")
                );
            });

            if (contientPourcentage) {
                return i;
            }
        }

        return null;
    }

    /**
     * Trouve automatiquement la première ligne contenant des données d'écoles
     * Commence après la ligne des pourcentages et cherche une ligne avec un UAI valide
     * @param {Array} lignes - Toutes les lignes du CSV
     * @param {number} lignePourcentages - Index de la ligne des pourcentages
     * @returns {number} Index de la première ligne de données
     */
    trouverPremiereEcole(lignes, lignePourcentages) {
        // Commencer à chercher après la ligne des pourcentages
        for (let i = lignePourcentages + 1; i < lignes.length; i++) {
            const ligne = lignes[i];
            const uai = (ligne[0] || "").trim();
            const nom = (ligne[1] || "").trim();

            // Vérifier si c'est une ligne de données valide
            if (
                uai &&
                nom &&
                !uai.toLowerCase().includes("uai") && // Pas un header
                !uai.toLowerCase().includes("total") &&
                !uai.toLowerCase().includes("circonscription") &&
                uai.length >= 7
            ) {
                // UAI fait généralement 8 caractères

                return i;
            }
        }

        // Par défaut, ligne 11 (index 10) si rien trouvé
        return 10;
    }

    /**
     * Extrait les compétences depuis la ligne 3 (index 2)
     * Gère les colonnes vides dues aux fusions
     *
     * @param {Array} ligne3 - Ligne des compétences
     * @param {Array} ligneGroupes - Ligne des groupes (pour identifier "Groupe satisfaisant")
     * @param {Array} lignePourcentages - Ligne des pourcentages (pour identifier la colonne du %)
     * @returns {Array} Tableau d'objets {nom, colonne}
     */
    extraireCompetences(ligne3, ligneGroupes, lignePourcentages) {
        const competences = [];
        let competenceEnCours = null;
        let colonneDebutCompetence = null;

        ligne3.forEach((cellule, index) => {
            const texte = (cellule || "").trim();

            // Si cellule non vide et c'est une nouvelle compétence
            if (texte.length > 0) {
                // Critères pour identifier une vraie compétence
                const estCompetence =
                    texte.length >= 10 &&
                    !texte.toLowerCase().includes("compétence") &&
                    !texte.toLowerCase().includes("exercice") &&
                    !texte.toLowerCase().includes("participation") &&
                    !texte.toLowerCase().includes("scores");

                if (estCompetence) {
                    // Si on avait une compétence en cours, la finaliser
                    if (competenceEnCours) {
                        this.finaliserCompetence(
                            competences,
                            competenceEnCours,
                            colonneDebutCompetence,
                            index - 1,
                            ligneGroupes,
                            lignePourcentages // Passer la ligne des pourcentages
                        );
                    }

                    // Démarrer une nouvelle compétence
                    competenceEnCours = texte;
                    colonneDebutCompetence = index;
                }
            }
        });

        // Finaliser la dernière compétence
        if (competenceEnCours) {
            this.finaliserCompetence(
                competences,
                competenceEnCours,
                colonneDebutCompetence,
                ligne3.length - 1,
                ligneGroupes,
                lignePourcentages // Passer la ligne des pourcentages
            );
        }

        return competences;
    }

    /**
     * Finalise une compétence en trouvant la colonne du pourcentage "Groupe satisfaisant"
     * CORRECTION MAJEURE : On cherche maintenant le POURCENTAGE, pas le nombre
     *
     * @param {Array} competences - Tableau des compétences
     * @param {string} nomCompetence - Nom de la compétence
     * @param {number} colDebut - Colonne de début
     * @param {number} colFin - Colonne de fin
     * @param {Array} ligneGroupes - Ligne des groupes
     * @param {Array} lignePourcentages - Ligne des pourcentages
     */
    finaliserCompetence(
        competences,
        nomCompetence,
        colDebut,
        colFin,
        ligneGroupes,
        lignePourcentages
    ) {
        // ÉTAPE 1 : Chercher "Groupe satisfaisant" dans la plage de colonnes
        let colonneSatisfaisantGroupe = null;

        for (let col = colDebut; col <= colFin; col++) {
            const texte = (ligneGroupes[col] || "").toLowerCase().trim();
            if (texte.includes("satisfaisant")) {
                colonneSatisfaisantGroupe = col;
                break;
            }
        }

        if (colonneSatisfaisantGroupe === null) {
            // Message d'avertissement détaillé
            console.warn(
                `      ⚠️  Pas de "Groupe satisfaisant" trouvé pour: ${nomCompetence.substring(
                    0,
                    40
                )}...`
            );
            console.warn(
                `          Plage examinée: colonnes ${colDebut}-${colFin}`
            );
            return;
        }

        // ÉTAPE 2 : Chercher la colonne du POURCENTAGE après avoir trouvé "satisfaisant"
        // On cherche dans les 3 colonnes suivant "Groupe satisfaisant"
        let colonnePourcentage = null;

        for (
            let col = colonneSatisfaisantGroupe;
            col <= Math.min(colonneSatisfaisantGroupe + 3, colFin);
            col++
        ) {
            const texte = (lignePourcentages[col] || "").toLowerCase().trim();
            // On cherche une cellule qui contient "%" ou "répondants"
            if (
                texte.includes("%") ||
                texte.includes("répondants") ||
                texte.includes("repondants")
            ) {
                colonnePourcentage = col;
                break;
            }
        }

        if (colonnePourcentage !== null) {
            competences.push({
                nom: nomCompetence,
                colonne: colonnePourcentage, // ✅ C'est la colonne du POURCENTAGE
            });
        } else {
            // Si on n'a pas trouvé la colonne du pourcentage, essayer colonne suivante
            // (cas où il y a : Nombre | % )
            console.warn(
                `      ⚠️  Colonne du pourcentage non identifiée précisément pour: ${nomCompetence.substring(
                    0,
                    40
                )}...`
            );
            console.warn(
                `          On utilise la colonne suivant "satisfaisant" (col ${
                    colonneSatisfaisantGroupe + 1
                })`
            );

            competences.push({
                nom: nomCompetence,
                colonne: colonneSatisfaisantGroupe + 1, // Par défaut : colonne suivante
            });
        }
    }

    /**
     * Extrait les données des écoles depuis les lignes CSV
     * @param {Array} lignesEcoles - Lignes contenant les données des écoles
     * @param {Array} competences - Liste des compétences identifiées
     * @param {string} niveau - Niveau scolaire
     * @param {string} matiere - Matière
     * @returns {Array} Tableau d'écoles avec résultats
     */
    extraireEcoles(lignesEcoles, competences, niveau, matiere) {
        const ecoles = [];

        lignesEcoles.forEach((ligne) => {
            // Colonne 0 = UAI, Colonne 1 = Nom
            const uai = (ligne[0] || "").trim();
            const nom = (ligne[1] || "").trim();

            // Ignorer les lignes vides, totaux, ou sans UAI valide
            if (
                !uai ||
                uai === "" ||
                uai.toLowerCase().includes("total") ||
                uai.toLowerCase().includes("circonscription")
            ) {
                return;
            }

            const resultats = {};

            // Extraire le % satisfaisant pour chaque compétence
            competences.forEach((comp) => {
                const valeurCellule = ligne[comp.colonne];
                const pctSatisfaisant = this.parsePourcentage(valeurCellule);

                if (pctSatisfaisant !== null) {
                    const nomCompetenceNormalise = this.normaliserNomCompetence(
                        comp.nom
                    );
                    const cleCompetence = `${niveau}_${matiere}_${nomCompetenceNormalise}`;
                    resultats[cleCompetence] = pctSatisfaisant;
                }
            });

            // Ajouter l'école seulement si elle a au moins un résultat
            if (Object.keys(resultats).length > 0) {
                ecoles.push({
                    uai: uai,
                    nom: nom,
                    resultats: resultats,
                });
            }
        });

        return ecoles;
    }

    /**
     * Parse un pourcentage au format français ("50,5 %")
     * @param {string} valeur - Valeur à parser
     * @returns {number|null} Pourcentage ou null si invalide
     */
    parsePourcentage(valeur) {
        if (valeur === null || valeur === undefined || valeur === "") {
            return null;
        }

        let valeurStr = valeur.toString().trim();

        // Enlever le symbole %
        valeurStr = valeurStr.replace("%", "").trim();

        // Remplacer la virgule par un point (format français → anglais)
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
     * Normalise le nom d'une compétence pour créer une clé
     * @param {string} nom - Nom de la compétence
     * @returns {string} Nom normalisé
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

    /**
     * Retourne la liste des écoles chargées
     * @returns {Array} Liste des écoles
     */
    getEcoles() {
        return this.ecoles;
    }

    /**
     * Retourne les compétences groupées par niveau/matière
     * @returns {Object} Dictionnaire niveau_matiere → [compétences]
     */
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

        // Convertir les Sets en Arrays
        Object.keys(competences).forEach((key) => {
            competences[key] = Array.from(competences[key]);
        });

        return competences;
    }

    /**
     * Affiche un résumé des données chargées
     */
    afficherResume() {
        console.log("\n📋 RÉSUMÉ DES DONNÉES ORACE (CSV):\n");

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

    /**
     * Affiche le détail d'une école spécifique
     * @param {string} uai - UAI de l'école
     */
    afficherDetailEcole(uai) {
        const ecole = this.ecoles.find((e) => e.uai === uai);

        if (!ecole) {
            console.log(`\n❌ École ${uai} non trouvée dans les données CSV`);
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

    /**
     * Liste toutes les écoles chargées
     */
    listerEcoles() {
        console.log("\n📋 LISTE DES ÉCOLES CHARGÉES (CSV):\n");
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
