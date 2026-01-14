import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Service de récupération des IPS (Indice de Position Sociale)
 * Version OPTIMISÉE avec cache et un seul appel API par académie
 *
 * @class IPSService
 */
export class IPSService {
    constructor(cacheDir = null) {
        this.baseURL =
            "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-ips-ecoles-ap2022/records";
        this.rentree = "2024-2025";

        // Répertoire de cache (par défaut : data/cache/)
        this.cacheDir =
            cacheDir || path.join(path.dirname(__dirname), "data", "cache");

        // Créer le répertoire de cache s'il n'existe pas
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }

        // Cache en mémoire
        this.ipsCache = null;
    }

    /**
     * Récupère le chemin du fichier de cache pour une académie
     * @param {string} academie - Nom de l'académie
     * @returns {string} Chemin du fichier de cache
     */
    getCachePath(academie) {
        const filename = `ips_${academie
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "_")}_${this.rentree.replace(
            "-",
            "_"
        )}.json`;
        return path.join(this.cacheDir, filename);
    }

    /**
     * Vérifie si le cache existe et est récent (< 30 jours)
     * @param {string} cachePath - Chemin du fichier de cache
     * @returns {boolean} true si le cache est valide
     */
    isCacheValid(cachePath) {
        if (!fs.existsSync(cachePath)) {
            return false;
        }

        const stats = fs.statSync(cachePath);
        const ageJours =
            (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);

        return ageJours < 30; // Cache valide 30 jours
    }

    /**
     * Charge le cache depuis le disque
     * @param {string} cachePath - Chemin du fichier de cache
     * @returns {Array|null} Données du cache ou null
     */
    loadCache(cachePath) {
        try {
            const data = fs.readFileSync(cachePath, "utf-8");
            return JSON.parse(data);
        } catch (error) {
            console.warn(`⚠️  Erreur lecture cache: ${error.message}`);
            return null;
        }
    }

    /**
     * Sauvegarde le cache sur le disque
     * @param {string} cachePath - Chemin du fichier de cache
     * @param {Array} data - Données à sauvegarder
     */
    saveCache(cachePath, data) {
        try {
            fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), "utf-8");
            console.log(`   💾 Cache sauvegardé: ${path.basename(cachePath)}`);
        } catch (error) {
            console.warn(`⚠️  Erreur sauvegarde cache: ${error.message}`);
        }
    }

    /**
     * Télécharge TOUTES les écoles d'une académie en UN SEUL appel API
     * @param {string} academie - Nom de l'académie (ex: "GRENOBLE")
     * @returns {Array} Liste des IPS de toutes les écoles de l'académie
     */
    async downloadAcademieIPS(academie) {
        console.log(`   📡 Téléchargement des IPS pour ${academie}...`);

        try {
            // Premier appel pour connaître le nombre total
            const firstResponse = await axios.get(this.baseURL, {
                params: {
                    limit: 1,
                    refine: `rentree_scolaire:"${this.rentree}"`,
                    where: `academie="${academie}"`,
                },
            });

            const total = firstResponse.data.total_count;
            console.log(`   📊 ${total} écoles trouvées dans ${academie}`);

            if (total === 0) {
                return [];
            }

            // Télécharger TOUTES les écoles en une seule requête
            // (limite max de l'API : 100, on peut faire plusieurs appels si nécessaire)
            const allResults = [];
            const limit = 100;
            const nbCalls = Math.ceil(total / limit);

            for (let i = 0; i < nbCalls; i++) {
                const offset = i * limit;
                console.log(
                    `   📥 Téléchargement ${offset + 1}-${Math.min(
                        offset + limit,
                        total
                    )}/${total}...`
                );

                const response = await axios.get(this.baseURL, {
                    params: {
                        limit: limit,
                        offset: offset,
                        refine: `rentree_scolaire:"${this.rentree}"`,
                        where: `academie="${academie}"`,
                    },
                });

                // Extraire et formater les données
                const formatted = response.data.results.map((record) => ({
                    uai: record.uai,
                    ips: parseFloat(record.ips) || null,
                    secteur: record.secteur,
                    academie: record.academie,
                    departement: record.departement,
                    nom_commune: record.nom_de_la_commune,
                    ips_academique_public: parseFloat(
                        record.ips_academique_public
                    ),
                    ips_national_public: parseFloat(record.ips_national_public),
                    nom_etablissement: record.nom_etablissement || null,
                }));

                allResults.push(...formatted);

                // Petite pause entre les appels si plusieurs pages
                if (i < nbCalls - 1) {
                    await new Promise((resolve) => setTimeout(resolve, 500));
                }
            }

            console.log(`   ✓ ${allResults.length} IPS téléchargés`);
            return allResults;
        } catch (error) {
            console.error(
                `❌ Erreur téléchargement IPS ${academie}:`,
                error.message
            );
            return [];
        }
    }

    /**
     * Charge les IPS d'une académie (depuis le cache ou l'API)
     * @param {string} academie - Nom de l'académie
     * @param {boolean} forceRefresh - Forcer le téléchargement même si cache valide
     * @returns {Promise<Array>} Liste des IPS
     */
    async loadAcademieIPS(academie, forceRefresh = false) {
        const cachePath = this.getCachePath(academie);

        // Vérifier le cache
        if (!forceRefresh && this.isCacheValid(cachePath)) {
            console.log(
                `   📂 Chargement du cache: ${path.basename(cachePath)}`
            );
            const cached = this.loadCache(cachePath);

            if (cached && cached.length > 0) {
                console.log(
                    `   ✓ ${cached.length} IPS chargés depuis le cache`
                );
                this.ipsCache = cached;
                return cached;
            }
        }

        // Télécharger depuis l'API
        console.log(`   🌐 Téléchargement depuis l'API...`);
        const downloaded = await this.downloadAcademieIPS(academie);

        if (downloaded.length > 0) {
            // Sauvegarder dans le cache
            this.saveCache(cachePath, downloaded);
            this.ipsCache = downloaded;
        }

        return downloaded;
    }

    /**
     * Récupère l'IPS d'une école spécifique depuis le cache en mémoire
     * @param {string} uai - UAI de l'école
     * @returns {Object|null} IPS de l'école ou null
     */
    getIPSFromCache(uai) {
        if (!this.ipsCache) {
            return null;
        }

        const found = this.ipsCache.find((e) => e.uai === uai.trim());
        return found || null;
    }

    /**
     * Récupère les IPS pour une liste d'UAI
     * OPTIMISÉ : Utilise le cache chargé en mémoire
     *
     * @param {Array} uais - Liste des UAI
     * @param {string} academie - Nom de l'académie
     * @param {boolean} forceRefresh - Forcer le téléchargement
     * @returns {Promise<Array>} Liste des IPS trouvés
     */
    async getIPSBatch(uais, academie, forceRefresh = false) {
        // S'assurer que le cache de l'académie est chargé
        if (!this.ipsCache || forceRefresh) {
            await this.loadAcademieIPS(academie, forceRefresh);
        }

        console.log(
            `   🔍 Recherche de ${uais.length} écoles dans le cache...`
        );

        const results = [];
        const notFound = [];

        for (const uai of uais) {
            const ips = this.getIPSFromCache(uai);
            if (ips) {
                results.push(ips);
            } else {
                notFound.push(uai);
            }
        }

        console.log(`   ✓ ${results.length}/${uais.length} IPS trouvés`);

        if (notFound.length > 0) {
            console.warn(
                `   ⚠️  ${notFound.length} écoles non trouvées dans le cache:`
            );
            notFound.slice(0, 5).forEach((uai) => {
                console.warn(`      - ${uai}`);
            });
            if (notFound.length > 5) {
                console.warn(`      ... et ${notFound.length - 5} autres`);
            }
        }

        return results;
    }

    /**
     * Récupère l'IPS d'une seule école (méthode de compatibilité)
     * Utilise le cache si disponible, sinon fait un appel API direct
     *
     * @param {string} uai - UAI de l'école
     * @returns {Promise<Object|null>} IPS de l'école
     */
    async getIPS(uai) {
        // Chercher d'abord dans le cache
        if (this.ipsCache) {
            const fromCache = this.getIPSFromCache(uai);
            if (fromCache) {
                return fromCache;
            }
        }

        // Si pas dans le cache, appel API direct (mode legacy)
        try {
            const response = await axios.get(this.baseURL, {
                params: {
                    limit: 1,
                    refine: `rentree_scolaire:"${this.rentree}"`,
                    where: `uai="${uai.trim()}"`,
                },
            });

            if (response.data.total_count === 0) {
                console.warn(`⚠️  IPS non trouvé pour UAI ${uai}`);
                return null;
            }

            const record = response.data.results[0];
            return {
                uai: uai,
                ips: parseFloat(record.ips) || null,
                secteur: record.secteur,
                academie: record.academie,
                departement: record.departement,
                nom_commune: record.nom_de_la_commune,
                ips_academique_public: parseFloat(record.ips_academique_public),
                ips_national_public: parseFloat(record.ips_national_public),
            };
        } catch (error) {
            console.error(`❌ Erreur API IPS pour ${uai}:`, error.message);
            return null;
        }
    }

    /**
     * Affiche des statistiques sur le cache chargé
     */
    afficherStatistiques() {
        if (!this.ipsCache) {
            console.log("\n📊 Aucun cache chargé en mémoire\n");
            return;
        }

        console.log("\n📊 STATISTIQUES DU CACHE IPS:\n");

        const total = this.ipsCache.length;
        const avecIPS = this.ipsCache.filter((e) => e.ips !== null).length;
        const publiques = this.ipsCache.filter(
            (e) => e.secteur === "Public"
        ).length;
        const privees = this.ipsCache.filter(
            (e) => e.secteur === "Privé"
        ).length;

        console.log(`   Total écoles        : ${total}`);
        console.log(
            `   Avec IPS            : ${avecIPS} (${(
                (avecIPS / total) *
                100
            ).toFixed(1)}%)`
        );
        console.log(`   Publiques           : ${publiques}`);
        console.log(`   Privées             : ${privees}`);

        if (avecIPS > 0) {
            const ipsValues = this.ipsCache
                .filter((e) => e.ips !== null)
                .map((e) => e.ips);
            const moyenne =
                ipsValues.reduce((a, b) => a + b, 0) / ipsValues.length;
            const min = Math.min(...ipsValues);
            const max = Math.max(...ipsValues);

            console.log(`\n   IPS moyen           : ${moyenne.toFixed(2)}`);
            console.log(
                `   IPS min/max         : ${min.toFixed(2)} - ${max.toFixed(2)}`
            );
        }

        console.log("");
    }

    /**
     * Vide le cache (fichier + mémoire)
     * @param {string} academie - Nom de l'académie
     */
    clearCache(academie) {
        const cachePath = this.getCachePath(academie);

        if (fs.existsSync(cachePath)) {
            fs.unlinkSync(cachePath);
            console.log(`   🗑️  Cache supprimé: ${path.basename(cachePath)}`);
        }

        this.ipsCache = null;
    }
}
