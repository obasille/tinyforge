// cspell:language en,fr
import {
  Button,
  buttonDown,
  drawSprite,
  drawSpriteScaledDown,
  randomRange,
  s,
  warn,
} from "../../sdk";

import { peutBouger, trouveNiemePoint, comptePointsCouleur } from "./level";
import {
  Couleurs,
  Direction,
  HAUTEUR_GRILLE,
  INVALIDE,
  joueur,
  JOUEUR_DEPL_DELAI,
  LARGEUR_GRILLE,
  TAILLE_CASE,
  TUNNEL_ANIM_TICKS,
} from "./types";
import { deltaDirX, deltaDirY, donneDir } from "./utils";

export function initJoueur(): void {
  // Trouve toutes les cases avec la couleur Joueur
  const nbSpawns = comptePointsCouleur(Couleurs.Joueur);

  // Choisit une case aléatoire parmi les positions Joueur trouvées
  let spawn: u16;
  if (nbSpawns > 0) {
    const idx = randomRange(nbSpawns);
    spawn = trouveNiemePoint(Couleurs.Joueur, idx);
  } else {
    // Fallback : centre de la grille si aucune position trouvée
    warn("Aucune position Joueur trouvée dans le niveau");
    spawn =
      (((HAUTEUR_GRILLE / 2) as u16) << 8) | ((LARGEUR_GRILLE / 2) as u16);
  }

  joueur.x = (spawn & 0xff) as u8;
  joueur.y = ((spawn >> 8) & 0xff) as u8;
  joueur.viandePortee = INVALIDE;
  joueur.minuteurDepl = 0;
  joueur.invincible = 0;
  joueur.dirDepl = Direction.IMMOBILE as u8;
  joueur.tunnelEtat = 0;
  joueur.tunnelTimer = 0;
  joueur.tunnelDestX = INVALIDE;
  joueur.tunnelDestY = INVALIDE;
  joueur.startupDelay = 60;
}

export function deplaceJoueur(): void {
  if (joueur.tunnelEtat != 0) return;
  if (joueur.minuteurDepl != 0) return;
  let deplX: i32 = 0;
  let deplY: i32 = 0;

  if (buttonDown(Button.LEFT)) deplX = -1;
  else if (buttonDown(Button.RIGHT)) deplX = 1;
  else if (buttonDown(Button.UP)) deplY = -1;
  else if (buttonDown(Button.DOWN)) deplY = 1;

  if (deplX == 0 && deplY == 0) {
    joueur.dirDepl = Direction.IMMOBILE as u8;
    return;
  }

  let posX = (joueur.x as i32) + deplX;
  let posY = (joueur.y as i32) + deplY;

  if (posX == -1) posX = LARGEUR_GRILLE - 1;
  if (posX == LARGEUR_GRILLE) posX = 0;
  if (posY == -1) posY = HAUTEUR_GRILLE - 1;
  if (posY == HAUTEUR_GRILLE) posY = 0;

  if (peutBouger(posX, posY)) {
    joueur.x = posX as u8;
    joueur.y = posY as u8;
    joueur.dirDepl = donneDir(deplX, deplY);
  } else {
    joueur.dirDepl = Direction.IMMOBILE as u8;
  }

  joueur.minuteurDepl = JOUEUR_DEPL_DELAI;
}

export function dessineTeteJoueur(): void {
  let renderX = joueur.x as f32;
  let renderY = joueur.y as f32;
  // Interpoler le mouvement tant que le timer est actif
  if (joueur.minuteurDepl > 0 && joueur.dirDepl != Direction.IMMOBILE) {
    const frac = (joueur.minuteurDepl as f32) / (JOUEUR_DEPL_DELAI as f32);
    const dx = deltaDirX(joueur.dirDepl) as f32;
    const dy = deltaDirY(joueur.dirDepl) as f32;
    renderX -= dx * frac;
    renderY -= dy * frac;
    if (renderX < 0.0) renderX += LARGEUR_GRILLE as f32;
    else if (renderX >= (LARGEUR_GRILLE as f32))
      renderX -= LARGEUR_GRILLE as f32;
    if (renderY < 0.0) renderY += HAUTEUR_GRILLE as f32;
    else if (renderY >= (HAUTEUR_GRILLE as f32))
      renderY -= HAUTEUR_GRILLE as f32;
  }
  const baseX = (renderX * (TAILLE_CASE as f32)) as i32;
  const baseY = (renderY * (TAILLE_CASE as f32)) as i32;
  let alpha: u8 = 255;
  if (joueur.invincible > 0) {
    const t = (joueur.invincible as i32) & 15;
    const tri = t < 8 ? t : 15 - t;
    alpha = (128 + tri * 16) as u8;
  }
  let scaleNum: i32 = 8;
  if (joueur.tunnelEtat == 1) {
    scaleNum = ((joueur.tunnelTimer as i32) * 8) / (TUNNEL_ANIM_TICKS as i32);
  } else if (joueur.tunnelEtat == 2) {
    scaleNum =
      8 - ((joueur.tunnelTimer as i32) * 8) / (TUNNEL_ANIM_TICKS as i32);
  }
  if (scaleNum <= 0) return;
  if (scaleNum >= 8) {
    drawSprite(s("player"), baseX, baseY, false, false, alpha);
  } else {
    drawSpriteScaledDown(s("player"), baseX, baseY, scaleNum, 8);
  }

  // Dessine la viande portée au-dessus du joueur
  if (joueur.viandePortee != INVALIDE && scaleNum >= 8) {
    drawSprite(s("meat"), baseX + TAILLE_CASE / 3, baseY + TAILLE_CASE / 3);
  }
}
