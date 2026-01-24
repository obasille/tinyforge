// cspell:language en,fr
// CROCODILES - Jeu TinyForge
// Poursuite façon Pacman sur un écran unique avec une grille 16x16 pixels.
// Vous contrôlez une tête cubique tandis que les crocodiles patrouillent le labyrinthe.
// Évitez les crocodiles; appuyez sur START pour redémarrer après game over.

import {
  Button,
  RAM_START,
  WIDTH,
  HEIGHT,
  buttonDown,
  buttonPressed,
  c,
  clearFramebuffer,
  drawStartMessageBox,
  drawRect,
  fillRect,
  randomRange,
  drawSpriteScaled,
  s,
  readSpriteInfo,
  getLastSpriteWidth,
  getLastSpriteAddress,
  getLastSpriteHeight,
} from "../sdk";

// === Constantes ===
const CASE_DIM_PIXELS: i32 = 16;
const LARGEUR_GRILLE: i32 = WIDTH / CASE_DIM_PIXELS;
const HAUTEUR_GRILLE: i32 = HEIGHT / CASE_DIM_PIXELS;

const PLAYER_DEPL_DELAI: u8 = 6;
const CROC_DEPL_DELAI: u8 = 10;

const COULEUR_PLAYER: u32 = c(0xf2c9a0);
const COULEUR_PLAYER_EYE: u32 = c(0x1b1b1b);
const COULEUR_CROC: u32 = c(0x1c8b3a);
const COULEUR_CROC_EYE: u32 = c(0xffffff);
const COULEUR_CROC_TOOTH: u32 = c(0xe6e6e6);

const COULEUR_FOND: u32 = c(0x0a0a10);
const COULEUR_GRILLE_SOMBRE: u32 = c(0x141428);
const COULEUR_GRILLE_CLAIR: u32 = c(0x1c1c36);
const COULEUR_MUR: u32 = c(0x0000ff);

enum Direction {
  HAUT = 0,
  DROITE = 1,
  BAS = 2,
  GAUCHE = 3,
}

enum EtatJeu {
  EN_COURS = 0,
  PARTIE_TERMINEE = 1,
}

// === Système de variables en RAM ===
@unmanaged
class Variables {
  joueurX: u8; // 0
  joueurY: u8; // 1
  etat: u8; // 2
  minuteurMouvementJoueur: u8; // 3
  minuteurMouvementCroc: u8; // 4
  croc0X: u8; // 5
  croc0Y: u8; // 6
  croc0Dir: u8; // 7
  croc1X: u8; // 8
  croc1Y: u8; // 9
  croc1Dir: u8; // 10
  croc2X: u8; // 11
  croc2Y: u8; // 12
  croc2Dir: u8; // 13
}

const vars = changetype<Variables>(RAM_START);

// === Fonctions auxiliaires ===

function peutBouger(x: i32, y: i32): bool {
  if (x >= 0 && x < LARGEUR_GRILLE && y >= 0 && y < HAUTEUR_GRILLE) {
    if (readSpriteInfo(s("level1"))) {
      const width = getLastSpriteWidth();
      const height = getLastSpriteHeight();
      const addr = getLastSpriteAddress();
      const pixel = load<u32>(addr + (y * width + x) * 4);
      if (pixel != COULEUR_MUR) {
        return true;
      }
    }
  }
  return false;
}

function deltaDirX(dir: u8): i32 {
  if (dir == Direction.GAUCHE) return -1;
  if (dir == Direction.DROITE) return 1;
  return 0;
}

function deltaDirY(dir: u8): i32 {
  if (dir == Direction.HAUT) return -1;
  if (dir == Direction.BAS) return 1;
  return 0;
}

function choisisDirValide(x: u8, y: u8, dir: u8): u8 {
  let prochDir = dir;
  let essais: i32 = 0;
  while (essais < 4) {
    const nx = (x as i32) + deltaDirX(prochDir);
    const ny = (y as i32) + deltaDirY(prochDir);
    if (peutBouger(nx, ny)) return prochDir;
    prochDir = randomRange(4) as u8;
    essais++;
  }
  return dir;
}

function deplaceCroc(x: u8, y: u8, dir: u8): u32 {
  const prochDir = choisisDirValide(x, y, dir);
  const nx = ((x as i32) + deltaDirX(prochDir)) as u8;
  const ny = ((y as i32) + deltaDirY(prochDir)) as u8;
  return ((prochDir as u32) << 16) | ((ny as u32) << 8) | (nx as u32);
}

function verifiePositionJoueur(px: u8, py: u8): bool {
  return (
    (vars.croc0X == px && vars.croc0Y == py) ||
    (vars.croc1X == px && vars.croc1Y == py) ||
    (vars.croc2X == px && vars.croc2Y == py)
  );
}

function dessineGrille(): void {
  // for (let y: i32 = 0; y < HAUTEUR_GRILLE; y++) {
  //   for (let x: i32 = 0; x < LARGEUR_GRILLE; x++) {
  //     const couleur = ((x + y) & 1) == 0 ? COULEUR_GRILLE_SOMBRE : COULEUR_GRILLE_CLAIR;
  //     fillRect(x * CASE_DIM_PIXELS, y * CASE_DIM_PIXELS, CASE_DIM_PIXELS, CASE_DIM_PIXELS, couleur);
  //   }
  // }
  drawSpriteScaled(s("level1"), 0, 0, 16, 16);
}

function dessineTeteJoueur(x: u8, y: u8): void {
  const baseX = (x as i32) * CASE_DIM_PIXELS;
  const baseY = (y as i32) * CASE_DIM_PIXELS;
  const tailleTete: i32 = 12;
  const decalage: i32 = (CASE_DIM_PIXELS - tailleTete) / 2;
  fillRect(baseX + decalage, baseY + decalage, tailleTete, tailleTete, COULEUR_PLAYER);
  drawRect(baseX + decalage, baseY + decalage, tailleTete, tailleTete, COULEUR_PLAYER_EYE);
  fillRect(baseX + decalage + 3, baseY + decalage + 4, 2, 2, COULEUR_PLAYER_EYE);
  fillRect(baseX + decalage + 7, baseY + decalage + 4, 2, 2, COULEUR_PLAYER_EYE);
}

function dessineCroco(x: u8, y: u8): void {
  const baseX = (x as i32) * CASE_DIM_PIXELS;
  const baseY = (y as i32) * CASE_DIM_PIXELS;
  fillRect(baseX + 2, baseY + 5, 12, 7, COULEUR_CROC);
  drawRect(baseX + 1, baseY + 4, 14, 9, COULEUR_CROC);
  fillRect(baseX + 4, baseY + 6, 2, 2, COULEUR_CROC_EYE);
  fillRect(baseX + 9, baseY + 6, 2, 2, COULEUR_CROC_EYE);
  fillRect(baseX + 4, baseY + 12, 2, 2, COULEUR_CROC_TOOTH);
  fillRect(baseX + 8, baseY + 12, 2, 2, COULEUR_CROC_TOOTH);
}

// === Cycle de vie ===

// Initialisation du jeu
export function init(): void {
  vars.joueurX = (LARGEUR_GRILLE / 2) as u8;
  vars.joueurY = (HAUTEUR_GRILLE / 2) as u8;
  vars.etat = EtatJeu.EN_COURS as u8;
  vars.minuteurMouvementJoueur = 0;
  vars.minuteurMouvementCroc = 0;

  vars.croc0X = 1;
  vars.croc0Y = 1;
  vars.croc0Dir = Direction.DROITE as u8;
  vars.croc1X = (LARGEUR_GRILLE - 2) as u8;
  vars.croc1Y = 1;
  vars.croc1Dir = Direction.BAS as u8;
  vars.croc2X = 1;
  vars.croc2Y = (HAUTEUR_GRILLE - 2) as u8;
  vars.croc2Dir = Direction.HAUT as u8;
}

// Mise à jour du jeu
export function update(): void {
  const etat = vars.etat;
  
  // Gestion du redémarrage : appuyer sur START après la fin de partie
  if (etat != EtatJeu.EN_COURS && buttonPressed(Button.START)) {
    init();
    return;
  }
  
  // Ne rien faire si le jeu n'est pas en cours
  if (etat != EtatJeu.EN_COURS) return;

  // Décrémenter les minuteurs de mouvement
  if (vars.minuteurMouvementJoueur > 0) vars.minuteurMouvementJoueur--;
  if (vars.minuteurMouvementCroc > 0) vars.minuteurMouvementCroc--;

  // Gestion du mouvement du joueur
  if (vars.minuteurMouvementJoueur == 0) {
    let dx: i32 = 0;
    let dy: i32 = 0;
    
    // Détection des touches directionnelles
    if (buttonDown(Button.LEFT)) dx = -1;
    else if (buttonDown(Button.RIGHT)) dx = 1;
    else if (buttonDown(Button.UP)) dy = -1;
    else if (buttonDown(Button.DOWN)) dy = 1;

    // Si une direction est pressée, tenter de déplacer le joueur
    if (dx != 0 || dy != 0) {
      const nx = vars.joueurX + dx;
      const ny = vars.joueurY + dy;
      
      // Déplacer uniquement si la position est valide
      if (peutBouger(nx, ny)) {
        vars.joueurX = nx as u8;
        vars.joueurY = ny as u8;
      }
      
      // Réinitialiser le minuteur de mouvement
      vars.minuteurMouvementJoueur = PLAYER_DEPL_DELAI;
    }
  }

  // if (vars.minuteurMouvementCroc == 0) {
  //   let empaquete = deplaceCroc(vars.croc0X, vars.croc0Y, vars.croc0Dir);
  //   vars.croc0X = (empaquete & 0xff) as u8;
  //   vars.croc0Y = ((empaquete >> 8) & 0xff) as u8;
  //   vars.croc0Dir = ((empaquete >> 16) & 0xff) as u8;

  //   empaquete = deplaceCroc(vars.croc1X, vars.croc1Y, vars.croc1Dir);
  //   vars.croc1X = (empaquete & 0xff) as u8;
  //   vars.croc1Y = ((empaquete >> 8) & 0xff) as u8;
  //   vars.croc1Dir = ((empaquete >> 16) & 0xff) as u8;

  //   empaquete = deplaceCroc(vars.croc2X, vars.croc2Y, vars.croc2Dir);
  //   vars.croc2X = (empaquete & 0xff) as u8;
  //   vars.croc2Y = ((empaquete >> 8) & 0xff) as u8;
  //   vars.croc2Dir = ((empaquete >> 16) & 0xff) as u8;

  //   vars.minuteurMouvementCroc = CROC_DEPL_DELAI;
  // }

  if (verifiePositionJoueur(vars.joueurX, vars.joueurY)) {
    vars.etat = EtatJeu.PARTIE_TERMINEE as u8;
  }
}

// Dessine la grille et les crocodiles
export function draw(): void {
  clearFramebuffer(COULEUR_FOND);

  dessineGrille();

  // dessineCroco(vars.croc0X, vars.croc0Y);
  // dessineCroco(vars.croc1X, vars.croc1Y);
  // dessineCroco(vars.croc2X, vars.croc2Y);

  dessineTeteJoueur(vars.joueurX, vars.joueurY);

  if (vars.etat == EtatJeu.PARTIE_TERMINEE) {
    drawStartMessageBox("DEVORÉ !", c(0x2a1a1a), c(0xffaa00));
  }
}
