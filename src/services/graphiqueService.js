import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

/**
 * Service de génération de graphiques PDF
 * Crée un graphique pour chaque compétence avec :
 * - Régression linéaire IPS en abscisse
 * - Taux de satisfaisant en ordonnée
 * - Droite de régression
 * - Positions des écoles
 * - Catégorisation (LEVIER / CONFORME / VIGILANCE)
 */
export class GraphiqueService {
    constructor(outputDir = "./output") {
        this.outputDir = outputDir;
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Créer le dossier graphiques dès la construction
        const graphiquesDir = path.join(outputDir, "graphiques");
        if (!fs.existsSync(graphiquesDir)) {
            fs.mkdirSync(graphiquesDir, { recursive: true });
        }
    }

    /**
     * Génère tous les graphiques pour une liste de compétences
     * @param {Array} analyses - Résultats d'analyse avec écoles positionnées
     * @param {Object} regressions - Coefficients de régression par compétence
     * @param {number} totalEcoles - Nombre total d'écoles
     */
    async genererTousLesGraphiques(analyses, regressions, totalEcoles) {
        console.log("\n📈 Génération des graphiques PDF...");
        console.log("─".repeat(60));

        // Grouper les analyses par compétence
        const parCompetence = {};
        analyses.forEach((analyse) => {
            const cle = `${analyse.niveau}_${analyse.matiere}_${analyse.competence}`;
            if (!parCompetence[cle]) {
                parCompetence[cle] = {
                    niveau: analyse.niveau,
                    matiere: analyse.matiere,
                    competence: analyse.competence,
                    analyses: [],
                };
            }
            parCompetence[cle].analyses.push(analyse);
        });

        const competences = Object.values(parCompetence);
        console.log(` 📊 ${competences.length} compétences à graphiquer`);
        console.log("");

        let generees = 0;
        let erreurs = 0;

        // Générer les graphiques séquentiellement
        for (let idx = 0; idx < competences.length; idx++) {
            const comp = competences[idx];
            try {
                // Récupérer la clé complète depuis la première analyse
                const premierAnalyse = comp.analyses[0];
                const cleComplete = premierAnalyse?.competence_complete;
                const regression = cleComplete
                    ? regressions[cleComplete]
                    : null;

                if (
                    regression &&
                    regression.a !== undefined &&
                    regression.b !== undefined
                ) {
                    await this.genererGraphique(
                        comp,
                        regression,
                        idx + 1,
                        competences.length
                    );
                    generees++;

                    // Afficher la progression tous les 10
                    if ((idx + 1) % 10 === 0) {
                        console.log(
                            ` ✓ ${idx + 1}/${
                                competences.length
                            } graphiques générés`
                        );
                    }
                } else {
                    console.log(
                        ` ⚠️  Régression manquante pour ${comp.niveau} ${comp.matiere} ${comp.competence}`
                    );
                    if (!cleComplete) {
                        console.log(`    → Pas de competence_complete trouvée`);
                    } else {
                        console.log(`    → Clé cherchée: ${cleComplete}`);
                    }
                    erreurs++;
                }
            } catch (err) {
                console.error(
                    ` ❌ Erreur sur ${comp.niveau} ${comp.matiere} ${comp.competence}: ${err.message}`
                );
                erreurs++;
            }
        }

        console.log(`\n ✅ ${generees} graphiques générés avec succès`);
        if (erreurs > 0) {
            console.log(` ⚠️ ${erreurs} erreur(s) lors de la génération`);
        }

        return generees;
    }

    /**
     * Génère un graphique pour une compétence donnée
     * @param {Object} competence - {niveau, matiere, competence, analyses[]}
     * @param {Object} regression - {a, b, r2}
     * @param {number} numeroOrdre - Position dans la liste
     * @param {number} total - Total des compétences
     */
    genererGraphique(competence, regression, numeroOrdre, total) {
        return new Promise((resolve, reject) => {
            try {
                const {
                    niveau,
                    matiere,
                    competence: comp,
                    analyses,
                } = competence;
                const { a, b, r2 } = regression;

                // Configuration du graphique
                const MARGIN = 60;
                const GRAPH_WIDTH = 500;
                const GRAPH_HEIGHT = 350;
                const PAGE_WIDTH = 700;
                const PAGE_HEIGHT = 900;

                // Déterminer les limites des axes
                const ipsValues = analyses
                    .map((a) => a.ips)
                    .filter((v) => !isNaN(v));
                const tauxValues = analyses
                    .map((a) => a.taux_satisfaisant)
                    .filter((v) => !isNaN(v));

                if (ipsValues.length === 0 || tauxValues.length === 0) {
                    return reject(new Error("Aucune donnée valide"));
                }

                const minIPS = Math.max(
                    0,
                    Math.floor(Math.min(...ipsValues) / 10) * 10
                );
                const maxIPS = Math.ceil(Math.max(...ipsValues) / 10) * 10 + 10;
                const minTaux = Math.max(
                    0,
                    Math.floor(Math.min(...tauxValues) / 10) * 10 - 10
                );
                const maxTaux = Math.min(
                    100,
                    Math.ceil(Math.max(...tauxValues) / 10) * 10 + 10
                );

                // Créer le document PDF
                const doc = new PDFDocument({
                    size: "A4",
                    margin: 30,
                });

                // Fichier de sortie - CORRECTION ICI
                const filename = `graphique_${niveau}_${matiere}_${this.sanitizeFilename(
                    comp
                )}_${numeroOrdre.toString().padStart(4, "0")}.pdf`;
                const filepath = path.join(
                    this.outputDir,
                    "graphiques",
                    filename
                );

                const stream = fs.createWriteStream(filepath);
                doc.pipe(stream);

                // ═══════════════════════════════════════════════════════════
                // EN-TÊTE
                // ═══════════════════════════════════════════════════════════
                doc.fontSize(12).font("Helvetica-Bold");
                doc.text(`${niveau} - ${matiere}`, 50, 30);

                doc.fontSize(16).font("Helvetica-Bold");
                doc.text(comp.replace(/_/g, " "), 50, 50, { width: 500 });

                doc.fontSize(10).font("Helvetica").fillColor("#666666");
                doc.text(
                    `Compétence ${numeroOrdre}/${total} | Analysé le ${new Date().toLocaleDateString(
                        "fr-FR"
                    )}`,
                    50,
                    75
                );

                // Numéro de page
                doc.fontSize(9).fillColor("#999999");
                doc.text(`${numeroOrdre}/${total}`, PAGE_WIDTH - 80, 30);

                // ═══════════════════════════════════════════════════════════
                // STATISTIQUES
                // ═══════════════════════════════════════════════════════════
                const statsY = 95;

                doc.fontSize(10).font("Helvetica-Bold").fillColor("#000000");
                doc.text("STATISTIQUES", 50, statsY);

                const statLines = [
                    `Nombre d'écoles: ${analyses.length}`,
                    `R² de la régression: ${r2.toFixed(
                        3
                    )} (variance expliquée par l'IPS: ${(r2 * 100).toFixed(
                        1
                    )}%)`,
                    `Équation: y = ${a.toFixed(3)}x + ${b.toFixed(1)}`,
                    `Plage IPS: ${minIPS} - ${maxIPS}`,
                    `Taux moyen: ${(
                        tauxValues.reduce((a, b) => a + b) / tauxValues.length
                    ).toFixed(1)}%`,
                ];

                let currentY = statsY + 20;
                doc.fontSize(9).font("Helvetica").fillColor("#333333");
                statLines.forEach((line) => {
                    doc.text(line, 50, currentY);
                    currentY += 15;
                });

                // ═══════════════════════════════════════════════════════════
                // ZONE DE DESSIN
                // ═══════════════════════════════════════════════════════════
                const graphTop = 200;
                const graphLeft = MARGIN;

                // Fond du graphique
                doc.fillColor("#f9f9f9")
                    .rect(graphLeft, graphTop, GRAPH_WIDTH, GRAPH_HEIGHT)
                    .fill();

                // Grille
                this.dessinerGrille(
                    doc,
                    graphLeft,
                    graphTop,
                    GRAPH_WIDTH,
                    GRAPH_HEIGHT,
                    minIPS,
                    maxIPS,
                    minTaux,
                    maxTaux
                );

                // Zones de catégorisation (LEVIER / CONFORME / VIGILANCE)
                this.dessinerZonesCategorisation(
                    doc,
                    graphLeft,
                    graphTop,
                    GRAPH_WIDTH,
                    GRAPH_HEIGHT,
                    minIPS,
                    maxIPS,
                    minTaux,
                    maxTaux,
                    a,
                    b
                );

                // Droite de régression
                this.dessinerRegression(
                    doc,
                    graphLeft,
                    graphTop,
                    GRAPH_WIDTH,
                    GRAPH_HEIGHT,
                    minIPS,
                    maxIPS,
                    minTaux,
                    maxTaux,
                    a,
                    b
                );

                // Points des écoles
                this.dessinerEcoles(
                    doc,
                    graphLeft,
                    graphTop,
                    GRAPH_WIDTH,
                    GRAPH_HEIGHT,
                    minIPS,
                    maxIPS,
                    minTaux,
                    maxTaux,
                    analyses
                );

                // Axes et labels
                this.dessinerAxes(
                    doc,
                    graphLeft,
                    graphTop,
                    GRAPH_WIDTH,
                    GRAPH_HEIGHT,
                    minIPS,
                    maxIPS,
                    minTaux,
                    maxTaux
                );

                // ═══════════════════════════════════════════════════════════
                // LÉGENDE
                // ═══════════════════════════════════════════════════════════
                const legendeY = graphTop + GRAPH_HEIGHT + 30;

                const legende = [
                    { couleur: "#22c55e", label: "🟢 LEVIER (écart > +5 pts)" },
                    { couleur: "#eab308", label: "🟡 CONFORME (-5 à +5 pts)" },
                    {
                        couleur: "#ef4444",
                        label: "🔴 VIGILANCE (écart < -5 pts)",
                    },
                ];

                doc.fontSize(9).font("Helvetica-Bold").fillColor("#000000");
                doc.text("LÉGENDE", 50, legendeY);

                let legendeCurrentY = legendeY + 15;
                legende.forEach((item) => {
                    // Carré de couleur
                    doc.fillColor(item.couleur)
                        .rect(50, legendeCurrentY - 3, 10, 10)
                        .fill();
                    // Label
                    doc.fontSize(9).font("Helvetica").fillColor("#333333");
                    doc.text(item.label, 70, legendeCurrentY);
                    legendeCurrentY += 15;
                });

                // ═══════════════════════════════════════════════════════════
                // INTERPRÉTATION
                // ═══════════════════════════════════════════════════════════
                const interpreY = legendeY + 70;

                doc.fontSize(10).font("Helvetica-Bold").fillColor("#000000");
                doc.text("INTERPRÉTATION", 50, interpreY);

                doc.fontSize(9).font("Helvetica").fillColor("#333333");
                const interpretationText = `La droite de régression montre le taux de "satisfaisant" attendu selon l'IPS de l'école. Les écoles situées au-dessus de la droite surperforment (LEVIERS). Les écoles situées au-dessous de la droite sous-performent (VIGILANCE). L'écart vertical par rapport à la droite quantifie la différence.`;
                doc.text(interpretationText, 50, interpreY + 20, {
                    width: 600,
                });

                // Finaliser le PDF
                doc.end();

                stream.on("finish", () => resolve(filepath));
                stream.on("error", (err) => reject(err));
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Dessine la grille du graphique
     */
    dessinerGrille(doc, left, top, width, height, minX, maxX, minY, maxY) {
        doc.strokeColor("#e5e7eb").lineWidth(0.5);

        // Lignes horizontales (Y)
        const stepY = Math.ceil((maxY - minY) / 5);
        for (let y = minY; y <= maxY; y += stepY) {
            const posY = top + height - ((y - minY) / (maxY - minY)) * height;
            doc.moveTo(left, posY)
                .lineTo(left + width, posY)
                .stroke();
        }

        // Lignes verticales (X)
        const stepX = Math.ceil((maxX - minX) / 5);
        for (let x = minX; x <= maxX; x += stepX) {
            const posX = left + ((x - minX) / (maxX - minX)) * width;
            doc.moveTo(posX, top)
                .lineTo(posX, top + height)
                .stroke();
        }
    }

    /**
     * Dessine la droite de régression
     */
    dessinerRegression(
        doc,
        left,
        top,
        width,
        height,
        minX,
        maxX,
        minY,
        maxY,
        a,
        b
    ) {
        doc.strokeColor("#1f2937").lineWidth(2);

        // Deux points pour tracer la droite
        const x1 = minX;
        const y1 = a * x1 + b;
        const x2 = maxX;
        const y2 = a * x2 + b;

        // Cliper si nécessaire
        const y1Clipped = Math.max(minY, Math.min(maxY, y1));
        const y2Clipped = Math.max(minY, Math.min(maxY, y2));

        const posX1 = left + ((x1 - minX) / (maxX - minX)) * width;
        const posY1 =
            top + height - ((y1Clipped - minY) / (maxY - minY)) * height;

        const posX2 = left + ((x2 - minX) / (maxX - minX)) * width;
        const posY2 =
            top + height - ((y2Clipped - minY) / (maxY - minY)) * height;

        doc.moveTo(posX1, posY1).lineTo(posX2, posY2).stroke();
    }

    /**
     * Dessine les zones de catégorisation (fond coloré)
     */
    dessinerZonesCategorisation(
        doc,
        left,
        top,
        width,
        height,
        minX,
        maxX,
        minY,
        maxY,
        a,
        b
    ) {
        const SEUIL = 5;

        // Zone LEVIER (au-dessus de y = ax+b+5)
        doc.save();
        doc.fillColor("#22c55e").fillOpacity(0.1);

        const nbPoints = 50;
        const points = [];

        for (let i = 0; i <= nbPoints; i++) {
            const x = minX + (i / nbPoints) * (maxX - minX);
            const y = Math.min(maxY, a * x + b + SEUIL);
            const posX = left + ((x - minX) / (maxX - minX)) * width;
            const posY = top + height - ((y - minY) / (maxY - minY)) * height;
            points.push([posX, posY]);
        }

        // Compléter le polygone
        points.push([left + width, top]);
        points.push([left, top]);

        // Dessiner le polygone
        doc.moveTo(points[0][0], points[0][1]);
        for (let i = 1; i < points.length; i++) {
            doc.lineTo(points[i][0], points[i][1]);
        }
        doc.closePath().fill();
        doc.restore();

        // Zone VIGILANCE (au-dessous de y = ax+b-5)
        doc.save();
        doc.fillColor("#ef4444").fillOpacity(0.1);

        const pointsVig = [];

        for (let i = 0; i <= nbPoints; i++) {
            const x = minX + (i / nbPoints) * (maxX - minX);
            const y = Math.max(minY, a * x + b - SEUIL);
            const posX = left + ((x - minX) / (maxX - minX)) * width;
            const posY = top + height - ((y - minY) / (maxY - minY)) * height;
            pointsVig.push([posX, posY]);
        }

        // Compléter le polygone
        pointsVig.push([left + width, top + height]);
        pointsVig.push([left, top + height]);

        // Dessiner le polygone
        doc.moveTo(pointsVig[0][0], pointsVig[0][1]);
        for (let i = 1; i < pointsVig.length; i++) {
            doc.lineTo(pointsVig[i][0], pointsVig[i][1]);
        }
        doc.closePath().fill();
        doc.restore();
    }

    /**
     * Dessine les points des écoles
     */
    dessinerEcoles(
        doc,
        left,
        top,
        width,
        height,
        minX,
        maxX,
        minY,
        maxY,
        analyses
    ) {
        analyses.forEach((analyse) => {
            const { ips, taux_satisfaisant, categorie_code } = analyse;

            if (isNaN(ips) || isNaN(taux_satisfaisant)) return;

            const posX = left + ((ips - minX) / (maxX - minX)) * width;
            const posY =
                top +
                height -
                ((taux_satisfaisant - minY) / (maxY - minY)) * height;

            // Couleur selon la catégorie
            let couleur = "#eab308"; // CONFORME par défaut
            if (categorie_code === "LEVIER") {
                couleur = "#22c55e";
            } else if (categorie_code === "VIGILANCE") {
                couleur = "#ef4444";
            }

            // Dessiner le point
            doc.save();
            doc.fillColor(couleur).strokeColor("#ffffff").lineWidth(1.5);
            doc.circle(posX, posY, 4).fill();
            doc.circle(posX, posY, 4).stroke();
            doc.restore();
        });
    }

    /**
     * Dessine les axes et les labels
     */
    dessinerAxes(doc, left, top, width, height, minX, maxX, minY, maxY) {
        doc.strokeColor("#000000").lineWidth(1);

        // Axe X
        doc.moveTo(left, top + height)
            .lineTo(left + width, top + height)
            .stroke();

        // Axe Y
        doc.moveTo(left, top)
            .lineTo(left, top + height)
            .stroke();

        // Labels de l'axe X (IPS)
        const stepX = Math.ceil((maxX - minX) / 5);
        doc.fontSize(8).font("Helvetica").fillColor("#333333");
        for (let x = minX; x <= maxX; x += stepX) {
            const posX = left + ((x - minX) / (maxX - minX)) * width;
            doc.text(x.toString(), posX - 10, top + height + 10, {
                width: 20,
                align: "center",
            });
        }

        // Label de l'axe X
        doc.fontSize(10).font("Helvetica-Bold");
        doc.text(
            "IPS (Indice de Position Sociale)",
            left + width / 2 - 80,
            top + height + 35
        );

        // Labels de l'axe Y (Taux)
        const stepY = Math.ceil((maxY - minY) / 5);
        doc.fontSize(8).font("Helvetica").fillColor("#333333");
        for (let y = minY; y <= maxY; y += stepY) {
            const posY = top + height - ((y - minY) / (maxY - minY)) * height;
            doc.text(`${y}%`, left - 35, posY - 4, {
                width: 30,
                align: "right",
            });
        }

        // Label de l'axe Y (vertical)
        doc.fontSize(10).font("Helvetica-Bold").fillColor("#000000");
        doc.save()
            .translate(left - 50, top + height / 2)
            .rotate(-90)
            .text("Taux de satisfaisant (%)", 0, 0)
            .restore();
    }

    /**
     * Nettoie un nom de fichier
     */
    sanitizeFilename(str) {
        return str
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "_")
            .replace(/_+/g, "_")
            .substring(0, 50);
    }
}
