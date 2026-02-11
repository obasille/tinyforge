// cspell:language en,fr
import {
  drawSprite,
  randomRange,
  s,
  warn,
} from "../../sdk";

import { trouvePointDepart } from "./level";
import { donneProchaineCaseCheminBFS } from "./pathfinding";
import {
  casesCiblesCrocos,
  casesValidesCrocos,
  Croco,
  CROCO_DEPL_DELAI,
  Direction,
  HAUTEUR_GRILLE,
  INVALIDE,
  INVALIDE_POS,
  joueur,
  LARGEUR_GRILLE,
  NB_CROCOS,
  TAILLE_CASE,
} from "./types";
import {
  deltaDirX,
  deltaDirY,
  donneDir,
} from "./utils";

export function initCroco(index: u8, croco: Croco, couleur: u32): void {
  const pos = trouvePointDepart(couleur);
  if (pos == INVALIDE_POS) {
    warn("Crocodile " + index.toString() + " non trouvé");
    croco.x = INVALIDE;
    croco.y = INVALIDE;
    croco.dir = Direction.IMMOBILE as u8;
    return;
  }
  croco.x = (pos & 0xff) as u8;
  croco.y = ((pos >> 8) & 0xff) as u8;
  croco.dir = Direction.IMMOBILE as u8;
  croco.gamelleX = INVALIDE;
  croco.gamelleY = INVALIDE;
  croco.gamelleRemplie = 0; // Gamelles vides au départ
  croco.attaque = 0;
  croco.minuteurDepl = 0;
  croco.targetX = INVALIDE;
  croco.targetY = INVALIDE;
}

export function choisiNouvelleCible(croco: Croco, cases: u16[]): void {
  if (cases.length == 0) {
    croco.targetX = INVALIDE;
    croco.targetY = INVALIDE;
    return;
  }
  
  // Choisir une case aléatoire différente de la position actuelle si possible
  let tentatives = 0;
  let pos: u16;
  do {
    const idx = randomRange(cases.length);
    pos = cases[idx];
    tentatives++;
  } while (tentatives < 10 && cases.length > 1 && 
           (pos & 0xff) == croco.x && ((pos >> 8) & 0xff) == croco.y);
             
  croco.targetX = (pos & 0xff) as u8;
  croco.targetY = ((pos >> 8) & 0xff) as u8;
}

export function déplaceCroco(croco: Croco, indexCroco: i32): void {
  // Si en mode attaque, cibler le joueur
  if (croco.attaque == 1) {
    croco.targetX = joueur.x;
    croco.targetY = joueur.y;
  } else {
    // Si pas de cible ou cible atteinte, choisir une nouvelle cible
    if (croco.targetX == INVALIDE || (croco.x == croco.targetX && croco.y == croco.targetY)) {
      choisiNouvelleCible(croco, casesCiblesCrocos[indexCroco]);
      if (croco.targetX == INVALIDE) {
        croco.dir = Direction.IMMOBILE as u8;
        return;
      }
    }
  }

  // Trouve le chemin le plus court vers la cible
  const prochaineCase = donneProchaineCaseCheminBFS(croco.x, croco.y, croco.targetX, croco.targetY);
  
  if (prochaineCase == INVALIDE_POS) {
    // Pas de chemin trouvé, choisir une nouvelle cible
    choisiNouvelleCible(croco, casesCiblesCrocos[indexCroco]);
    croco.dir = Direction.IMMOBILE as u8;
    return;
  }
  
  const prochainX = (prochaineCase & 0xff) as i32;
  const prochainY = ((prochaineCase >> 8) & 0xff) as i32;
  
  // Vérifie que le prochain pas est une case valide pour ce croco
  if (!casesValidesCrocos[indexCroco].includes(prochaineCase)) {
    // La case n'est pas valide, choisir une nouvelle cible
    choisiNouvelleCible(croco, casesCiblesCrocos[indexCroco]);
    croco.dir = Direction.IMMOBILE as u8;
    return;
  }

  // Calcule la direction pour atteindre la prochaine case
  const dx = prochainX - (croco.x as i32);
  const dy = prochainY - (croco.y as i32);
  const dir = donneDir(dx, dy);
  
  // Déplace le crocodile
  croco.x = prochainX as u8;
  croco.y = prochainY as u8;
  croco.dir = dir;
}

export function dessineCroco(croco: Croco): void {
  let renderX = croco.x as f32;
  let renderY = croco.y as f32;
  if (croco.dir != Direction.IMMOBILE && croco.minuteurDepl > 0) {
    const délai = croco.attaque == 1
      ? ((CROCO_DEPL_DELAI / 2) as i32)
      : (CROCO_DEPL_DELAI as i32);
    if (délai > 0) {
      const frac = (croco.minuteurDepl as f32) / (délai as f32);
      const dx = deltaDirX(croco.dir) as f32;
      const dy = deltaDirY(croco.dir) as f32;
      renderX -= dx * frac;
      renderY -= dy * frac;
      if (renderX < 0.0) renderX += LARGEUR_GRILLE as f32;
      else if (renderX >= (LARGEUR_GRILLE as f32)) renderX -= LARGEUR_GRILLE as f32;
      if (renderY < 0.0) renderY += HAUTEUR_GRILLE as f32;
      else if (renderY >= (HAUTEUR_GRILLE as f32)) renderY -= HAUTEUR_GRILLE as f32;
    }
  }
  const baseX = (renderX * (TAILLE_CASE as f32)) as i32;
  const baseY = (renderY * (TAILLE_CASE as f32)) as i32;
  const sprite = croco.attaque == 1 ? s("crocodile_bloody") : s("crocodile");
  drawSprite(sprite, baseX, baseY);
}

export function trouveCrocoPourGamelle(x: u8, y: u8): u8 {
  const gx = x as i32;
  const gy = y as i32;

  const directionX = new StaticArray<i32>(4);
  const directionY = new StaticArray<i32>(4);
  directionX[0] = 0;  directionY[0] = -1;
  directionX[1] = 0;  directionY[1] = 1;
  directionX[2] = -1; directionY[2] = 0;
  directionX[3] = 1;  directionY[3] = 0;

  for (let i: i32 = 0; i < 4; i++) {
    const nx = gx + directionX[i];
    const ny = gy + directionY[i];
    if (nx < 0 || ny < 0 || nx >= LARGEUR_GRILLE || ny >= HAUTEUR_GRILLE) continue;
    
    const pos = ((ny as u16) << 8) | (nx as u16);
    
    // Verifie si cette position est dans les cases valides de l'un des crocos
    for (let crocoIdx: i32 = 0; crocoIdx < NB_CROCOS; crocoIdx++) {
      if (casesValidesCrocos[crocoIdx].includes(pos)) {
        return crocoIdx as u8;
      }
    }
  }
  
  return INVALIDE;
}
