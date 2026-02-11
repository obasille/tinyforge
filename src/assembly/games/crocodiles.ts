// cspell:language en,fr
// CROCODILES - Jeu TinyForge
// Ramassez les viandes et déposez-les dans les gamelles pour nourrir les crocodiles.
// Objectif : Remplir les 3 gamelles pour gagner !
// Attention : Évitez de vous faire attraper par les crocodiles qui patrouillent le niveau.
// Contrôles : Flèches pour se déplacer, START pour redémarrer.

import {
  Button,
  buttonPressed,
  drawSprite,
  drawStartMessageBox,
  fillRect,
  s,
  warn,
  WIDTH,
} from "../sdk";

// Imports des modules
import {
  casesCiblesCrocoRouge,
  casesCiblesCrocoVert,
  casesCiblesCrocoViolet,
  casesValidesCrocoRouge,
  casesValidesCrocos,
  casesValidesCrocoVert,
  casesValidesCrocoViolet,
  Couleurs,
  couleursCrocos,
  CROCO_DEPL_DELAI,
  EtatJeu,
  HAUTEUR_GRILLE,
  INVINCIBLE_TICKS,
  jeu,
  joueur,
  LARGEUR_GRILLE,
  lesCrocos,
  lesPièges,
  lesTunnels,
  lesViandes,
  NB_CROCOS,
  NB_PIEGES,
  NB_TUNNELS,
  TAILLE_CASE,
  TUNNEL_ANIM_TICKS,
  TUNNEL_CYCLE_TICKS,
  VIES_DEPART,
} from "./crocodiles/types";

import {
  dessineCroco,
  déplaceCroco,
  initCroco,
} from "./crocodiles/croco";
import {
  caseCouleur,
  chargeNiveau,
  dessineGrille,
  trouveCasesCouleur,
} from "./crocodiles/level";
import { construireCasesValides } from "./crocodiles/pathfinding";
import {
  dessinePiège,
  initPiège,
  majPièges,
  verifieCollisionPièges,
} from "./crocodiles/piege";
import {
  deplaceJoueur,
  dessineTeteJoueur,
  initJoueur,
} from "./crocodiles/player";
import {
  dessineTunnel,
  essaieTeleportTunnel,
  initTunnel,
  majOuvertureTunnels,
  majTunnelAnimJoueur,
} from "./crocodiles/tunnel";
import { verifiePositionJoueur } from "./crocodiles/utils";
import {
  assigneGamelle,
  deposeViande,
  dessineGamelle,
  dessineViande,
  initViande,
  ramasseViande
} from "./crocodiles/viande";

// === Cycle de vie ===

// Initialisation du jeu
export function init(): void {
  // Charge le niveau
  if (!chargeNiveau(s("level1"))) {
    warn("Échec du chargement du niveau");
    return;
  }

  // Trouve toutes les cases colorées pour chaque croco
  trouveCasesCouleur(Couleurs.CrocoRouge, casesCiblesCrocoRouge);
  trouveCasesCouleur(Couleurs.CrocoViolet, casesCiblesCrocoViolet);
  trouveCasesCouleur(Couleurs.CrocoVert, casesCiblesCrocoVert);
  
  // Construit les ensembles de cases valides (sur les plus courts chemins)
  construireCasesValides(casesCiblesCrocoRouge, casesValidesCrocoRouge);
  construireCasesValides(casesCiblesCrocoViolet, casesValidesCrocoViolet);
  construireCasesValides(casesCiblesCrocoVert, casesValidesCrocoVert);

  // Initialise le joueur (après avoir construit les chemins des crocos)
  initJoueur();

  // Initialise les crocodiles
  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    const croco = lesCrocos[i];
    initCroco(i as u8, croco, couleursCrocos[i]);
  }

  // Trouve les positions des 3 viandes
  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    initViande(i as u8);
  }

  // Trouve les positions des 3 gamelles
  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    assigneGamelle(i as u8);
  }

  // Initialise les tunnels
  jeu.tunnelPhase = 0;
  jeu.tunnelTimer = TUNNEL_CYCLE_TICKS;
  for (let i: i32 = 0; i < NB_TUNNELS; i++) {
    initTunnel(i as u8);
  }

  // Initialise les pièges
  for (let i = 0; i < NB_PIEGES; i++) {
    initPiège(i as u8);
  }

  // Initialise le jeu
  jeu.etat = EtatJeu.EN_COURS as u8;
  jeu.vies = VIES_DEPART;
}

// Mise à jour du jeu
export function update(): void {
  const etat = jeu.etat;
  
  // Gestion du redémarrage : appuyer sur START après la fin de partie
  if (etat != EtatJeu.EN_COURS && buttonPressed(Button.START)) {
    init();
    return;
  }
  
  // Si le jeu est terminé, continuer à animer le mouvement du joueur
  if (etat != EtatJeu.EN_COURS) {
    if (joueur.minuteurDepl > 0) joueur.minuteurDepl--;
    return;
  }

  // Gestion de l'animation de démarrage
  if (joueur.startupDelay > 0) {
    joueur.startupDelay--;
    if (joueur.startupDelay == 0) {
      // Déclenche l'animation d'apparition (même que sortie de tunnel)
      joueur.tunnelEtat = 2;
      joueur.tunnelTimer = TUNNEL_ANIM_TICKS;
    }
    return; // Ne rien faire pendant le délai de démarrage
  }

  // Décrémenter les minuteurs de mouvement
  if (joueur.minuteurDepl > 0) joueur.minuteurDepl--;
  if (joueur.invincible > 0) joueur.invincible--;
  majPièges();
  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    if (lesCrocos[i].minuteurDepl > 0) lesCrocos[i].minuteurDepl--;
  }
  majTunnelAnimJoueur();
  majOuvertureTunnels();

  // Gestion du mouvement du joueur
  deplaceJoueur();

  if (buttonPressed(Button.A)) {
    essaieTeleportTunnel();
  }

  // Déposer/ramasser la viande si besoin
  if (joueur.tunnelEtat == 0) {
    deposeViande(joueur.x, joueur.y);
    ramasseViande(joueur.x, joueur.y);
  }

  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    const croco = lesCrocos[i];
    const npos = ((joueur.y as u16) << 8) | (joueur.x as u16);
    croco.attaque = casesValidesCrocos[i].includes(npos) ? 1 : 0;
  }

  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    const croco = lesCrocos[i];
    if (croco.minuteurDepl == 0) {
      déplaceCroco(croco, i);
      const délai =
        croco.attaque == 1 ? ((CROCO_DEPL_DELAI / 2) as u8) : CROCO_DEPL_DELAI;
      croco.minuteurDepl = délai == 0 ? 1 : délai;
    }
  }

  // Vérifier si toutes les gamelles sont remplies (victoire)
  let toutesGamellesRemplies = true;
  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    if (lesCrocos[i].gamelleRemplie == 0) {
      toutesGamellesRemplies = false;
      break;
    }
  }
  if (toutesGamellesRemplies) {
    jeu.etat = EtatJeu.VICTOIRE as u8;
  }

  // Vérifier si le joueur touche un crocodile (perte de vie)
  if (joueur.invincible == 0 && verifiePositionJoueur(joueur.x, joueur.y)) {
    if (jeu.vies > 0) jeu.vies--;
    if (jeu.vies == 0) {
      jeu.etat = EtatJeu.FIN as u8;
    } else {
      joueur.invincible = INVINCIBLE_TICKS;
    }
  }

  // Vérifier si le joueur touche un piège actif
  verifieCollisionPièges();
}

// Dessine la grille et les crocodiles
export function draw(): void {
  dessineGrille();
  // Colorie tous les cases
  for (let y: i32 = 0; y < HAUTEUR_GRILLE; y++) {
    for (let x: i32 = 0; x < LARGEUR_GRILLE; x++) {
      const estMur = caseCouleur(x, y, Couleurs.Mur);
      if (!estMur) {
        fillRect(
          x * TAILLE_CASE,
          y * TAILLE_CASE,
          TAILLE_CASE,
          TAILLE_CASE,
          Couleurs.Sol
        );
      }
    }
  }

  // Dessine les pièges
  for (let i: i32 = 0; i < NB_PIEGES; i++) {
    dessinePiège(lesPièges[i]);
  }

  // Dessine les tunnels
  for (let i: i32 = 0; i < NB_TUNNELS; i++) {
    const t = lesTunnels[i];
    if (!t.present) continue;
    dessineTunnel(t.x0, t.y0, t.ouvert);
    dessineTunnel(t.x1, t.y1, t.ouvert);
  }

  // Dessine les gamelles
  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    const croco = lesCrocos[i];
    dessineGamelle(croco.gamelleX, croco.gamelleY, croco.gamelleRemplie);
  }

  // Dessine les viandes
  for (let i: i32 = 0; i < 3; i++) {
    const v = lesViandes[i];
    dessineViande(v.x, v.y);
  }

  // Dessine les crocodiles
  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    const croco = lesCrocos[i];
    dessineCroco(croco);
  }

  // Dessine le joueur (sauf pendant le délai de démarrage)
  if (joueur.startupDelay == 0) {
    dessineTeteJoueur();
  }

  // Affiche les vies en haut à droite avec un petit bounce
  const coeurX = WIDTH - TAILLE_CASE;
  const bounce = ((joueur.invincible >> 4) & 1) == 0 ? 0 : -2;
  const pasCoeur = TAILLE_CASE + 2;
  for (let i: i32 = 0; i < (jeu.vies as i32); i++) {
    const offsetY = (i & 1) == 0 ? bounce : -bounce;
    drawSprite(s("heart"), coeurX - (i * pasCoeur), offsetY);
  }

  // Dessine les chemins possibles pour chaque croco (pour debug)
  // for (let i = 0; i < NB_CROCOS; i++) {
  //   const casesValides = casesValidesCrocos[i];
  //   for (let j = 0; j < casesValides.length; j++) {
  //     const pos = casesValides[j];
  //     const x = (pos & 0xff) as i32;
  //     const y = ((pos >> 8) & 0xff) as i32;
  //     fillRect(x * TAILLE_CASE + TAILLE_CASE / 4, y * TAILLE_CASE + TAILLE_CASE / 4, TAILLE_CASE / 2, TAILLE_CASE / 2, couleursCrocos[i]);
  //   }
  // }

  if (jeu.etat == EtatJeu.FIN) {
    drawStartMessageBox("IL VA TE MANGER...", Couleurs.MessageBoxFond, Couleurs.MessageBoxTexte);
  } else if (jeu.etat == EtatJeu.VICTOIRE) {
    drawStartMessageBox("VICTOIRE!", Couleurs.MessageBoxFondVictoire, Couleurs.MessageBoxTexteVictoire);
  }
}
