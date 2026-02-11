// cspell:language en,fr
import {
  drawSpriteScaled,
  getLastSpriteAddress,
  getLastSpriteHeight,
  getLastSpriteWidth,
  readSpriteInfo,
} from "../../sdk";

import { Couleurs, HAUTEUR_GRILLE, LARGEUR_GRILLE } from "./types";

let adresseNiveau: usize = 0;
let levelSpriteId: i32 = -1;

export function chargeNiveau(spriteId: i32): boolean {
  if (!readSpriteInfo(spriteId)) return false;
  const largeur = getLastSpriteWidth();
  const hauteur = getLastSpriteHeight();
  adresseNiveau = getLastSpriteAddress();
  if (largeur != LARGEUR_GRILLE || hauteur != HAUTEUR_GRILLE) {
    // warn("Taille niveau != grille");
    return false;
  }
  levelSpriteId = spriteId;
  return true;
}

export function litCouleurCase(x: i32, y: i32): u32 {
  return load<u32>(adresseNiveau + (y * LARGEUR_GRILLE + x) * 4);
}

export function caseCouleur(x: i32, y: i32, couleur: u32): bool {
  if (x >= 0 && x < LARGEUR_GRILLE && y >= 0 && y < HAUTEUR_GRILLE) {
    const pixel = litCouleurCase(x, y);
    return pixel == couleur;
  }
  return false;
}

export function peutBouger(x: i32, y: i32): bool {
  if (x >= 0 && x < LARGEUR_GRILLE && y >= 0 && y < HAUTEUR_GRILLE) {
    const pixel = litCouleurCase(x, y);
    if (pixel != Couleurs.Mur) {
      return true;
    }
  }
  return false;
}

export function dessineGrille(): void {
  drawSpriteScaled(levelSpriteId, 0, 0, 16, 16);
}

export function trouvePointDepart(couleur: u32): u16 {
  for (let y: i32 = 0; y < HAUTEUR_GRILLE; y++) {
    for (let x: i32 = 0; x < LARGEUR_GRILLE; x++) {
      const pixel = litCouleurCase(x, y);
      if (pixel == couleur) {
        return ((y as u16) << 8) | (x as u16);
      }
    }
  }
  return 0xffff; // INVALIDE_POS
}

export function trouveNiemePoint(couleur: u32, index: i32): u16 {
  let compteur: i32 = 0;
  for (let y: i32 = 0; y < HAUTEUR_GRILLE; y++) {
    for (let x: i32 = 0; x < LARGEUR_GRILLE; x++) {
      const pixel = litCouleurCase(x, y);
      if (pixel == couleur) {
        if (compteur == index) {
          return ((y as u16) << 8) | (x as u16);
        }
        compteur++;
      }
    }
  }
  return 0xffff; // INVALIDE_POS
}

export function trouveCasesCouleur(couleur: u32, cases: u16[]): void {
  for (let y: i32 = 0; y < HAUTEUR_GRILLE; y++) {
    for (let x: i32 = 0; x < LARGEUR_GRILLE; x++) {
      if (litCouleurCase(x, y) == couleur) {
        cases.push(((y as u16) << 8) | (x as u16));
      }
    }
  }
}
