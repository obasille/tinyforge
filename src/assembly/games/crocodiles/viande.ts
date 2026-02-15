// cspell:language en,fr
import { drawSprite, s, warni } from "../../sdk";

import { trouveCrocoPourGamelle } from "./croco";
import { trouveNiemePoint } from "./level";
import {
  Couleurs,
  donneCroco,
  donneViande,
  INVALIDE,
  INVALIDE_POS,
  joueur,
  NB_CROCOS,
  TAILLE_CASE,
} from "./types";

// === Viandes ===

export function doneViandePos(index: u8): u16 {
  const v = donneViande(index);
  return ((v.y as u16) << 8) | (v.x as u16);
}

export function metViandePos(index: u8, x: u8, y: u8): void {
  const v = donneViande(index);
  v.x = x;
  v.y = y;
}

export function initViande(index: u8): void {
  const pos = trouveNiemePoint(Couleurs.Viande, index as i32);
  if (pos == INVALIDE_POS) {
    warni("Viande {} non trouvée", index);
    metViandePos(index, INVALIDE, INVALIDE);
    return;
  }
  metViandePos(index, (pos & 0xff) as u8, ((pos >> 8) & 0xff) as u8);
}

export function ramasseViande(jx: u8, jy: u8): void {
  if (joueur.viandePortee != INVALIDE) return;
  for (let i: u8 = 0; i < 3; i++) {
    const pos = doneViandePos(i);
    const vx = (pos & 0xff) as u8;
    const vy = ((pos >> 8) & 0xff) as u8;
    if (vx == jx && vy == jy && vx != INVALIDE) {
      joueur.viandePortee = i;
      metViandePos(i, INVALIDE, INVALIDE);
      return;
    }
  }
}

export function dessineViande(x: u8, y: u8): void {
  // Ne dessine pas si la position est invalide
  if (x == INVALIDE || y == INVALIDE) return;
  const baseX = (x as i32) * TAILLE_CASE;
  const baseY = (y as i32) * TAILLE_CASE;
  drawSprite(s("meat"), baseX, baseY);
}

// === Gamelles ===

export function assigneGamelle(index: u8): void {
  const pos = trouveNiemePoint(Couleurs.Gamelle, index as i32);
  if (pos == INVALIDE_POS) {
    warni("Gamelle {} non trouvée", index);
    return;
  }
  const gx = (pos & 0xff) as u8;
  const gy = ((pos >> 8) & 0xff) as u8;
  const idx = trouveCrocoPourGamelle(gx, gy);
  if ((idx as i32) < NB_CROCOS) {
    const croco = donneCroco(idx);
    croco.gamelleX = gx;
    croco.gamelleY = gy;
  } else {
    warni("Gamelle {} sans croco associé", index);
  }
}

export function deposeViande(jx: u8, jy: u8): void {
  if (joueur.viandePortee == INVALIDE) return;
  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    const croco = donneCroco(i);
    if (
      croco.gamelleX == jx &&
      croco.gamelleY == jy &&
      croco.gamelleRemplie == 0
    ) {
      croco.gamelleRemplie = 1;
      joueur.viandePortee = INVALIDE;
      return;
    }
  }
}

export function dessineGamelle(x: u8, y: u8, remplie: u8): void {
  // Ne dessine pas si la position est invalide
  if (x == INVALIDE || y == INVALIDE) return;
  const baseX = (x as i32) * TAILLE_CASE;
  const baseY = (y as i32) * TAILLE_CASE;
  drawSprite(s("plate"), baseX, baseY);

  // Dessiner la viande sur la gamelle si elle est remplie
  if (remplie == 1) {
    drawSprite(s("meat"), baseX, baseY);
  }
}
