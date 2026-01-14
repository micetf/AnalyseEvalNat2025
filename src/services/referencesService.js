import XLSX from "xlsx";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Service de chargement des références nationales DEPP
 * Charge les fichiers Excel contenant les moyennes France et Académie
 *
 * @class ReferencesService
 */
export class ReferencesService {
    constructor(dataPath) {
        this.dataPath = dataPath;
        this.references = {};
    }

    /**
     * Charge les références pour un niveau et une matière donnés
     * @param {string} niveau - CP, CE1, CE2, CM1, CM2
     * @param {string} matiere - francais, mathematiques
     * @param {string} academie - Nom de l'académie (ex: "GRENOBLE")
     * @returns {Object} Références chargées
     */
    loadReferences(niveau, matiere, academie = "GRENOBLE") {
        // Chemin direct du fichier
        const filepath = path.join(
            this.dataPath,
            "references_nationales",
            `${niveau.toLowerCase()}-${matiere}-2025.xlsx`
        );

        try {
            // Vérifier l'existence du fichier (sans glob, plus simple)
            if (!fs.existsSync(filepath)) {
                console.warn(`⚠️  Fichier non trouvé: ${niveau}-${matiere}`);
                console.warn(`   Chemin recherché: ${filepath}`);
                return {};
            }

            // Charger le fichier Excel
            const workbook = XLSX.readFile(filepath);
            const references = {};

            // Pour chaque compétence (sheet)
            workbook.SheetNames.forEach((competence) => {
                const sheet = XLSX.utils.sheet_to_json(
                    workbook.Sheets[competence]
                );

                // Chercher les lignes France et Académie
                const france = sheet.find((row) => row.Modalite === "FRANCE");
                const acad = sheet.find((row) => row.Modalite === academie);

                if (france && acad) {
                    references[competence] = {
                        france: parseFloat(
                            france["Groupe au-dessus du seuil 2"]
                        ),
                        academie: parseFloat(
                            acad["Groupe au-dessus du seuil 2"]
                        ),
                    };
                }
            });

            // Stocker les références
            this.references[`${niveau}_${matiere}`] = references;

            console.log(
                `   ✓ ${niveau} ${matiere}: ${
                    Object.keys(references).length
                } compétences`
            );

            return references;
        } catch (error) {
            console.error(
                `❌ Erreur chargement ${niveau}-${matiere}:`,
                error.message
            );
            return {};
        }
    }

    /**
     * Charge toutes les références (tous niveaux et matières)
     * @param {string} academie - Nom de l'académie
     */
    loadAllReferences(academie = "GRENOBLE") {
        const niveaux = ["CP", "CE1", "CE2", "CM1", "CM2"];
        const matieres = ["francais", "mathematiques"];

        console.log(
            `   📚 Chargement des références DEPP pour ${academie}...\n`
        );

        for (const niveau of niveaux) {
            for (const matiere of matieres) {
                this.loadReferences(niveau, matiere, academie);
            }
        }
    }

    /**
     * Récupère la référence pour une compétence spécifique
     * @param {string} niveau - Niveau scolaire
     * @param {string} matiere - Matière
     * @param {string} competence - Nom de la compétence
     * @returns {Object|null} Référence France/Académie ou null
     */
    getReference(niveau, matiere, competence) {
        const key = `${niveau}_${matiere}`;
        return this.references[key]?.[competence] || null;
    }

    /**
     * Récupère toutes les compétences chargées
     * @returns {Array} Liste des noms de compétences
     */
    getAllCompetences() {
        const competences = new Set();
        Object.values(this.references).forEach((ref) => {
            Object.keys(ref).forEach((comp) => competences.add(comp));
        });
        return Array.from(competences);
    }

    /**
     * Affiche un résumé des références chargées
     */
    afficherResume() {
        console.log("\n📊 RÉSUMÉ DES RÉFÉRENCES CHARGÉES:\n");

        const niveaux = ["CP", "CE1", "CE2", "CM1", "CM2"];
        const matieres = ["francais", "mathematiques"];

        niveaux.forEach((niveau) => {
            matieres.forEach((matiere) => {
                const key = `${niveau}_${matiere}`;
                const refs = this.references[key];

                if (refs) {
                    const nbComp = Object.keys(refs).length;
                    const matiereLabel =
                        matiere === "francais" ? "Français" : "Maths";
                    console.log(
                        `   ${niveau} ${matiereLabel}: ${nbComp} compétences`
                    );
                }
            });
        });

        const totalComp = this.getAllCompetences().length;
        console.log(`\n   Total: ${totalComp} compétences uniques\n`);
    }
}
