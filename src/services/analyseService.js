import * as ss from "simple-statistics";

export class AnalyseService {
    constructor(references) {
        this.references = references;
        this.regressions = {};
    }

    /**
     * Calcule les régressions linéaires IPS pour chaque compétence
     * @param {Array} ecolesWithIPS - Tableau d'écoles avec IPS
     */
    calculateRegressions(ecolesWithIPS) {
        console.log(" 🔍 Analyse des compétences disponibles...");
        const competencesData = {};

        // Regrouper les données par compétence
        ecolesWithIPS.forEach((ecole) => {
            if (!ecole.ips) return;

            Object.keys(ecole.resultats).forEach((competence) => {
                if (!competencesData[competence]) {
                    competencesData[competence] = [];
                }
                competencesData[competence].push([
                    ecole.ips,
                    ecole.resultats[competence],
                ]);
            });
        });

        // Calculer la régression pour chaque compétence
        let regressionsCalculees = 0;
        Object.keys(competencesData).forEach((competence) => {
            const data = competencesData[competence].filter(
                ([ips, resultat]) =>
                    ips && resultat && !isNaN(ips) && !isNaN(resultat)
            );

            // Minimum 4 points pour une régression fiable
            if (data.length >= 4) {
                try {
                    const regression = ss.linearRegression(data);
                    const regressionLine = ss.linearRegressionLine(regression);

                    this.regressions[competence] = {
                        a: regression.m,
                        b: regression.b,
                        r2: ss.rSquared(data, regressionLine),
                        n: data.length,
                    };
                    regressionsCalculees++;
                } catch (error) {
                    console.warn(
                        `⚠️  Impossible de calculer régression pour ${competence}:`,
                        error.message
                    );
                }
            }
        });

        console.log(
            `   ✓ ${regressionsCalculees} régressions IPS calculées sur ${
                Object.keys(competencesData).length
            } compétences`
        );
    }

    /**
     * Prédit le résultat attendu selon l'IPS
     * @param {string} competence - Clé de compétence (ex: "CP_francais_Comprendre mots")
     * @param {number} ips - IPS de l'école
     * @returns {number|null} Résultat prédit ou null
     */
    predictFromIPS(competence, ips) {
        const reg = this.regressions[competence];
        if (!reg) return null;
        return reg.a * ips + reg.b;
    }

    /**
     * Obtient les références nationales/académiques pour une compétence
     * @param {string} competenceCle - Clé complète (ex: "CP_francais_Comprendre mots")
     * @returns {object|null} Références France/Académie
     */
    getReferenceNationale(competenceCle) {
        // Extraire niveau, matière et nom de compétence
        const parts = competenceCle.split("_");
        if (parts.length < 3) return null;

        const niveau = parts[0]; // CP, CE1, etc.
        const matiere = parts[1]; // francais, maths
        const nomCompetence = parts.slice(2).join("_"); // Le reste

        return this.references.getReference(niveau, matiere, nomCompetence);
    }

    /**
     * Catégorise une école sur une compétence donnée
     * @param {object} ecole - Objet école avec IPS et résultats
     * @param {string} competence - Clé de compétence
     * @param {number} seuilLevier - Seuil pour catégorie LEVIER (défaut: 5)
     * @param {number} seuilVigilance - Seuil pour catégorie VIGILANCE (défaut: -5)
     * @returns {object|null} Analyse de la compétence
     */
    categoriser(ecole, competence, seuilLevier = 7, seuilVigilance = -7) {
        const resultatReel = ecole.resultats[competence];
        if (resultatReel === undefined || !ecole.ips) return null;

        const attendu = this.predictFromIPS(competence, ecole.ips);
        if (!attendu) return null;

        const ecart = resultatReel - attendu;

        // Extraire niveau, matière et nom de compétence de la clé
        const parts = competence.split("_");
        const niveau = parts[0] || "";
        const matiere = parts[1] || "";
        const nomCompetence = parts.slice(2).join("_") || competence;

        const matiereLabel =
            matiere === "francais"
                ? "Français"
                : matiere === "maths"
                ? "Maths"
                : matiere;

        // Catégorisation IPS
        let categorieIPS = "Moyen";
        if (ecole.ips < 80) categorieIPS = "Très défavorisé";
        else if (ecole.ips < 90) categorieIPS = "Défavorisé";
        else if (ecole.ips > 120) categorieIPS = "Très favorisé";
        else if (ecole.ips > 110) categorieIPS = "Favorisé";

        // Récupérer les références nationales/académiques
        const ref = this.getReferenceNationale(competence);

        // Déterminer la catégorie selon écart IPS
        let categorie;
        let categorieCode;
        if (ecart > seuilLevier) {
            categorie = "🟢 LEVIER";
            categorieCode = "LEVIER";
        } else if (ecart < seuilVigilance) {
            categorie = "🔴 VIGILANCE";
            categorieCode = "VIGILANCE";
        } else {
            categorie = "🟡 CONFORME";
            categorieCode = "CONFORME";
        }

        return {
            ecole: ecole.nom,
            uai: ecole.uai,
            ips: Math.round(ecole.ips * 10) / 10,
            categorie_ips: categorieIPS,
            secteur: ecole.secteur || "",
            niveau: niveau,
            matiere: matiereLabel,
            competence: nomCompetence,
            competence_complete: competence, // Clé complète pour référence
            resultat_reel: Math.round(resultatReel * 10) / 10,
            resultat_attendu_ips: Math.round(attendu * 10) / 10,
            ecart_vs_ips: Math.round(ecart * 10) / 10,
            categorie: categorie,
            categorie_code: categorieCode,
            ref_france: ref?.france ? Math.round(ref.france * 10) / 10 : null,
            ref_academie: ref?.academie
                ? Math.round(ref.academie * 10) / 10
                : null,
            ecart_vs_france: ref?.france
                ? Math.round((resultatReel - ref.france) * 10) / 10
                : null,
            ecart_vs_academie: ref?.academie
                ? Math.round((resultatReel - ref.academie) * 10) / 10
                : null,
        };
    }

    /**
     * Analyse toutes les écoles sur toutes (ou certaines) compétences
     * @param {Array} ecolesWithIPS - Écoles avec IPS
     * @param {Array|null} competencesFiltrees - Liste de compétences à analyser (null = toutes)
     * @returns {Array} Tableau d'analyses
     */
    analyserTout(ecolesWithIPS, competencesFiltrees = null) {
        const resultats = [];
        let analysesReussies = 0;
        let analyseEchouees = 0;
        const ecolesManquantes = []; // ← AJOUT

        ecolesWithIPS.forEach((ecole) => {
            const competences =
                competencesFiltrees || Object.keys(ecole.resultats);

            competences.forEach((competence) => {
                if (ecole.resultats[competence] !== undefined) {
                    const analyse = this.categoriser(ecole, competence);
                    if (analyse) {
                        resultats.push(analyse);
                        analysesReussies++;
                    } else {
                        analyseEchouees++;
                        // ← AJOUT : Logger les analyses échouées
                        ecolesManquantes.push({
                            ecole: ecole.nom,
                            uai: ecole.uai,
                            competence: competence,
                            ips: ecole.ips,
                            resultat: ecole.resultats[competence],
                        });
                    }
                }
            });
        });

        console.log(` ✓ ${analysesReussies} analyses réussies`);
        if (analyseEchouees > 0) {
            console.log(
                ` ⚠️ ${analyseEchouees} analyses échouées (données manquantes ou régression impossible)`
            );
            // ← AJOUT : Afficher les 10 premières
            console.log(`\n 📋 Exemples d'analyses échouées:`);
            ecolesManquantes.slice(0, 10).forEach((m) => {
                console.log(
                    `   - ${m.ecole} (${m.uai}) : ${m.competence.substring(
                        0,
                        40
                    )}...`
                );
            });
            if (ecolesManquantes.length > 10) {
                console.log(`   ... et ${ecolesManquantes.length - 10} autres`);
            }
        }

        return resultats;
    }

    /**
     * Génère une vue synthétique des analyses
     * @param {Array} analyses - Tableau d'analyses
     * @returns {object} Statistiques et listes par catégorie
     */
    genererVueSynthetique(analyses) {
        const leviers = analyses.filter((a) => a.categorie_code === "LEVIER");
        const vigilance = analyses.filter(
            (a) => a.categorie_code === "VIGILANCE"
        );
        const conformes = analyses.filter(
            (a) => a.categorie_code === "CONFORME"
        );

        return {
            ecoles_leviers: leviers,
            ecoles_vigilance: vigilance,
            ecoles_conformes: conformes,
            statistiques: {
                total_analyses: analyses.length,
                nb_leviers: leviers.length,
                nb_vigilance: vigilance.length,
                nb_conformes: conformes.length,
                taux_leviers:
                    analyses.length > 0
                        ? ((leviers.length / analyses.length) * 100).toFixed(
                              1
                          ) + "%"
                        : "0%",
                taux_vigilance:
                    analyses.length > 0
                        ? ((vigilance.length / analyses.length) * 100).toFixed(
                              1
                          ) + "%"
                        : "0%",
                taux_conformes:
                    analyses.length > 0
                        ? ((conformes.length / analyses.length) * 100).toFixed(
                              1
                          ) + "%"
                        : "0%",
            },
        };
    }

    /**
     * Génère une synthèse par école (agrège toutes les compétences)
     * @param {Array} analyses - Tableau d'analyses
     * @returns {Array} Synthèse par école
     */
    genererSyntheseParEcole(analyses) {
        const parEcole = {};

        // Agréger les analyses par école
        analyses.forEach((a) => {
            if (!parEcole[a.uai]) {
                parEcole[a.uai] = {
                    ecole: a.ecole,
                    uai: a.uai,
                    ips: a.ips,
                    categorie_ips: a.categorie_ips,
                    secteur: a.secteur,
                    nb_leviers: 0,
                    nb_vigilance: 0,
                    nb_conformes: 0,
                    nb_total: 0,
                    competences_leviers: [],
                    competences_vigilance: [],
                    // Détails par niveau/matière
                    details_niveau_matiere: {},
                };
            }

            const ecole = parEcole[a.uai];
            ecole.nb_total++;

            // Compter par catégorie
            if (a.categorie_code === "LEVIER") {
                ecole.nb_leviers++;
                ecole.competences_leviers.push(
                    `${a.niveau} ${a.matiere}: ${a.competence}`
                );
            } else if (a.categorie_code === "VIGILANCE") {
                ecole.nb_vigilance++;
                ecole.competences_vigilance.push(
                    `${a.niveau} ${a.matiere}: ${a.competence}`
                );
            } else {
                ecole.nb_conformes++;
            }

            // Agréger par niveau/matière
            const cle = `${a.niveau}_${a.matiere}`;
            if (!ecole.details_niveau_matiere[cle]) {
                ecole.details_niveau_matiere[cle] = {
                    niveau: a.niveau,
                    matiere: a.matiere,
                    nb_leviers: 0,
                    nb_vigilance: 0,
                    nb_conformes: 0,
                };
            }

            if (a.categorie_code === "LEVIER")
                ecole.details_niveau_matiere[cle].nb_leviers++;
            else if (a.categorie_code === "VIGILANCE")
                ecole.details_niveau_matiere[cle].nb_vigilance++;
            else ecole.details_niveau_matiere[cle].nb_conformes++;
        });

        // Convertir en array et enrichir
        return (
            Object.values(parEcole)
                .map((e) => {
                    // Calculer le profil global
                    let profilGlobal;
                    const tauxVigilance =
                        e.nb_total > 0 ? e.nb_vigilance / e.nb_total : 0;
                    const tauxLeviers =
                        e.nb_total > 0 ? e.nb_leviers / e.nb_total : 0;

                    if (tauxVigilance >= 0.3) {
                        profilGlobal = "🔴 ACCOMPAGNEMENT PRIORITAIRE";
                    } else if (tauxLeviers >= 0.3) {
                        profilGlobal = "🟢 ÉCOLE LEVIER";
                    } else if (e.nb_vigilance >= 5) {
                        profilGlobal = "🟠 VIGILANCE MODÉRÉE";
                    } else {
                        profilGlobal = "🟡 SUIVI STANDARD";
                    }

                    return {
                        ...e,
                        taux_leviers:
                            ((e.nb_leviers / e.nb_total) * 100).toFixed(1) +
                            "%",
                        taux_vigilance:
                            ((e.nb_vigilance / e.nb_total) * 100).toFixed(1) +
                            "%",
                        competences_leviers_str:
                            e.competences_leviers.slice(0, 5).join(" | ") +
                            (e.competences_leviers.length > 5
                                ? ` | +${
                                      e.competences_leviers.length - 5
                                  } autres`
                                : ""),
                        competences_vigilance_str:
                            e.competences_vigilance.slice(0, 5).join(" | ") +
                            (e.competences_vigilance.length > 5
                                ? ` | +${
                                      e.competences_vigilance.length - 5
                                  } autres`
                                : ""),
                        profil_global: profilGlobal,
                        // Supprimer le détail niveau/matière de l'export principal (trop verbeux)
                        details_niveau_matiere: undefined,
                    };
                })
                // Trier par priorité : d'abord vigilance, puis leviers
                .sort((a, b) => {
                    if (a.nb_vigilance !== b.nb_vigilance) {
                        return b.nb_vigilance - a.nb_vigilance;
                    }
                    return b.nb_leviers - a.nb_leviers;
                })
        );
    }

    /**
     * Génère une synthèse par niveau et matière
     * @param {Array} analyses - Tableau d'analyses
     * @returns {Array} Synthèse par niveau/matière
     */
    genererSyntheseParNiveauMatiere(analyses) {
        const parNM = {};

        analyses.forEach((a) => {
            const cle = `${a.niveau}_${a.matiere}`;

            if (!parNM[cle]) {
                parNM[cle] = {
                    niveau: a.niveau,
                    matiere: a.matiere,
                    nb_leviers: 0,
                    nb_vigilance: 0,
                    nb_conformes: 0,
                    nb_total: 0,
                    ecoles_leviers: new Set(),
                    ecoles_vigilance: new Set(),
                };
            }

            parNM[cle].nb_total++;

            if (a.categorie_code === "LEVIER") {
                parNM[cle].nb_leviers++;
                parNM[cle].ecoles_leviers.add(a.ecole);
            } else if (a.categorie_code === "VIGILANCE") {
                parNM[cle].nb_vigilance++;
                parNM[cle].ecoles_vigilance.add(a.ecole);
            } else {
                parNM[cle].nb_conformes++;
            }
        });

        return Object.values(parNM)
            .map((nm) => ({
                ...nm,
                taux_leviers:
                    ((nm.nb_leviers / nm.nb_total) * 100).toFixed(1) + "%",
                taux_vigilance:
                    ((nm.nb_vigilance / nm.nb_total) * 100).toFixed(1) + "%",
                nb_ecoles_leviers: nm.ecoles_leviers.size,
                nb_ecoles_vigilance: nm.ecoles_vigilance.size,
                ecoles_leviers: undefined,
                ecoles_vigilance: undefined,
            }))
            .sort((a, b) => {
                // Trier par niveau puis matière
                if (a.niveau !== b.niveau) {
                    const niveaux = ["CP", "CE1", "CE2", "CM1", "CM2"];
                    return (
                        niveaux.indexOf(a.niveau) - niveaux.indexOf(b.niveau)
                    );
                }
                return a.matiere.localeCompare(b.matiere);
            });
    }

    /**
     * Affiche des statistiques détaillées dans la console
     * @param {object} vue - Vue synthétique générée
     */
    afficherStatistiques(vue) {
        console.log("\n📊 STATISTIQUES DÉTAILLÉES:\n");
        console.log(`   Total analyses: ${vue.statistiques.total_analyses}`);
        console.log(
            `   🟢 Leviers: ${vue.statistiques.nb_leviers} (${vue.statistiques.taux_leviers})`
        );
        console.log(
            `   🔴 Vigilance: ${vue.statistiques.nb_vigilance} (${vue.statistiques.taux_vigilance})`
        );
        console.log(
            `   🟡 Conformes: ${vue.statistiques.nb_conformes} (${vue.statistiques.taux_conformes})`
        );
    }
}
