import { IPSService } from "./services/ipsService.js";
import { ReferencesService } from "./services/referencesService.js";
import { OraceCSVService } from "./services/oraceCSVService.js"; // ⭐ CHANGEMENT
import { AnalyseService } from "./services/analyseService.js";
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
    console.log("║   ANALYSE IPS - ÉVALUATIONS NATIONALES REPÈRES 2025      ║");
    console.log(
        "║              ÉCOLES PUBLIQUES UNIQUEMENT                  ║"
    );
    console.log(
        "║              VERSION CSV                                  ║" // ⭐ NOUVEAU
    );
    console.log(
        "╚════════════════════════════════════════════════════════════╝\n"
    );

    const startTime = Date.now();

    try {
        // ═══════════════════════════════════════════════════════════
        // ÉTAPE 1: Chargement des données ORACE (CSV)
        // ═══════════════════════════════════════════════════════════
        console.log("📂 ÉTAPE 1/7: Chargement des données ORACE (CSV)"); // ⭐ CHANGEMENT
        console.log("─".repeat(60));

        const oraceService = new OraceCSVService(path.join(__dirname, "data")); // ⭐ CHANGEMENT
        const ecoles = oraceService.loadEcoles();

        if (ecoles.length === 0) {
            throw new Error(
                "❌ Aucune école trouvée dans les CSV. Vérifiez les fichiers CIRCO_ecoles_*.csv"
            );
        }

        // Afficher le résumé de la structure
        oraceService.afficherResume();

        // ⭐ DEBUG - Afficher la liste des écoles et détails d'une école test
        console.log("🔍 MODE DEBUG: Vérification des données");
        console.log("─".repeat(60));

        // Lister toutes les écoles
        oraceService.listerEcoles();

        // Afficher le détail de l'école test (UAI fourni)
        const UAI_TEST = "0070116N"; // ⚠️ Modifier selon ton école test
        console.log(`\n🎯 Vérification détaillée de l'école ${UAI_TEST}:`);
        oraceService.afficherDetailEcole(UAI_TEST);

        // Pause pour laisser le temps de lire
        console.log("⏸️  Appuyez sur Entrée pour continuer...");
        await new Promise((resolve) => {
            process.stdin.once("data", () => resolve());
        });
        console.log("");

        // ═══════════════════════════════════════════════════════════
        // ÉTAPE 2: Récupération des IPS via API
        // ═══════════════════════════════════════════════════════════
        console.log("🌐 ÉTAPE 2/7: Récupération des IPS via API data.gouv");
        console.log("─".repeat(60));

        const ipsService = new IPSService();
        const uais = ecoles.map((e) => e.uai).filter((u) => u && u.length > 0);

        console.log(`   📋 ${uais.length} UAI à traiter`);
        console.log(`   📋 Exemples: ${uais.slice(0, 3).join(", ")}...\n`);

        const ipsData = await ipsService.getIPSBatch(uais);

        if (ipsData.length === 0) {
            throw new Error(
                "❌ Aucun IPS récupéré. Vérifiez la connexion API ou les UAI"
            );
        }

        console.log("");

        // ═══════════════════════════════════════════════════════════
        // ÉTAPE 3: Fusion des données + FILTRAGE ÉCOLES PUBLIQUES
        // ═══════════════════════════════════════════════════════════
        console.log("🔗 ÉTAPE 3/7: Fusion IPS + Résultats ORACE");
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

        console.log(`   ✓ ${ecolesWithIPSAll.length} écoles avec IPS valide`);

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
            `   🏫 ${ecolesWithIPS.length} écoles PUBLIQUES retenues pour l'analyse`
        );
        if (nbPrivees > 0) {
            console.log(
                `   🚫 ${nbPrivees} école(s) PRIVÉE(S) exclue(s) de l'analyse`
            );

            console.log("\n   📋 Écoles privées exclues:");
            ecolesPrivees.forEach((e) => {
                console.log(`      - ${e.nom} (${e.uai}) - ${e.secteur}`);
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
            `   📊 IPS (écoles publiques) - min: ${ipsMin} | max: ${ipsMax} | moyen: ${ipsMoyen}`
        );

        // Écoles sans IPS
        const ecolesManquantes = ecoles.length - ecolesWithIPSAll.length;
        if (ecolesManquantes > 0) {
            console.log(
                `   ⚠️  ${ecolesManquantes} école(s) sans IPS (UAI introuvable ou invalide)`
            );
            const manquantes = ecoles.filter(
                (e) => !ecolesWithIPSAll.find((ew) => ew.uai === e.uai)
            );
            manquantes.forEach((e) => {
                console.log(`      - ${e.nom} (${e.uai})`);
            });
        }
        console.log("");

        // ═══════════════════════════════════════════════════════════
        // ÉTAPE 4: Chargement des références nationales DEPP
        // ═══════════════════════════════════════════════════════════
        console.log(
            "📚 ÉTAPE 4/7: Chargement des références DEPP (France/Académie)"
        );
        console.log("─".repeat(60));

        const referencesService = new ReferencesService(
            path.join(__dirname, "data")
        );

        // ⚠️ IMPORTANT: Adapter le nom de ton académie ici
        const ACADEMIE = "GRENOBLE"; // Modifier selon ton académie
        console.log(`   🎯 Académie de référence: ${ACADEMIE}`);
        console.log(`   🏫 Analyse limitée aux écoles PUBLIQUES uniquement\n`);

        referencesService.loadAllReferences(ACADEMIE);
        console.log("");

        // ═══════════════════════════════════════════════════════════
        // ÉTAPE 5: Calcul des régressions et analyses
        // ═══════════════════════════════════════════════════════════
        console.log(
            "🔬 ÉTAPE 5/7: Analyse IPS et catégorisation (écoles publiques)"
        );
        console.log("─".repeat(60));

        const analyseService = new AnalyseService(referencesService);

        // Calculer les régressions IPS de la circonscription (écoles publiques)
        console.log("   🧮 Calcul des régressions IPS...");
        analyseService.calculateRegressions(ecolesWithIPS);

        // Analyser toutes les écoles sur toutes les compétences
        console.log("   📊 Analyse de toutes les compétences...");
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
        console.log("📊 ÉTAPE 6/7: Génération des vues synthétiques");
        console.log("─".repeat(60));

        const vue = analyseService.genererVueSynthetique(analyses);

        console.log(
            `   ✓ ${vue.ecoles_leviers.length} écoles dans la catégorie LEVIERS`
        );
        console.log(
            `   ✓ ${vue.ecoles_vigilance.length} écoles dans la catégorie VIGILANCE`
        );
        console.log("");

        // Générer les synthèses
        const syntheseEcoles = analyseService.genererSyntheseParEcole(analyses);
        const syntheseNiveauMatiere =
            analyseService.genererSyntheseParNiveauMatiere(analyses);

        // ═══════════════════════════════════════════════════════════
        // ÉTAPE 7: Export Excel
        // ═══════════════════════════════════════════════════════════
        console.log("💾 ÉTAPE 7/7: Génération du fichier Excel");
        console.log("─".repeat(60));

        const outputDir = path.join(__dirname, "output");
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const wb = XLSX.utils.book_new();

        // ───────────────────────────────────────────────────────────
        // Onglet 1: README
        // ───────────────────────────────────────────────────────────
        console.log("   📄 Génération onglet: README");

        const ecolesPriveesInfo = ecolesPrivees.map((e) => [
            e.nom,
            e.uai,
            e.secteur,
        ]);

        const readme = [
            ["ANALYSE IPS - ÉVALUATIONS NATIONALES REPÈRES 2025"],
            ["Source: CSV exports ORACE"], // ⭐ CHANGEMENT
            ["Date:", new Date().toLocaleDateString("fr-FR")],
            ["Académie:", ACADEMIE],
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
        console.log("   📄 Génération onglet: Synthèse par école");
        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.json_to_sheet(syntheseEcoles),
            "🏫 Synthèse par école"
        );

        // ───────────────────────────────────────────────────────────
        // Onglet 3: Synthèse par niveau/matière
        // ───────────────────────────────────────────────────────────
        console.log("   📄 Génération onglet: Synthèse Niveau-Matière");
        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.json_to_sheet(syntheseNiveauMatiere),
            "📚 Synthèse Niveau-Matière"
        );

        // ───────────────────────────────────────────────────────────
        // Onglet 4: Analyse détaillée
        // ───────────────────────────────────────────────────────────
        console.log("   📄 Génération onglet: Analyse détaillée");
        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.json_to_sheet(analyses),
            "📊 Analyse détaillée"
        );

        // ───────────────────────────────────────────────────────────
        // Onglet 5: Écoles LEVIERS
        // ───────────────────────────────────────────────────────────
        console.log("   📄 Génération onglet: LEVIERS");
        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.json_to_sheet(vue.ecoles_leviers),
            "🟢 LEVIERS"
        );

        // ───────────────────────────────────────────────────────────
        // Onglet 6: Écoles VIGILANCE
        // ───────────────────────────────────────────────────────────
        console.log("   📄 Génération onglet: VIGILANCE");
        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.json_to_sheet(vue.ecoles_vigilance),
            "🔴 VIGILANCE"
        );

        // ───────────────────────────────────────────────────────────
        // Onglet 7: TOP Écoles à accompagner (profil global)
        // ───────────────────────────────────────────────────────────
        console.log("   📄 Génération onglet: TOP Accompagnement");
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
        console.log("   📄 Génération onglet: TOP Leviers");
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
        const outputPath = path.join(
            outputDir,
            `analyse_ips_publiques_csv_${timestamp}.xlsx` // ⭐ CHANGEMENT nom
        );

        XLSX.writeFile(wb, outputPath);
        console.log(`\n   ✓ Fichier généré: ${outputPath}`);
        console.log("");

        // ═══════════════════════════════════════════════════════════
        // Affichage du résumé final
        // ═══════════════════════════════════════════════════════════
        console.log("═".repeat(60));
        console.log("✅ ANALYSE TERMINÉE AVEC SUCCÈS (ÉCOLES PUBLIQUES - CSV)"); // ⭐ CHANGEMENT
        console.log("═".repeat(60));
        console.log("");

        // TOP 5 Écoles LEVIERS
        console.log("🏆 TOP 5 ÉCOLES PUBLIQUES LEVIERS:");
        console.log("─".repeat(60));
        topLeviers.slice(0, 5).forEach((e, i) => {
            console.log(`   ${i + 1}. ${e.ecole}`);
            console.log(
                `      IPS: ${e.ips} (${e.categorie_ips}) | Leviers: ${e.nb_leviers}/${e.nb_total} (${e.taux_leviers})`
            );
            if (e.competences_leviers_str) {
                console.log(
                    `      Exemples: ${e.competences_leviers_str.substring(
                        0,
                        80
                    )}...`
                );
            }
            console.log("");
        });

        // TOP 5 Écoles À ACCOMPAGNER
        console.log("⚠️  TOP 5 ÉCOLES PUBLIQUES À ACCOMPAGNER:");
        console.log("─".repeat(60));
        topAccompagnement.slice(0, 5).forEach((e, i) => {
            console.log(`   ${i + 1}. ${e.ecole}`);
            console.log(
                `      IPS: ${e.ips} (${e.categorie_ips}) | Vigilance: ${e.nb_vigilance}/${e.nb_total} (${e.taux_vigilance})`
            );
            console.log(`      Profil: ${e.profil_global}`);
            if (e.competences_vigilance_str) {
                console.log(
                    `      Domaines: ${e.competences_vigilance_str.substring(
                        0,
                        80
                    )}...`
                );
            }
            console.log("");
        });

        // Statistiques par niveau/matière
        console.log("📚 SYNTHÈSE PAR NIVEAU ET MATIÈRE (écoles publiques):");
        console.log("─".repeat(60));
        syntheseNiveauMatiere.forEach((nm) => {
            const vigilanceFlag =
                parseFloat(nm.taux_vigilance) > 30 ? " ⚠️" : "";
            console.log(
                `   ${nm.niveau} ${nm.matiere}: ${nm.taux_vigilance} vigilance | ${nm.taux_leviers} leviers${vigilanceFlag}`
            );
        });
        console.log("");

        // Temps d'exécution
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`⏱️  Durée totale: ${duration}s`);
        console.log("");
        console.log(
            "📎 Fichier à transmettre à l'IEN: " + path.basename(outputPath)
        );
        console.log("");
    } catch (error) {
        console.error(
            "\n╔════════════════════════════════════════════════════════════╗"
        );
        console.error(
            "║                        ❌ ERREUR                           ║"
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
