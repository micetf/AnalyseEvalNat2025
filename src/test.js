import { OraceCSVService } from "./services/oraceCSVService.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Script de test pour OraceCSVService
 *
 * Usage: node test.js [UAI_ECOLE]
 */
async function test() {
    console.log(
        "\n╔════════════════════════════════════════════════════════════╗"
    );
    console.log(
        "║           TEST ORACECSV SERVICE                           ║"
    );
    console.log(
        "╚════════════════════════════════════════════════════════════╝\n"
    );

    try {
        // 1. Initialisation du service
        console.log("🔧 Initialisation du service...");
        const service = new OraceCSVService(path.join(__dirname, "data"));
        console.log("   ✓ Service initialisé\n");

        // 2. Chargement des données
        console.log("📂 Chargement des données CSV...");
        console.log("─".repeat(60));
        const ecoles = service.loadEcoles();

        if (ecoles.length === 0) {
            console.error("\n❌ ERREUR: Aucune école chargée");
            console.error(
                "   Vérifiez que les fichiers CSV existent dans data/orace/csv/"
            );
            process.exit(1);
        }

        // 3. Affichage du résumé
        service.afficherResume();

        // 4. Liste des écoles
        service.listerEcoles();

        // 5. Test sur une école spécifique
        const uaiTest = process.argv[2] || ecoles[0].uai;
        console.log(`\n🔍 Test détaillé sur l'école: ${uaiTest}`);
        console.log("─".repeat(60));
        service.afficherDetailEcole(uaiTest);

        // 6. Validation des données
        console.log("✅ VALIDATION DES DONNÉES:");
        console.log("─".repeat(60));

        const ecoleTest = ecoles.find((e) => e.uai === uaiTest);
        if (!ecoleTest) {
            console.error(`   ❌ École ${uaiTest} non trouvée`);
            process.exit(1);
        }

        // Vérifier la structure des résultats
        const competences = Object.keys(ecoleTest.resultats);
        console.log(`   ✓ École chargée: ${ecoleTest.nom}`);
        console.log(`   ✓ UAI: ${ecoleTest.uai}`);
        console.log(`   ✓ Nombre de résultats: ${competences.length}`);

        // Vérifier les niveaux/matières
        const niveauxMatieres = new Set();
        competences.forEach((comp) => {
            const parts = comp.split("_");
            if (parts.length >= 2) {
                niveauxMatieres.add(`${parts[0]}_${parts[1]}`);
            }
        });

        console.log(`   ✓ Niveaux/Matières détectés: ${niveauxMatieres.size}`);
        console.log(`      ${Array.from(niveauxMatieres).join(", ")}`);

        // Vérifier les valeurs
        let valeursValides = 0;
        let valeursInvalides = 0;
        competences.forEach((comp) => {
            const val = ecoleTest.resultats[comp];
            if (val !== null && !isNaN(val) && val >= 0 && val <= 100) {
                valeursValides++;
            } else {
                valeursInvalides++;
            }
        });

        console.log(`   ✓ Valeurs valides (0-100%): ${valeursValides}`);
        if (valeursInvalides > 0) {
            console.log(`   ⚠️  Valeurs invalides: ${valeursInvalides}`);
        }

        // Exemple de résultats
        console.log(`\n   📊 Exemples de résultats:`);
        competences.slice(0, 3).forEach((comp) => {
            const parts = comp.split("_");
            const competenceNom = parts.slice(2).join(" ").replace(/_/g, " ");
            const valeur = ecoleTest.resultats[comp];
            console.log(
                `      - ${parts[0]} ${parts[1]}: ${competenceNom.substring(
                    0,
                    40
                )}... = ${valeur.toFixed(1)}%`
            );
        });

        // 7. Statistiques globales
        console.log("\n📊 STATISTIQUES GLOBALES:");
        console.log("─".repeat(60));

        const competencesParNM = service.getCompetencesParNiveauMatiere();
        const totalCompetences = Object.values(competencesParNM).reduce(
            (sum, arr) => sum + arr.length,
            0
        );

        console.log(`   ✓ Écoles chargées: ${ecoles.length}`);
        console.log(`   ✓ Compétences uniques: ${totalCompetences}`);
        console.log(
            `   ✓ Niveaux/Matières: ${Object.keys(competencesParNM).length}`
        );

        // Calcul du nombre total de résultats
        const totalResultats = ecoles.reduce(
            (sum, e) => sum + Object.keys(e.resultats).length,
            0
        );
        console.log(`   ✓ Total résultats chargés: ${totalResultats}`);

        // Moyenne de résultats par école
        const moyenneResultats = (totalResultats / ecoles.length).toFixed(1);
        console.log(`   ✓ Moyenne résultats/école: ${moyenneResultats}`);

        // 8. Test d'intégrité
        console.log("\n🔬 TEST D'INTÉGRITÉ:");
        console.log("─".repeat(60));

        let ecolesOK = 0;
        let ecolesWarning = 0;
        let ecolesError = 0;

        ecoles.forEach((e) => {
            const nbRes = Object.keys(e.resultats).length;
            if (nbRes === 0) {
                ecolesError++;
            } else if (nbRes < 20) {
                ecolesWarning++;
            } else {
                ecolesOK++;
            }
        });

        console.log(
            `   ✓ Écoles avec données complètes (20+ résultats): ${ecolesOK}`
        );
        if (ecolesWarning > 0) {
            console.log(
                `   ⚠️  Écoles avec peu de données (<20 résultats): ${ecolesWarning}`
            );
        }
        if (ecolesError > 0) {
            console.log(`   ❌ Écoles sans données: ${ecolesError}`);
        }

        // 9. Conclusion
        console.log("\n" + "═".repeat(60));
        if (ecolesError === 0 && valeursInvalides === 0) {
            console.log("✅ TEST RÉUSSI - Toutes les données sont valides");
        } else if (ecolesError === 0) {
            console.log(
                "⚠️  TEST RÉUSSI AVEC AVERTISSEMENTS - Vérifier les données"
            );
        } else {
            console.log(
                "❌ TEST ÉCHOUÉ - Certaines écoles n'ont pas de données"
            );
        }
        console.log("═".repeat(60));
        console.log("");

        // 10. Instructions pour la suite
        console.log("📋 PROCHAINES ÉTAPES:");
        console.log("─".repeat(60));
        console.log("   1. Vérifier les résultats ci-dessus");
        console.log("   2. Tester avec d'autres UAI: node test.js 0123456X");
        console.log("   3. Lancer l'analyse complète: npm run start:csv");
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

// Lancement du test
test();
