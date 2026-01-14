import { IPSService } from "./services/ipsService.js";
import { ReferencesService } from "./services/referencesService.js";
import { OraceCSVService } from "./services/oraceCSVService.js";
import { AnalyseService } from "./services/analyseService.js";
import { GraphiqueService } from "./services/graphiqueService.js";
import XLSX from "xlsx";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Programme principal d'analyse IPS des évaluations nationales
 */
async function main() {
    console.log(
        "\n╔════════════════════════════════════════════════════════════╗"
    );
    console.log(
        "║ ANALYSE IPS - ÉVALUATIONS NATIONALES REPÈRES 2025         ║"
    );
    console.log(
        "║ ÉCOLES PUBLIQUES UNIQUEMENT                                ║"
    );
    console.log(
        "║ VERSION CSV + FILTRE DÉPARTEMENTAL + GRAPHIQUES PDF       ║"
    );
    console.log(
        "╚════════════════════════════════════════════════════════════╝\n"
    );

    const startTime = Date.now();

    try {
        // ═══════════════════════════════════════════════════════════
        // ÉTAPE 1: Chargement des données ORACE (CSV)
        // ═══════════════════════════════════════════════════════════
        console.log("📂 ÉTAPE 1/8: Chargement des données ORACE (CSV)");
        console.log("─".repeat(60));

        const oraceService = new OraceCSVService(path.join(__dirname, "data"));
        const ecoles = oraceService.loadEcoles();

        if (ecoles.length === 0) {
            throw new Error(
                "❌ Aucune école trouvée dans les CSV. Vérifiez les fichiers CIRCO_ecoles_*.csv"
            );
        }

        // Afficher le résumé de la structure
        oraceService.afficherResume();

        console.log("");

        // ═══════════════════════════════════════════════════════════
        // ÉTAPE 2: Récupération des IPS via API
        // ═══════════════════════════════════════════════════════════
        console.log("🌐 ÉTAPE 2/8: Récupération des IPS via API data.gouv");
        console.log("─".repeat(60));

        const ipsService = new IPSService();

        // ⚠️ CONFIGURATION: Choisir la méthode de filtrage
        // Option A: Par département(s)
        const DEPARTEMENTS = ["07"]; // Ardèche - Ajoutez d'autres codes si besoin: ["07", "26", "38"]

        // Option B: Par académie (décommentez pour utiliser)
        // const ACADEMIE = "GRENOBLE";

        const uais = ecoles.map((e) => e.uai).filter((u) => u && u.length > 0);
        console.log(` 📋 ${uais.length} UAI à traiter`);
        console.log(` 📋 Exemples: ${uais.slice(0, 3).join(", ")}...\n`);

        // Chargement selon la méthode choisie
        let ipsData;
        if (DEPARTEMENTS && DEPARTEMENTS.length > 0) {
            console.log(
                ` 🎯 Filtrage par département(s): ${DEPARTEMENTS.join(", ")}`
            );
            if (DEPARTEMENTS.length === 1) {
                ipsData = await ipsService.loadDepartementIPS(DEPARTEMENTS[0]);
            } else {
                ipsData = await ipsService.loadMultipleDepartementsIPS(
                    DEPARTEMENTS
                );
            }
        } else {
            // Utiliser le filtre académie (décommentez ACADEMIE ci-dessus)
            // console.log(` 🎯 Filtrage par académie: ${ACADEMIE}`);
            // ipsData = await ipsService.loadAcademieIPS(ACADEMIE);
            throw new Error("❌ Veuillez configurer DEPARTEMENTS ou ACADEMIE");
        }

        if (ipsData.length === 0) {
            throw new Error(
                "❌ Aucun IPS récupéré. Vérifiez la connexion API ou les codes département"
            );
        }

        // Afficher les statistiques du cache
        ipsService.afficherStatistiques();

        console.log("");

        // ═══════════════════════════════════════════════════════════
        // ÉTAPE 3: Fusion des données + FILTRAGE ÉCOLES PUBLIQUES
        // ═══════════════════════════════════════════════════════════
        console.log("🔗 ÉTAPE 3/8: Fusion IPS + Résultats ORACE");
        console.log("─".repeat(60));

        const ecolesWithIPSAll = ecoles
            .map((ecole) => {
                const ips = ipsData.find((i) => i.uai === ecole.uai);
                return {
                    ...ecole,
                    ips: ips?.ips,
                    secteur: ips?.secteur,
                    academie: ips?.academie,
                    departement: ips?.departement,
                    nom_commune: ips?.nom_commune,
                };
            })
            .filter((e) => e.ips && !isNaN(e.ips));

        console.log(` ✓ ${ecolesWithIPSAll.length} écoles avec IPS valide`);

        // Identifier les écoles privées AVANT le filtrage
        const ecolesPrivees = ecolesWithIPSAll.filter((e) => {
            const secteur = (e.secteur || "").toLowerCase();
            return secteur !== "public" && !secteur.includes("public");
        });

        // FILTRAGE DES ÉCOLES PUBLIQUES UNIQUEMENT
        const ecolesWithIPS = ecolesWithIPSAll.filter((e) => {
            const secteur = (e.secteur || "").toLowerCase();
            return secteur === "public" || secteur.includes("public");
        });

        const nbPrivees = ecolesPrivees.length;
        console.log(
            ` 🏫 ${ecolesWithIPS.length} écoles PUBLIQUES retenues pour l'analyse`
        );

        if (nbPrivees > 0) {
            console.log(
                ` 🚫 ${nbPrivees} école(s) PRIVÉE(S) exclue(s) de l'analyse`
            );
            console.log("\n 📋 Écoles privées exclues:");
            ecolesPrivees.forEach((e) => {
                console.log(`   - ${e.nom} (${e.uai}) - ${e.secteur}`);
            });
            console.log("");
        }

        if (ecolesWithIPS.length === 0) {
            throw new Error(
                "❌ Aucune école publique avec IPS valide. Impossible de poursuivre l'analyse."
            );
        }

        // Statistiques IPS (écoles publiques uniquement)
        const ipsValues = ecolesWithIPS.map((e) => e.ips);
        const ipsMin = Math.min(...ipsValues);
        const ipsMax = Math.max(...ipsValues);
        const ipsMoyen = (
            ipsValues.reduce((a, b) => a + b, 0) / ipsValues.length
        ).toFixed(1);

        console.log(
            ` 📊 IPS (écoles publiques) - min: ${ipsMin} | max: ${ipsMax} | moyen: ${ipsMoyen}`
        );

        // Écoles sans IPS
        const ecolesManquantes = ecoles.length - ecolesWithIPSAll.length;
        if (ecolesManquantes > 0) {
            console.log(
                ` ⚠️ ${ecolesManquantes} école(s) sans IPS (UAI introuvable ou invalide)`
            );
            const manquantes = ecoles.filter(
                (e) => !ecolesWithIPSAll.find((ew) => ew.uai === e.uai)
            );
            manquantes.forEach((e) => {
                console.log(`   - ${e.nom} (${e.uai})`);
            });
        }

        console.log("");

        // ═══════════════════════════════════════════════════════════
        // ÉTAPE 4: Chargement des références nationales DEPP
        // ═══════════════════════════════════════════════════════════
        console.log(
            "📚 ÉTAPE 4/8: Chargement des références DEPP (France/Académie)"
        );
        console.log("─".repeat(60));

        const referencesService = new ReferencesService(
            path.join(__dirname, "data")
        );

        // ⚠️ IMPORTANT: Adapter le nom de votre académie ici
        const ACADEMIE = "GRENOBLE"; // Modifier selon votre académie
        console.log(` 🎯 Académie de référence: ${ACADEMIE}`);
        console.log(` 🏫 Analyse limitée aux écoles PUBLIQUES uniquement\n`);

        referencesService.loadAllReferences(ACADEMIE);

        console.log("");

        // ═══════════════════════════════════════════════════════════
        // ÉTAPE 5: Calcul des régressions et analyses
        // ═══════════════════════════════════════════════════════════
        console.log(
            "🔬 ÉTAPE 5/8: Analyse IPS et catégorisation (écoles publiques)"
        );
        console.log("─".repeat(60));

        const analyseService = new AnalyseService(referencesService);

        // Calculer les régressions IPS de la circonscription (écoles publiques)
        console.log(" 🧮 Calcul des régressions IPS...");
        analyseService.calculateRegressions(ecolesWithIPS);

        // Analyser toutes les écoles sur toutes les compétences
        console.log(" 📊 Analyse de toutes les compétences...");
        const analyses = analyseService.analyserTout(ecolesWithIPS);

        if (analyses.length === 0) {
            throw new Error(
                "❌ Aucune analyse générée. Vérifiez les régressions et les données."
            );
        }

        console.log("");

        // ═══════════════════════════════════════════════════════════
        // ÉTAPE 6: Génération des vues synthétiques
        // ═══════════════════════════════════════════════════════════
        console.log("📊 ÉTAPE 6/8: Génération des vues synthétiques");
        console.log("─".repeat(60));

        const vue = analyseService.genererVueSynthetique(analyses);
        console.log(
            ` ✓ ${vue.ecoles_leviers.length} écoles dans la catégorie LEVIERS`
        );
        console.log(
            ` ✓ ${vue.ecoles_vigilance.length} écoles dans la catégorie VIGILANCE`
        );
        console.log("");

        // Générer les synthèses
        const syntheseEcoles = analyseService.genererSyntheseParEcole(analyses);
        const syntheseNiveauMatiere =
            analyseService.genererSyntheseParNiveauMatiere(analyses);

        // ═══════════════════════════════════════════════════════════
        // ÉTAPE 7: Export Excel
        // ═══════════════════════════════════════════════════════════
        console.log("💾 ÉTAPE 7/8: Génération du fichier Excel");
        console.log("─".repeat(60));

        const outputDir = path.join(__dirname, "output");
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const wb = XLSX.utils.book_new();

        // ───────────────────────────────────────────────────────────
        // Onglet 1: README
        // ───────────────────────────────────────────────────────────
        console.log(" 📄 Génération onglet: README");

        const ecolesPriveesInfo = ecolesPrivees.map((e) => [
            e.nom,
            e.uai,
            e.secteur,
        ]);

        const departementsStr =
            DEPARTEMENTS && DEPARTEMENTS.length > 0
                ? DEPARTEMENTS.join(", ")
                : "N/A";

        const readme = [
            ["ANALYSE IPS - ÉVALUATIONS NATIONALES REPÈRES 2025"],
            ["Source: CSV exports ORACE"],
            ["Date:", new Date().toLocaleDateString("fr-FR")],
            ["Académie:", ACADEMIE],
            ["Département(s):", departementsStr],
            [""],
            ["PORTÉE DE L'ANALYSE:"],
            ["Cette analyse porte UNIQUEMENT sur les écoles PUBLIQUES."],
            [`Total écoles publiques analysées: ${ecolesWithIPS.length}`],
            [`Écoles privées exclues: ${nbPrivees}`],
            [""],
            ["MÉTHODOLOGIE:"],
            [
                "Pour chaque compétence, une régression linéaire IPS est calculée sur les écoles PUBLIQUES de la circonscription.",
            ],
            [
                'Le résultat "attendu" pour chaque école est prédit selon son IPS.',
            ],
            [
                "L'écart entre le résultat réel et l'attendu détermine la catégorie.",
            ],
            [""],
            ["CATÉGORIES:"],
            ["🟢 LEVIER: Écart > +5 points (résultat supérieur à l'attendu)"],
            [
                "🔴 VIGILANCE: Écart < -5 points (résultat inférieur à l'attendu)",
            ],
            ["🟡 CONFORME: Écart entre -5 et +5 points"],
            [""],
            ["GRAPHIQUES PDF:"],
            [
                "Un graphique PDF a été généré pour chaque compétence dans le dossier output/graphiques/",
            ],
            [
                "Chaque graphique montre: la droite de régression, les zones LEVIER/VIGILANCE, et la position de chaque école.",
            ],
            [""],
            ["ÉCOLES PRIVÉES EXCLUES:"],
            ["Nom", "UAI", "Secteur"],
            ...ecolesPriveesInfo,
            [""],
            ["CONTACT:"],
            [
                "Pour toute question sur cette analyse, contacter le CPC Numérique de la circonscription.",
            ],
        ];

        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.aoa_to_sheet(readme),
            "📖 README"
        );

        // ───────────────────────────────────────────────────────────
        // Onglet 2: Synthèse par école
        // ───────────────────────────────────────────────────────────
        console.log(" 📄 Génération onglet: Synthèse par école");
        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.json_to_sheet(syntheseEcoles),
            "🏫 Synthèse par école"
        );

        // ───────────────────────────────────────────────────────────
        // Onglet 3: Synthèse par niveau/matière
        // ───────────────────────────────────────────────────────────
        console.log(" 📄 Génération onglet: Synthèse Niveau-Matière");
        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.json_to_sheet(syntheseNiveauMatiere),
            "📚 Synthèse Niveau-Matière"
        );

        // ───────────────────────────────────────────────────────────
        // Onglet 4: Analyse détaillée
        // ───────────────────────────────────────────────────────────
        console.log(" 📄 Génération onglet: Analyse détaillée");
        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.json_to_sheet(analyses),
            "📊 Analyse détaillée"
        );

        // ───────────────────────────────────────────────────────────
        // Onglet 5: Écoles LEVIERS
        // ───────────────────────────────────────────────────────────
        console.log(" 📄 Génération onglet: LEVIERS");
        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.json_to_sheet(vue.ecoles_leviers),
            "🟢 LEVIERS"
        );

        // ───────────────────────────────────────────────────────────
        // Onglet 6: Écoles VIGILANCE
        // ───────────────────────────────────────────────────────────
        console.log(" 📄 Génération onglet: VIGILANCE");
        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.json_to_sheet(vue.ecoles_vigilance),
            "🔴 VIGILANCE"
        );

        // ───────────────────────────────────────────────────────────
        // Onglet 7: TOP Écoles à accompagner (profil global)
        // ───────────────────────────────────────────────────────────
        console.log(" 📄 Génération onglet: TOP Accompagnement");

        const topAccompagnement = syntheseEcoles
            .filter(
                (e) =>
                    e.profil_global.includes("ACCOMPAGNEMENT") ||
                    e.profil_global.includes("VIGILANCE")
            )
            .slice(0, 20);

        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.json_to_sheet(topAccompagnement),
            "⚠️ TOP Accompagnement"
        );

        // ───────────────────────────────────────────────────────────
        // Onglet 8: TOP Écoles LEVIERS (profil global)
        // ───────────────────────────────────────────────────────────
        console.log(" 📄 Génération onglet: TOP Leviers");

        const topLeviers = syntheseEcoles
            .filter((e) => e.nb_leviers > 0)
            .sort((a, b) => b.nb_leviers - a.nb_leviers)
            .slice(0, 20);

        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.json_to_sheet(topLeviers),
            "🏆 TOP Leviers"
        );

        // ───────────────────────────────────────────────────────────
        // Sauvegarde du fichier
        // ───────────────────────────────────────────────────────────
        const timestamp = new Date()
            .toISOString()
            .slice(0, 19)
            .replace(/:/g, "-");

        const deptSuffix =
            DEPARTEMENTS && DEPARTEMENTS.length > 0
                ? `dept_${DEPARTEMENTS.join("_")}`
                : "academie";

        const outputPath = path.join(
            outputDir,
            `analyse_ips_publiques_${deptSuffix}_${timestamp}.xlsx`
        );

        XLSX.writeFile(wb, outputPath);
        console.log(`\n ✓ Fichier généré: ${outputPath}`);
        console.log("");

        // ═══════════════════════════════════════════════════════════
        // ÉTAPE 8: Génération des graphiques PDF
        // ═══════════════════════════════════════════════════════════
        console.log("📊 ÉTAPE 8/8: Génération des graphiques PDF");
        console.log("─".repeat(60));

        const graphiqueService = new GraphiqueService(outputDir);

        // Générer les graphiques
        await graphiqueService.genererTousLesGraphiques(
            analyses,
            analyseService.regressions,
            ecolesWithIPS.length
        );
        console.log("\n🔍 DEBUG RÉGRESSIONS:");
        console.log(
            "Nombre de régressions:",
            Object.keys(analyseService.regressions).length
        );
        console.log(
            "Exemples de clés régressions:",
            Object.keys(analyseService.regressions).slice(0, 5)
        );
        console.log("\n🔍 DEBUG ANALYSES:");
        console.log("Première analyse:", analyses[0]);
        console.log(
            "Clé construite:",
            `${analyses[0].niveau}_${analyses[0].matiere}_${analyses[0].competence}`
        );
        console.log("Compétence complète:", analyses[0].competence_complete);
        console.log("");
        console.log(
            `📁 Dossier des graphiques: ${path.join(outputDir, "graphiques")}`
        );
        console.log("");

        // ═══════════════════════════════════════════════════════════
        // Affichage du résumé final
        // ═══════════════════════════════════════════════════════════
        console.log("═".repeat(80));
        console.log(
            "✅ ANALYSE TERMINÉE AVEC SUCCÈS (ÉCOLES PUBLIQUES - FILTRE DEPT + PDF)"
        );
        console.log("═".repeat(80));
        console.log("");

        // ═══════════════════════════════════════════════════════════
        // TOP 5 Écoles LEVIERS
        // ═══════════════════════════════════════════════════════════
        console.log("🏆 TOP 5 ÉCOLES PUBLIQUES LEVIERS");
        console.log("═".repeat(80));
        console.log("(Écoles qui surperforment par rapport à leur IPS)");
        console.log("");

        topLeviers.slice(0, 5).forEach((e, i) => {
            console.log(`┌─ ${i + 1}. ${e.ecole.toUpperCase()}`);
            console.log(`│`);
            console.log(
                `│  📊 Contexte : IPS ${e.ips} (${e.categorie_ips}) | ${e.secteur}`
            );
            console.log(
                `│  ✅ Performance : ${e.nb_leviers}/${e.nb_total} compétences en LEVIER (${e.taux_leviers})`
            );

            if (e.nb_vigilance > 0) {
                console.log(
                    `│  ⚠️  Points de vigilance : ${e.nb_vigilance} compétences (${e.taux_vigilance})`
                );
            }

            console.log(`│`);
            console.log(`│  🎯 LEVIERS À VALORISER :`);
            console.log(`│`);

            // Récupérer les analyses détaillées pour cette école (pour avoir les écarts)
            const analysesEcole = analyses.filter(
                (a) => a.uai === e.uai && a.categorie_code === "LEVIER"
            );

            // Trier par écart décroissant (du plus fort au plus faible)
            analysesEcole.sort((a, b) => b.ecart_vs_ips - a.ecart_vs_ips);

            // Grouper par niveau et matière
            const leviersParNiveauMatiere = {};
            analysesEcole.forEach((analyse) => {
                const cle = `${analyse.niveau} ${analyse.matiere}`;
                if (!leviersParNiveauMatiere[cle]) {
                    leviersParNiveauMatiere[cle] = [];
                }
                leviersParNiveauMatiere[cle].push({
                    competence: analyse.competence
                        .replace(/_/g, " ")
                        .replace(/\s+/g, " ")
                        .trim(),
                    ecart: analyse.ecart_vs_ips,
                });
            });

            // Afficher par niveau/matière
            const niveauxMatieres = Object.keys(leviersParNiveauMatiere).sort();
            const nbNiveauxMatieres = niveauxMatieres.length;

            if (nbNiveauxMatieres === 0) {
                console.log(`│     (Aucun détail disponible)`);
            } else {
                niveauxMatieres.slice(0, 5).forEach((niveauMatiere, idx) => {
                    const competences = leviersParNiveauMatiere[niveauMatiere];
                    console.log(
                        `│     ${niveauMatiere} (${competences.length}) :`
                    );

                    // Afficher les 5 premières compétences (déjà triées par écart)
                    competences.slice(0, 5).forEach((comp) => {
                        console.log(
                            `│        • ${
                                comp.competence
                            } (+${comp.ecart.toFixed(1)} pts)`
                        );
                    });

                    if (competences.length > 5) {
                        console.log(
                            `│        ... et ${competences.length - 5} autre(s)`
                        );
                    }

                    // Ligne vide entre les niveaux/matières (sauf pour le dernier)
                    if (idx < Math.min(nbNiveauxMatieres, 5) - 1) {
                        console.log(`│`);
                    }
                });

                if (nbNiveauxMatieres > 5) {
                    console.log(`│`);
                    console.log(
                        `│     ... et ${
                            nbNiveauxMatieres - 5
                        } autre(s) niveaux/matières`
                    );
                }
            }

            console.log(`└${"─".repeat(78)}`);
            console.log("");
        });

        // ═══════════════════════════════════════════════════════════
        // TOP 5 Écoles À ACCOMPAGNER
        // ═══════════════════════════════════════════════════════════
        console.log("⚠️  TOP 5 ÉCOLES PUBLIQUES À ACCOMPAGNER EN PRIORITÉ");
        console.log("═".repeat(80));
        console.log("(Écoles en difficulté par rapport à leur IPS)");
        console.log("");

        topAccompagnement.slice(0, 5).forEach((e, i) => {
            console.log(`┌─ ${i + 1}. ${e.ecole.toUpperCase()}`);
            console.log(`│`);
            console.log(
                `│  📊 Contexte : IPS ${e.ips} (${e.categorie_ips}) | ${e.secteur}`
            );
            console.log(
                `│  🔴 Difficultés : ${e.nb_vigilance}/${e.nb_total} compétences en VIGILANCE (${e.taux_vigilance})`
            );
            console.log(`│  📈 Profil global : ${e.profil_global}`);

            if (e.nb_leviers > 0) {
                console.log(
                    `│  ✅ Points forts : ${e.nb_leviers} compétences en LEVIER (${e.taux_leviers})`
                );
            }

            console.log(`│`);
            console.log(`│  🎯 PRIORITÉS D'ACCOMPAGNEMENT :`);
            console.log(`│`);

            // Récupérer les analyses détaillées pour cette école (pour avoir les écarts)
            const analysesEcole = analyses.filter(
                (a) => a.uai === e.uai && a.categorie_code === "VIGILANCE"
            );

            // Trier par écart croissant (du plus négatif au moins négatif)
            analysesEcole.sort((a, b) => a.ecart_vs_ips - b.ecart_vs_ips);

            // Grouper par niveau et matière
            const vigilanceParNiveauMatiere = {};
            analysesEcole.forEach((analyse) => {
                const cle = `${analyse.niveau} ${analyse.matiere}`;
                if (!vigilanceParNiveauMatiere[cle]) {
                    vigilanceParNiveauMatiere[cle] = [];
                }
                vigilanceParNiveauMatiere[cle].push({
                    competence: analyse.competence
                        .replace(/_/g, " ")
                        .replace(/\s+/g, " ")
                        .trim(),
                    ecart: analyse.ecart_vs_ips,
                });
            });

            // Afficher par niveau/matière
            const niveauxMatieres = Object.keys(
                vigilanceParNiveauMatiere
            ).sort();
            const nbNiveauxMatieres = niveauxMatieres.length;

            if (nbNiveauxMatieres === 0) {
                console.log(`│     (Aucun détail disponible)`);
            } else {
                niveauxMatieres.slice(0, 5).forEach((niveauMatiere, idx) => {
                    const competences =
                        vigilanceParNiveauMatiere[niveauMatiere];
                    console.log(
                        `│     ${niveauMatiere} (${competences.length}) :`
                    );

                    // Afficher les 5 premières compétences (déjà triées par écart)
                    competences.slice(0, 5).forEach((comp) => {
                        console.log(
                            `│        • ${
                                comp.competence
                            } (${comp.ecart.toFixed(1)} pts)`
                        );
                    });

                    if (competences.length > 5) {
                        console.log(
                            `│        ... et ${competences.length - 5} autre(s)`
                        );
                    }

                    // Ligne vide entre les niveaux/matières (sauf pour le dernier)
                    if (idx < Math.min(nbNiveauxMatieres, 5) - 1) {
                        console.log(`│`);
                    }
                });

                if (nbNiveauxMatieres > 5) {
                    console.log(`│`);
                    console.log(
                        `│     ... et ${
                            nbNiveauxMatieres - 5
                        } autre(s) niveaux/matières`
                    );
                }
            }

            console.log(`└${"─".repeat(78)}`);
            console.log("");
        });

        // ═══════════════════════════════════════════════════════════
        // Statistiques par niveau/matière
        // ═══════════════════════════════════════════════════════════
        console.log("📚 SYNTHÈSE PAR NIVEAU ET MATIÈRE (écoles publiques)");
        console.log("═".repeat(80));
        console.log("");

        // Grouper par niveau
        const parNiveau = {};
        syntheseNiveauMatiere.forEach((nm) => {
            if (!parNiveau[nm.niveau]) {
                parNiveau[nm.niveau] = [];
            }
            parNiveau[nm.niveau].push(nm);
        });

        Object.keys(parNiveau)
            .sort()
            .forEach((niveau) => {
                console.log(`┌─ ${niveau}`);
                parNiveau[niveau].forEach((nm, idx) => {
                    const vigilanceFlag =
                        parseFloat(nm.taux_vigilance) > 25 ? " ⚠️" : "";
                    const leviersFlag =
                        parseFloat(nm.taux_leviers) > 25 ? " ✨" : "";

                    const prefix =
                        idx === parNiveau[niveau].length - 1 ? "└─" : "├─";
                    console.log(
                        `${prefix} ${nm.matiere.padEnd(12)} │ ` +
                            `Vigilance: ${nm.taux_vigilance.padStart(
                                6
                            )}${vigilanceFlag.padEnd(3)} │ ` +
                            `Leviers: ${nm.taux_leviers.padStart(
                                6
                            )}${leviersFlag.padEnd(3)} │ ` +
                            `Total: ${nm.nb_total
                                .toString()
                                .padStart(4)} analyses`
                    );
                });
                console.log("");
            });

        // ═══════════════════════════════════════════════════════════
        // Informations finales
        // ═══════════════════════════════════════════════════════════
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log("═".repeat(80));
        console.log(`⏱️  Durée totale d'exécution : ${duration}s`);
        console.log(
            `📊 Circonscription : ${ecolesWithIPS.length} écoles publiques analysées`
        );
        console.log(
            `📈 Analyses générées : ${analyses.length} (${(
                (analyses.length / (ecolesWithIPS.length * 82)) *
                100
            ).toFixed(1)}% de couverture)`
        );
        console.log("");
        console.log(`📎 Fichier Excel généré : ${path.basename(outputPath)}`);
        console.log(`📂 Emplacement : ${outputPath}`);
        console.log("");
        console.log("💡 PROCHAINES ÉTAPES RECOMMANDÉES :");
        console.log(
            "   1. Consulter le dossier 'graphiques' pour analyser visuellement les compétences"
        );
        console.log(
            "   2. Identifier les leviers visibles sur les graphiques (écoles au-dessus)"
        );
        console.log(
            "   3. Organiser des visites d'écoles LEVIERS pour valoriser les pratiques"
        );
        console.log(
            "   4. Prévoir des formations sur les compétences en VIGILANCE"
        );
        console.log(
            "   5. Créer des groupes de travail transversaux par compétence"
        );
        console.log(
            "   6. Utiliser les graphiques PDF lors des conseils d'école ou réunions pédagogiques"
        );
        console.log("");
        console.log("═".repeat(80));
    } catch (error) {
        console.error(
            "\n╔════════════════════════════════════════════════════════════╗"
        );
        console.error(
            "║ ❌ ERREUR                                                  ║"
        );
        console.error(
            "╚════════════════════════════════════════════════════════════╝\n"
        );
        console.error("Message:", error.message);
        console.error("\nStack trace:");
        console.error(error.stack);
        console.error("");
        process.exit(1);
    }
}

// Lancement du programme
main();
