// cspell:language en,fr
import { warn, drawSprite, s } from "../../sdk";
import { 
  Viande, lesViandes, lesCrocos, NB_CROCOS,
  INVALIDE, INVALIDE_POS, Couleurs, TAILLE_CASE, joueur
} from "./types";
import { trouveNiemePoint } from "./level";
import { trouveCrocoPourGamelle } from "./croco";

// === Viandes ===

export function doneViandePos(index: u8): u16 {
  const v = lesViandes[index];
  return ((v.y as u16) << 8) | (v.x as u16);
}

export function metViandePos(index: u8, x: u8, y: u8): void {
  const v = lesViandes[index];
  v.x = x;
  v.y = y;
}

export function initViande(index: u8): void {
  const pos = trouveNiemePoint(Couleurs.Viande, index as i32);
  if (pos == INVALIDE_POS) {
    warn("Viande " + index.toString() + " non trouvée");
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
    warn("Gamelle " + index.toString() + " non trouvée");
    return;
  }
  const gx = (pos & 0xff) as u8;
  const gy = ((pos >> 8) & 0xff) as u8;
  const idx = trouveCrocoPourGamelle(gx, gy);
  if ((idx as i32) < NB_CROCOS) {
    const croco = lesCrocos[idx as i32];
    croco.gamelleX = gx;
    croco.gamelleY = gy;
  } else {
    warn("Gamelle " + index.toString() + " sans croco associé");
  }
}

export function deposeViande(jx: u8, jy: u8): void {
  if (joueur.viandePortee == INVALIDE) return;
  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    const croco = lesCrocos[i];
    if (croco.gamelleX == jx && croco.gamelleY == jy && croco.gamelleRemplie == 0) {
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
