// cspell:language en,fr
import { c, fillRect, randomRange } from "../../sdk";

import { litCouleurCase } from "./level";
import {
  Couleurs,
  EtatJeu,
  donnePiège,
  HAUTEUR_GRILLE,
  INVALIDE,
  INVINCIBLE_TICKS,
  jeu,
  joueur,
  LARGEUR_GRILLE,
  NB_PIÈGES,
  PIÈGE_MAX_TICKS,
  PIÈGE_MIN_TICKS,
  Piège,
  TAILLE_CASE,
} from "./types";

export function initPiège(index: u8): void {
  const piège = donnePiège(index);

  // Trouve le Nième pixel de couleur Piège
  let count: i32 = 0;
  for (let y: i32 = 0; y < HAUTEUR_GRILLE; y++) {
    for (let x: i32 = 0; x < LARGEUR_GRILLE; x++) {
      if (litCouleurCase(x, y) == Couleurs.Piège) {
        if (count == (index as i32)) {
          piège.x = x as u8;
          piège.y = y as u8;
          piège.actif = 0; // Commence désactivé
          piège.present = 1;
          // Timer aléatoire initial entre 2 et 5 secondes
          piège.timer = (PIÈGE_MIN_TICKS +
            randomRange((PIÈGE_MAX_TICKS - PIÈGE_MIN_TICKS) as i32)) as u16;
          return;
        }
        count++;
      }
    }
  }

  // Pas de piège trouvé à cet index
  piège.x = INVALIDE;
  piège.y = INVALIDE;
  piège.actif = 0;
  piège.present = 0;
  piège.timer = 0;
}

export function majPièges(): void {
  for (let i: i32 = 0; i < NB_PIÈGES; i++) {
    const piège = donnePiège(i);
    if (!piège.present) continue;

    if (piège.timer > 0) {
      piège.timer--;
    } else {
      // Change l'état du piège
      piège.actif = piège.actif == 1 ? 0 : 1;
      // Nouveau timer aléatoire entre 2 et 5 secondes
      piège.timer = (PIÈGE_MIN_TICKS +
        randomRange((PIÈGE_MAX_TICKS - PIÈGE_MIN_TICKS) as i32)) as u16;
    }
  }
}

export function verifieCollisionPièges(): void {
  if (joueur.invincible > 0) return;

  for (let i: i32 = 0; i < NB_PIÈGES; i++) {
    const piège = donnePiège(i);
    if (!piège.present || !piège.actif) continue;

    if (joueur.x == piège.x && joueur.y == piège.y) {
      // Perte d'une vie
      if (jeu.vies > 0) jeu.vies--;
      joueur.invincible = INVINCIBLE_TICKS;
      if (jeu.vies == 0) {
        jeu.etat = EtatJeu.FIN as u8;
      }
      return;
    }
  }
}

export function dessinePiège(piège: Piège): void {
  if (!piège.present || piège.x == INVALIDE) return;
  const baseX = (piège.x as i32) * TAILLE_CASE;
  const baseY = (piège.y as i32) * TAILLE_CASE;

  if (piège.actif) {
    // Piège actif - dessine en rouge
    fillRect(baseX, baseY, TAILLE_CASE, TAILLE_CASE, c(0xff0000));
  } else {
    // Piège inactif - dessine en gris
    fillRect(baseX, baseY, TAILLE_CASE, TAILLE_CASE, c(0x808080));
  }
}
