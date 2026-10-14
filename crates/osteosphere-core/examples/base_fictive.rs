//! Base fictive à la taille d'un gros cabinet, pour vérifier les exigences du cahier des charges :
//! 10 000 patients et 50 000 séances sur dix ans, avec antécédents, factures et règlements.
//!
//! ```text
//! cargo run --release -p osteosphere-core --example base_fictive -- creer <dossier> [patients] [séances]
//! cargo run --release -p osteosphere-core --example base_fictive -- mesurer <dossier>
//! ```
//!
//! Le cabinet est protégé par le mot de passe « mot de passe fictif ». L'application l'ouvre avec
//! `OSTEOSPHERE_DOSSIER=<dossier>`. Noms, adresses, téléphones et contenus sont inventés : les
//! numéros sont pris dans les tranches que l'Arcep réserve à la fiction, les emails sur example.org.

use std::path::Path;
use std::time::{Duration, Instant};

use osteosphere_core::antecedents::{self, SaisieAntecedent};
use osteosphere_core::base::Base;
use osteosphere_core::cabinet::{Cabinet, IdentiteCabinet, PARAMETRE_IDENTITE};
use osteosphere_core::cle_de_secours::CleDeSecours;
use osteosphere_core::facturation::{self, LigneFacture, Moyen, SaisieReglement};
use osteosphere_core::groupes::{self, SaisieGroupe};
use osteosphere_core::numerotation::Date;
use osteosphere_core::patients::{self, FichePatient};
use osteosphere_core::seances::{self, Facturation, SaisieSeance, TypeSeance};
use osteosphere_core::statistiques::{self, BaseChiffre};
use osteosphere_core::trousseau::ProtectionSession;
use osteosphere_core::{accueil, dossiers, modeles, prestations, sauvegardes, trames};
use serde_json::{Map, Value, json};
use zeroize::Zeroizing;

const MOT_DE_PASSE: &str = "mot de passe fictif";

fn main() {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let nombre = |rang: usize, defaut: usize| arguments.get(rang).map_or(defaut, |n| n.parse().expect("nombre attendu"));
    match (arguments.first().map(String::as_str), arguments.get(1)) {
        (Some("creer"), Some(dossier)) => creer(Path::new(dossier), nombre(2, 10_000), nombre(3, 50_000)),
        (Some("mesurer"), Some(dossier)) => mesurer(Path::new(dossier)),
        _ => {
            eprintln!("usage : base_fictive creer <dossier> [patients] [séances] | base_fictive mesurer <dossier>");
            std::process::exit(2);
        }
    }
}

/// Le mot de passe protège ce cabinet : la session de l'ordinateur n'est jamais sollicitée.
struct SansSession;

impl ProtectionSession for SansSession {
    fn nom(&self) -> &'static str {
        "aucune"
    }
    fn proteger(&self, _: &[u8]) -> Result<Vec<u8>, String> {
        Err("cabinet fictif protégé par mot de passe".into())
    }
    fn deproteger(&self, _: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
        Err("cabinet fictif protégé par mot de passe".into())
    }
}

/// Tirages reproductibles (xorshift) : deux bases créées avec les mêmes nombres sont identiques.
struct Hasard(u64);

impl Hasard {
    fn suivant(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn entre(&mut self, n: usize) -> usize {
        (self.suivant() % n as u64) as usize
    }
    fn choisir<'a, T>(&mut self, liste: &'a [T]) -> &'a T {
        &liste[self.entre(liste.len())]
    }
    fn sur_cent(&mut self, chances: u64) -> bool {
        self.suivant() % 100 < chances
    }
}

const NOMS: [&str; 120] = [
    "MARTIN", "BERNARD", "THOMAS", "PETIT", "ROBERT", "RICHARD", "DURAND", "DUBOIS", "MOREAU", "LAURENT", "SIMON", "MICHEL",
    "LEFEBVRE", "LEROY", "ROUX", "DAVID", "BERTRAND", "MOREL", "FOURNIER", "GIRARD", "BONNET", "DUPONT", "LAMBERT", "FONTAINE",
    "ROUSSEAU", "VINCENT", "MULLER", "LEFÈVRE", "FAURE", "ANDRÉ", "MERCIER", "BLANC", "GUÉRIN", "BOYER", "GARNIER", "CHEVALIER",
    "FRANÇOIS", "LEGRAND", "GAUTHIER", "GARCIA", "PERRIN", "ROBIN", "CLÉMENT", "MORIN", "NICOLAS", "HENRY", "ROUSSEL", "MATHIEU",
    "GAUTIER", "MASSON", "MARCHAND", "DUVAL", "DENIS", "DUMONT", "MARIE", "LEMAIRE", "NOËL", "MEYER", "DUFOUR", "MEUNIER",
    "BRUN", "BLANCHARD", "GIRAUD", "JOLY", "RIVIÈRE", "LUCAS", "BRUNET", "GAILLARD", "BARBIER", "ARNAUD", "MARTINEZ", "GÉRARD",
    "ROCHE", "RENARD", "SCHMITT", "ROY", "LEROUX", "COLIN", "VIDAL", "CARON", "PICARD", "ROGER", "FABRE", "AUBERT", "LEMOINE",
    "RENAUD", "DUMAS", "LACROIX", "OLIVIER", "PHILIPPE", "BOURGEOIS", "PIERRE", "BENOÎT", "REY", "LECLERC", "PAYET", "ROLLAND",
    "LECLERCQ", "GUILLAUME", "LECOMTE", "LOPEZ", "JEAN", "DUPUY", "GUILLOT", "HUBERT", "BERGER", "CARPENTIER", "SANCHEZ",
    "DUPUIS", "MOULIN", "LOUIS", "DESCHAMPS", "LABORDE", "DELPECH", "LAFON", "CASTAGNÉ", "BOUSQUET", "SALLES", "LESPINASSE",
    "DE LA FAYE",
];

const PRENOMS_F: [&str; 60] = [
    "Marie", "Jeanne", "Monique", "Françoise", "Nicole", "Sylvie", "Isabelle", "Catherine", "Nathalie", "Christine", "Sandrine",
    "Valérie", "Céline", "Stéphanie", "Aurélie", "Julie", "Émilie", "Camille", "Laura", "Sarah", "Manon", "Léa", "Chloé", "Emma",
    "Inès", "Jade", "Louise", "Alice", "Lina", "Rose", "Anna", "Mila", "Ambre", "Agathe", "Juliette", "Lucie", "Zoé", "Clara",
    "Hélène", "Martine", "Brigitte", "Danielle", "Odette", "Simone", "Colette", "Josiane", "Agnès", "Pauline", "Marion", "Mathilde",
    "Élise", "Margaux", "Eva", "Romane", "Anaïs", "Océane", "Maëlle", "Solène", "Noémie", "Gaëlle",
];

const PRENOMS_M: [&str; 60] = [
    "Jean", "Pierre", "Michel", "André", "Philippe", "Alain", "Bernard", "Christian", "Daniel", "Patrick", "Éric", "Laurent",
    "Stéphane", "Frédéric", "Olivier", "Nicolas", "Sébastien", "Julien", "Thomas", "Maxime", "Alexandre", "Hugo", "Lucas", "Léo",
    "Gabriel", "Louis", "Raphaël", "Arthur", "Jules", "Adam", "Nathan", "Paul", "Tom", "Noah", "Ethan", "Sacha", "Mathis", "Théo",
    "Clément", "Antoine", "Romain", "Quentin", "Guillaume", "Vincent", "Jérôme", "Franck", "Gérard", "Roger", "Marcel", "René",
    "Henri", "Yves", "Gilles", "Serge", "Didier", "Bruno", "Thierry", "Benoît", "Damien", "Kévin",
];

const COMMUNES: [(&str, &str); 16] = [
    ("47150", "Lacapelle-Biron"), ("47150", "Monflanquin"), ("47210", "Villeréal"), ("47500", "Fumel"), ("47300", "Villeneuve-sur-Lot"),
    ("24540", "Monpazier"), ("47150", "Gavaudun"), ("47500", "Monsempron-Libos"), ("47210", "Rives"), ("47150", "Salles"),
    ("47440", "Casseneuil"), ("47110", "Sainte-Livrade-sur-Lot"), ("24540", "Biron"), ("47150", "Paulhiac"), ("46220", "Prayssac"),
    ("47000", "Agen"),
];

const VOIES: [&str; 14] = [
    "rue des Tilleuls", "chemin de la Fontaine", "route de Fumel", "place de la Halle", "rue du Moulin", "impasse des Vignes",
    "allée des Chênes", "rue de l'Église", "lieu-dit Le Bourg", "chemin des Prés", "avenue de la Gare", "rue des Écoles",
    "route de Villeréal", "rue Saint-Jacques",
];

const PROFESSIONS: [&str; 18] = [
    "Agricultrice", "Agriculteur", "Infirmière", "Enseignant", "Maçon", "Secrétaire", "Retraitée", "Retraité", "Étudiante",
    "Commerçant", "Aide-soignante", "Boulanger", "Comptable", "Viticulteur", "Chauffeur routier", "Coiffeuse", "Menuisier",
    "Employée de bureau",
];

const NOTES: [&str; 8] = [
    "Sous anticoagulants",
    "Prothèse totale de hanche gauche",
    "Ostéoporose avérée",
    "Allergie au latex",
    "Pacemaker",
    "Enceinte, terme prévu au printemps",
    "Hernie discale L5-S1 opérée",
    "Pas de manipulation cervicale",
];

const MOTIFS: [&str; 16] = [
    "Lombalgie aiguë depuis trois jours, après avoir porté une charge au jardin.",
    "Cervicalgie avec raideur au réveil, irradiant vers l'épaule droite.",
    "Douleur à l'épaule gauche en levant le bras, depuis deux semaines.",
    "Suivi de lombalgie chronique, amélioration nette depuis la dernière séance.",
    "Céphalées de tension en fin de journée, travail sur écran.",
    "Entorse de cheville droite il y a un mois, gêne à la course.",
    "Bilan après un accident de voiture sans gravité, raideur du cou.",
    "Douleurs dorsales entre les omoplates, stress professionnel.",
    "Coliques et pleurs du nourrisson, sommeil agité.",
    "Sciatalgie gauche jusqu'au mollet, sans déficit.",
    "Douleur au genou en descendant les escaliers.",
    "Troubles digestifs et ballonnements depuis plusieurs mois.",
    "Préparation à l'accouchement, douleurs du bassin.",
    "Tendinite du coude, travail manuel répété.",
    "Vertiges positionnels au lever, bilan ORL normal.",
    "Contrôle annuel, aucune plainte particulière.",
];

const TESTS: [&str; 8] = [
    "Test de Lasègue négatif. Mobilité lombaire diminuée en flexion.",
    "Restriction de mobilité C5-C6 à droite, tension des trapèzes.",
    "Dysfonction sacro-iliaque gauche, test de flexion debout positif.",
    "Diaphragme tendu, mobilité costale réduite à gauche.",
    "Bilan articulaire de la cheville : tiroir antérieur négatif.",
    "Tensions viscérales en regard du côlon transverse.",
    "Tests neurologiques normaux, réflexes présents et symétriques.",
    "Mobilité crânienne diminuée, tension temporale droite.",
];

const TRAITEMENTS: [&str; 8] = [
    "Techniques myotensives lombaires, libération du diaphragme.",
    "Mobilisations cervicales douces, travail des trapèzes et de la première côte.",
    "Correction sacro-iliaque, équilibration du bassin.",
    "Techniques viscérales abdominales, travail du plexus solaire.",
    "Techniques crâniennes et équilibration de la base du crâne.",
    "Drainage de la cheville et mobilisation de la fibula.",
    "Travail fascial dorsal, conseils de posture au bureau.",
    "Équilibration générale, conseils d'étirements à faire chez soi.",
];

const ANTECEDENTS: [(&str, &str, &str); 12] = [
    ("medicaux", "Traitement longue durée", "Hypertension traitée"),
    ("medicaux", "Allergies", "Pollens"),
    ("traumatiques", "Entorse", "Cheville droite, au handball"),
    ("traumatiques", "Fracture", "Poignet gauche, chute à vélo"),
    ("traumatiques", "Accident de la route", "Choc arrière, coup du lapin"),
    ("chirurgicaux", "Abdomen", "Appendicectomie"),
    ("chirurgicaux", "Orthopédique", "Ligamentoplastie du genou"),
    ("chirurgicaux", "Gynéco / Uro", "Césarienne"),
    ("familiaux", "Maladies", "Diabète chez la mère"),
    ("psychologiques", "Insomnie", "Réveils nocturnes fréquents"),
    ("psychologiques", "Anxiété", "Période de stress au travail"),
    ("medicaux", "Autres", "Migraines depuis l'adolescence"),
];

fn ascii(texte: &str) -> String {
    texte
        .chars()
        .map(|c| match c {
            'à' | 'â' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' | 'É' => 'e',
            'î' | 'ï' => 'i',
            'ô' | 'ö' => 'o',
            'û' | 'ü' | 'ù' => 'u',
            'ç' | 'Ç' => 'c',
            ' ' => '-',
            autre => autre.to_ascii_lowercase(),
        })
        .collect()
}

fn document(texte: &str) -> Value {
    json!({ "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": texte }] }] })
}

/// Deux chiffres pris au hasard, pour les numéros de fiction.
fn paire(hasard: &mut Hasard) -> String {
    format!("{:02}", hasard.entre(100))
}

fn fiche(hasard: &mut Hasard, rang: usize, groupes: &[String]) -> FichePatient {
    let femme = hasard.sur_cent(56);
    let prenom = if femme { *hasard.choisir(&PRENOMS_F) } else { *hasard.choisir(&PRENOMS_M) };
    let nom = *hasard.choisir(&NOMS);
    // Un patient sur six a moins de quinze ans ; les autres sont nés entre 1935 et 2010.
    let annee = if hasard.sur_cent(16) { 2011 + hasard.entre(15) } else { 1935 + hasard.entre(76) };
    let naissance = Date::depuis_jours_unix(Date::lire(&format!("{annee}-01-01")).unwrap().jours_unix() + hasard.entre(365) as i64);
    let (code_postal, ville) = *hasard.choisir(&COMMUNES);
    let mariee = femme && annee < 1995 && hasard.sur_cent(40);
    FichePatient {
        sexe: if femme { "F" } else { "M" }.into(),
        nom: if mariee { (*hasard.choisir(&NOMS)).into() } else { nom.into() },
        nom_naissance: if mariee { nom.into() } else { String::new() },
        prenom: prenom.into(),
        naissance: Some(naissance.to_string()),
        adresse: format!("{} {}", 1 + hasard.entre(80), hasard.choisir(&VOIES)),
        code_postal: code_postal.into(),
        ville: ville.into(),
        portable: if hasard.sur_cent(85) { format!("06 39 98 {} {}", paire(hasard), paire(hasard)) } else { String::new() },
        fixe: if hasard.sur_cent(25) { format!("05 36 49 {} {}", paire(hasard), paire(hasard)) } else { String::new() },
        email: if hasard.sur_cent(60) { format!("{}.{}{}@example.org", ascii(prenom), ascii(nom), rang % 97) } else { String::new() },
        profession: if annee < 2005 { (*hasard.choisir(&PROFESSIONS)).into() } else { String::new() },
        lateralite: if hasard.sur_cent(10) { "gaucher" } else { "droitier" }.into(),
        statut: (*hasard.choisir(&["Suivi", "Suivi", "Nouveau", "Ancien patient"])).into(),
        notes_importantes: if hasard.sur_cent(4) { (*hasard.choisir(&NOTES)).into() } else { String::new() },
        remarques: if hasard.sur_cent(15) { "Préfère les rendez-vous en fin de journée.".into() } else { String::new() },
        groupes: if hasard.sur_cent(8) { vec![hasard.choisir(groupes).clone()] } else { Vec::new() },
        ..Default::default()
    }
}

/// Tous les jours ouvrés du cabinet, du lundi au samedi.
fn jours_ouvres(du: Date, au: Date) -> Vec<Date> {
    (du.jours_unix()..=au.jours_unix()).filter(|j| (j + 3).rem_euclid(7) != 6).map(Date::depuis_jours_unix).collect()
}

/// Nombre de séances de chaque patient : beaucoup de patients viennent une ou deux fois, quelques-uns
/// des dizaines de fois. Le total vaut exactement `seances`.
fn repartir(hasard: &mut Hasard, patients: usize, seances: usize) -> Vec<usize> {
    let mut nombres: Vec<usize> = (0..patients)
        .map(|_| {
            let mut n = 1;
            while n < 60 && hasard.sur_cent(79) {
                n += 1;
            }
            n
        })
        .collect();
    let mut total: usize = nombres.iter().sum();
    while total < seances {
        let rang = hasard.entre(patients);
        nombres[rang] += 1;
        total += 1;
    }
    while total > seances {
        let rang = hasard.entre(patients);
        if nombres[rang] > 1 {
            nombres[rang] -= 1;
            total -= 1;
        }
    }
    nombres
}

fn par_lots(base: &Base, debut: &mut Instant, rang: usize) {
    if rang % 500 == 499 {
        base.connexion().execute_batch("COMMIT; BEGIN").unwrap();
    }
    if debut.elapsed() > Duration::from_secs(5) {
        eprint!(".");
        *debut = Instant::now();
    }
}

fn creer(dossier: &Path, nombre_patients: usize, nombre_seances: usize) {
    let depart = Instant::now();
    let cabinet = Cabinet::new(dossier);
    let ouvert = cabinet.creer(&CleDeSecours::generer().unwrap(), Some(MOT_DE_PASSE), &SansSession).expect("création du cabinet");
    let base = &ouvert.base;
    let identite = IdentiteCabinet {
        prenom: "Alexandre".into(),
        nom: "Fictif".into(),
        profession: "Ostéopathe".into(),
        adresse: "1 place de la Halle".into(),
        code_postal: "47150".into(),
        ville: "Lacapelle-Biron".into(),
        telephone: "05 36 49 00 00".into(),
        siret: "000 000 000 00000".into(),
        rpps: "10000000000".into(),
        ..Default::default()
    };
    base.ecrire_parametre(PARAMETRE_IDENTITE, &identite).unwrap();
    trames::installer_bibliotheque_de_depart(base).unwrap();
    modeles::installer_modeles_fournis(base).unwrap();
    prestations::installer_prestations_de_depart(base).unwrap();
    modeles::choisir_pratique_de_depart(base, "Adulte", true).unwrap();
    let modele = modeles::lister(base).unwrap().into_iter().find(|m| m.nom == "Adulte").expect("modèle Adulte");
    let prestation = prestations::par_defaut(base).unwrap().expect("prestation par défaut");
    let ligne = LigneFacture {
        prestation_id: Some(prestation.id.clone()),
        designation: prestation.designation().to_owned(),
        quantite: 1,
        prix_unitaire_centimes: prestation.saisie.tarif_centimes,
        reduction_centimes: 0,
    };
    let groupes: Vec<String> = ["Sportifs", "Femmes enceintes", "Nourrissons", "Famille Lafon"]
        .iter()
        .map(|nom| groupes::enregistrer(base, None, &SaisieGroupe { nom: (*nom).into(), couleur: String::new() }).unwrap().id)
        .collect();

    let mut hasard = Hasard(0x0057_E050_F1C7_1F00);
    let mut battement = Instant::now();
    base.connexion().execute_batch("BEGIN").unwrap();
    let mut ids = Vec::with_capacity(nombre_patients);
    for rang in 0..nombre_patients {
        let patient = patients::creer(base, &fiche(&mut hasard, rang, &groupes)).unwrap();
        for _ in 0..[0, 0, 1, 1, 2, 3, 4][hasard.entre(7)] {
            let (categorie, rubrique, precision) = *hasard.choisir(&ANTECEDENTS);
            let saisie = SaisieAntecedent {
                categorie: categorie.into(),
                rubrique: rubrique.into(),
                precision: precision.into(),
                debut: Some(format!("{}", 1990 + hasard.entre(35))),
                ..Default::default()
            };
            antecedents::enregistrer(base, &patient.id, None, &saisie).unwrap();
        }
        ids.push(patient.id);
        par_lots(base, &mut battement, rang);
    }
    eprintln!("\n{nombre_patients} patients en {:.1} s", depart.elapsed().as_secs_f64());

    // Dix ans d'activité jusqu'à aujourd'hui, à Paris.
    let aujourdhui = osteosphere_core::horloge::paris(osteosphere_core::base::maintenant()).0;
    let debut = Date::depuis_jours_unix(aujourdhui.jours_unix() - 3_652);
    let jours = jours_ouvres(debut, aujourdhui);
    let mut rendez_vous: Vec<(String, usize)> = Vec::with_capacity(nombre_seances);
    for (patient, nombre) in repartir(&mut hasard, nombre_patients, nombre_seances).into_iter().enumerate() {
        // Première venue n'importe quand ; les suivantes dans les deux ans qui suivent.
        let premier = hasard.entre(jours.len());
        for k in 0..nombre {
            let suivant = premier + hasard.entre(500);
            let jour = if k == 0 { premier } else if suivant < jours.len() { suivant } else { hasard.entre(jours.len()) };
            let creneau = hasard.entre(14);
            let debut = format!("{}T{:02}:{:02}", jours[jour], 8 + creneau * 3 / 4, [0, 45, 30, 15][creneau % 4]);
            rendez_vous.push((debut, patient));
        }
    }
    rendez_vous.sort();

    let mut deja_venus = vec![false; nombre_patients];
    let jour_meme = aujourdhui.to_string();
    let quinze_jours = Date::depuis_jours_unix(aujourdhui.jours_unix() - 15).to_string();
    let deux_mois = Date::depuis_jours_unix(aujourdhui.jours_unix() - 60).to_string();
    let depart_seances = Instant::now();
    for (rang, (debut, patient)) in rendez_vous.iter().enumerate() {
        let premiere = !deja_venus[*patient];
        deja_venus[*patient] = true;
        let gratuite = hasard.sur_cent(3);
        let mut valeurs = Map::new();
        valeurs.insert("mesures".into(), json!({ "taille": 150 + hasard.entre(45), "poids": 45 + hasard.entre(50) }));
        valeurs.insert("douleur_avant".into(), json!(3 + hasard.entre(7)));
        valeurs.insert("motif".into(), document(hasard.choisir(&MOTIFS)));
        valeurs.insert("tests".into(), document(hasard.choisir(&TESTS)));
        valeurs.insert("traitements".into(), document(hasard.choisir(&TRAITEMENTS)));
        valeurs.insert("douleur_apres".into(), json!(hasard.entre(4)));
        let saisie = SaisieSeance {
            debut: debut.clone(),
            modele_id: modele.id.clone(),
            modele_version: modele.version,
            type_seance: if premiere { TypeSeance::Premiere } else if hasard.sur_cent(4) { TypeSeance::Urgence } else { TypeSeance::Suivi },
            valeurs,
            facturation: if gratuite { Facturation::Gratuit } else { Facturation::AFacturer },
            commentaire_gratuit: if gratuite { "Séance de contrôle offerte".into() } else { String::new() },
            ..Default::default()
        };
        let seance = seances::creer(base, &ids[*patient], &saisie).unwrap();
        let date = &debut[..10];
        // Les séances des quinze derniers jours ne sont pas toutes facturées : il en reste à facturer.
        let a_facturer = !gratuite && (date < quinze_jours.as_str() || (date < jour_meme.as_str() && hasard.sur_cent(70)));
        if a_facturer {
            // Quelques factures récentes attendent leur règlement ; presque toutes les anciennes sont réglées.
            let impayee = if date >= deux_mois.as_str() { hasard.sur_cent(8) } else { hasard.suivant() % 1000 < 2 };
            let reglement = (!impayee).then(|| SaisieReglement {
                moyen: *hasard.choisir(&[Moyen::Carte, Moyen::Carte, Moyen::Cheque, Moyen::Especes, Moyen::Virement]),
                montant_centimes: ligne.prix_unitaire_centimes,
                encaisse_le: date.to_owned(),
                ..Default::default()
            });
            facturation::facturer_seance(base, &seance.id, std::slice::from_ref(&ligne), reglement.as_ref(), date).unwrap();
        }
        par_lots(base, &mut battement, rang);
    }
    base.connexion().execute_batch("COMMIT").unwrap();
    eprintln!("\n{nombre_seances} séances en {:.1} s", depart_seances.elapsed().as_secs_f64());
    base.connexion().query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(())).unwrap();
    let taille = std::fs::metadata(cabinet.chemin_base()).map(|m| m.len()).unwrap_or(0);
    println!(
        "Cabinet fictif créé dans {} en {:.0} s : {nombre_patients} patients, {nombre_seances} séances, base de {} Mo.",
        dossier.display(),
        depart.elapsed().as_secs_f64(),
        taille / 1_000_000
    );
}

/// Chronomètre l'opération : le meilleur de trois essais, comme une page affichée une deuxième fois,
/// et le premier, comme une page affichée juste après l'ouverture.
fn chrono<T>(libelle: &str, mut operation: impl FnMut() -> T, detail: impl Fn(&T) -> String) {
    let mut durees = Vec::new();
    let mut resultat = None;
    for _ in 0..3 {
        let debut = Instant::now();
        resultat = Some(operation());
        durees.push(debut.elapsed());
    }
    let meilleur = durees.iter().min().unwrap();
    println!(
        "{libelle:<46} {:>7.1} ms (premier essai {:>7.1} ms)  {}",
        meilleur.as_secs_f64() * 1000.0,
        durees[0].as_secs_f64() * 1000.0,
        detail(resultat.as_ref().unwrap())
    );
}

fn mesurer(dossier: &Path) {
    let cabinet = Cabinet::new(dossier);
    let debut = Instant::now();
    let ouvert = cabinet.ouvrir_avec_mot_de_passe(MOT_DE_PASSE).expect("ouverture du cabinet fictif");
    println!("{:<46} {:>7.1} ms", "Ouverture avec le mot de passe", debut.elapsed().as_secs_f64() * 1000.0);
    let base = &ouvert.base;
    let taille = std::fs::metadata(cabinet.chemin_base()).map(|m| m.len()).unwrap_or(0);
    println!("Base : {} Mo", taille / 1_000_000);

    let aujourdhui = osteosphere_core::horloge::paris(osteosphere_core::base::maintenant()).0;
    let jour = aujourdhui.to_string();
    let lundi = Date::depuis_jours_unix(aujourdhui.jours_unix() - (aujourdhui.jours_unix() + 3).rem_euclid(7)).to_string();
    let mois = format!("{}-01", &jour[..7]);
    let an = format!("{}-01-01", &jour[..4]);
    let fin_an = format!("{}-12-31", &jour[..4]);

    chrono("Liste des patients (cœur)", || patients::lister(base).unwrap(), |l| {
        format!("{} patients, {} Ko en JSON", l.len(), serde_json::to_vec(l).unwrap().len() / 1000)
    });
    let liste = patients::lister(base).unwrap();
    let suivis: Vec<&str> = liste.iter().filter(|p| p.seances >= 10).map(|p| p.id.as_str()).take(5).collect();
    for id in suivis {
        chrono(
            "Dossier d'un patient suivi",
            || {
                (
                    patients::lire(base, id).unwrap(),
                    antecedents::lister(base, id).unwrap(),
                    seances::lister_patient(base, id).unwrap(),
                    facturation::du_patient(base, id).unwrap(),
                )
            },
            |(_, a, s, f)| format!("{} antécédents, {} séances, {} factures", a.len(), s.len(), f.len()),
        );
    }
    chrono("Séances du jour", || seances::lister_periode(base, &jour, &jour).unwrap(), |s| format!("{} séances", s.len()));
    chrono("Séances de la semaine", || seances::lister_periode(base, &lundi, &jour).unwrap(), |s| format!("{} séances", s.len()));
    chrono("Séances du mois", || seances::lister_periode(base, &mois, &jour).unwrap(), |s| format!("{} séances", s.len()));
    chrono("Séances à facturer", || seances::lister_a_facturer(base).unwrap(), |s| format!("{} séances", s.len()));
    chrono("Dernières séances", || seances::dernieres(base, &format!("{jour}T23:59"), 8).unwrap(), |s| format!("{} séances", s.len()));
    chrono("Factures du mois", || facturation::lister(base, &mois, &jour).unwrap(), |f| format!("{} factures", f.len()));
    chrono("Factures de l'année", || facturation::lister(base, &an, &fin_an).unwrap(), |f| format!("{} factures", f.len()));
    chrono("Paiements en attente", || facturation::en_attente(base).unwrap(), |f| format!("{} factures", f.len()));
    chrono("Recettes de l'année", || facturation::recettes(base, &an, &fin_an).unwrap(), |r| format!("{} lignes", r.len()));
    chrono("Statistiques de l'année", || statistiques::calculer(base, &an, &fin_an, BaseChiffre::Encaissement).unwrap(), |_| String::new());
    chrono("Statistiques sur dix ans", || statistiques::calculer(base, "2016-01-01", &fin_an, BaseChiffre::Facture).unwrap(), |_| {
        String::new()
    });
    chrono("Accueil (blocs et pense-bêtes)", || accueil::lire(base).unwrap(), |_| String::new());
    let premier = liste.first().map(|p| p.id.clone()).unwrap_or_default();
    chrono("Contenu d'un dossier pour l'export", || dossiers::contenu(base, &premier).unwrap(), |_| String::new());

    // La sauvegarde automatique ne retient le cabinet que le temps de figer la base ; la copie suit.
    let essai = dossier.join("mesure-sauvegarde");
    let secours = cabinet.enveloppe_secours().unwrap();
    let debut = Instant::now();
    let lecteur = cabinet.second_acces(&ouvert).unwrap();
    let instantane = sauvegardes::figer(base, lecteur, &cabinet.chemin_base(), &secours, "mesure", osteosphere_core::base::maintenant()).unwrap();
    println!("{:<46} {:>7.1} ms", "Sauvegarde : cabinet retenu", debut.elapsed().as_secs_f64() * 1000.0);
    let debut = Instant::now();
    let fichier = instantane.ecrire(&essai).unwrap();
    println!("{:<46} {:>7.1} ms  {} Mo", "Sauvegarde : copie, cabinet utilisable", debut.elapsed().as_secs_f64() * 1000.0, fichier.taille / 1_000_000);
    let _ = std::fs::remove_dir_all(&essai);
}
