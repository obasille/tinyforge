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
  drawStartMessageBox,
  drawSpriteScaled,
  s,
  readSpriteInfo,
  getLastSpriteWidth,
  getLastSpriteAddress,
  getLastSpriteHeight,
  drawSprite,
  pset,
  fillRect,
  warn,
} from "../sdk";

// === Constantes ===
const CASE_DIM_PIXELS: i32 = 16;
const LARGEUR_GRILLE: i32 = WIDTH / CASE_DIM_PIXELS;
const HAUTEUR_GRILLE: i32 = HEIGHT / CASE_DIM_PIXELS;

const JOUEUR_DEPL_DELAI: u8 = 6;
const CROCO_DEPL_DELAI: u8 = 30;

const INVALIDE: u16 = 0xffff;

enum Couleurs {
  MessageBoxFond = c(0x2a1a1a),
  MessageBoxTexte = c(0xffaa00),
  CrocoRouge = c(0xff0000),
  CrocoViolet = c(0xff00ff),
  CrocoVert = c(0x00ff00),
  Sol = c(0xe09729),
  Mur = c(0x04e5ff),
  Viande = c(0xba0b0b),
  Gamelle = c(0x583de8),
}

const NIVEAU_1: i32 = s("level1");

enum Direction {
  IMMOBILE = 0,
  HAUT = 1,
  DROITE = 2,
  BAS = 3,
  GAUCHE = 4,
}

enum EtatJeu {
  EN_COURS = 0,
  FIN = 1,
}

// === Système de variables en RAM ===
@unmanaged
class Variables {
  joueurX: u8; // 0
  joueurY: u8; // 1
  etat: u8; // 2
  minuteurDeplJoueur: u8; // 3
  minuteurDeplCroc: u8; // 4
  croco0X: u8; // 5
  croco0Y: u8; // 6
  croco0Dir: u8; // 7
  croco1X: u8; // 8
  croco1Y: u8; // 9
  croco1Dir: u8; // 10
  croco2X: u8; // 11
  croco2Y: u8; // 12
  croco2Dir: u8; // 13
  viande0X: u8; // 14
  viande0Y: u8; // 15
  viande1X: u8; // 16
  viande1Y: u8; // 17
  viande2X: u8; // 18
  viande2Y: u8; // 19
  gamelle0X: u8; // 20
  gamelle0Y: u8; // 21
  gamelle1X: u8; // 22
  gamelle1Y: u8; // 23
  gamelle2X: u8; // 24
  gamelle2Y: u8; // 25
}

const vars = changetype<Variables>(RAM_START);

// === Fonctions auxiliaires ===

function peutBouger(x: i32, y: i32): bool {
  if (x >= 0 && x < LARGEUR_GRILLE && y >= 0 && y < HAUTEUR_GRILLE) {
    if (readSpriteInfo(NIVEAU_1)) {
      const width = getLastSpriteWidth();
      const height = getLastSpriteHeight();
      const addr = getLastSpriteAddress();
      const pixel = litPixel(addr, width, x, y);
      if (pixel != Couleurs.Mur) {
        return true;
      }
    }
  }
  return false;
}

function caseCouleur(x: i32, y: i32, cc: u32): bool {
  const couleur = cc;
  if (x >= 0 && x < LARGEUR_GRILLE && y >= 0 && y < HAUTEUR_GRILLE) {
    if (readSpriteInfo(NIVEAU_1)) {
      const width = getLastSpriteWidth();
      const height = getLastSpriteHeight();
      const addr = getLastSpriteAddress();
      const pixel = litPixel(addr, width, x, y);
      return pixel == couleur;
    }
  }
  return false;
}

function litPixel(addr: usize, width: i32, x: i32, y: i32): u32 {
  return load<u32>(addr + (y * width + x) * 4);
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

function donneDir(dx: i32, dy: i32): u8 {
  if (dx == 0 && dy == -1) return Direction.HAUT as u8;
  if (dx == 1 && dy == 0) return Direction.DROITE as u8;
  if (dx == 0 && dy == 1) return Direction.BAS as u8;
  if (dx == -1 && dy == 0) return Direction.GAUCHE as u8;
  return Direction.IMMOBILE as u8;
}

function choisisDirValide(x: u8, y: u8, dir: u8, couleur: u32): u8 {
  const dirInitiale = dir == Direction.IMMOBILE ? Direction.HAUT as u8 : dir;
  const dxInitial = deltaDirX(dirInitiale);
  const dyInitial = deltaDirY(dirInitiale);
  for (let essais = 0; essais < 4; essais++) {
    let dx = dxInitial;
    let dy = dyInitial;
    if (essais == 1) {
      const tmp = dx;
      dx = Math.abs(dy) as i32;
      dy = Math.abs(tmp) as i32;
    } else if (essais == 2) {
      const tmp = dx;
      dx = -Math.abs(dy) as i32;
      dy = -Math.abs(tmp) as i32;
    } else if (essais == 3) {
      dx = -dx;
      dy = -dy;
    }
    const nx = x + dx;
    const ny = y + dy;
    if (caseCouleur(nx, ny, couleur)) return donneDir(dx, dy);
  }
  return Direction.IMMOBILE as u8;
}

function deplaceCroc(x: u8, y: u8, dir: u8, couleur: u32): u32 {
  const prochDir = choisisDirValide(x, y, dir, couleur);
  const nx = ((x as i32) + deltaDirX(prochDir)) as u8;
  const ny = ((y as i32) + deltaDirY(prochDir)) as u8;
  return ((prochDir as u32) << 16) | ((ny as u32) << 8) | (nx as u32);
}

function verifiePositionJoueur(px: u8, py: u8): bool {
  return (
    (vars.croco0X == px && vars.croco0Y == py) ||
    (vars.croco1X == px && vars.croco1Y == py) ||
    (vars.croco2X == px && vars.croco2Y == py)
  );
}

function dessineGrille(): void {
  // for (let y: i32 = 0; y < HAUTEUR_GRILLE; y++) {
  //   for (let x: i32 = 0; x < LARGEUR_GRILLE; x++) {
  //     const couleur = ((x + y) & 1) == 0 ? COULEUR_GRILLE_SOMBRE : COULEUR_GRILLE_CLAIR;
  //     fillRect(x * CASE_DIM_PIXELS, y * CASE_DIM_PIXELS, CASE_DIM_PIXELS, CASE_DIM_PIXELS, couleur);
  //   }
  // }
  drawSpriteScaled(NIVEAU_1, 0, 0, 16, 16);
}

function dessineTeteJoueur(x: u8, y: u8): void {
  const baseX = (x as i32) * CASE_DIM_PIXELS;
  const baseY = (y as i32) * CASE_DIM_PIXELS;
  drawSprite(s("player"), baseX, baseY);
}

function dessineCroco(x: u8, y: u8): void {
  const baseX = (x as i32) * CASE_DIM_PIXELS;
  const baseY = (y as i32) * CASE_DIM_PIXELS;
  drawSprite(s("crocodile"), baseX, baseY);
}

function dessineViande(x: u8, y: u8): void {
  // Ne dessine pas si la position est invalide (0xff)
  if (x == 0xff || y == 0xff) return;
  const baseX = (x as i32) * CASE_DIM_PIXELS;
  const baseY = (y as i32) * CASE_DIM_PIXELS;
  drawSprite(s("meat"), baseX, baseY);
}

function dessineGamelle(x: u8, y: u8): void {
  // Ne dessine pas si la position est invalide (0xff)
  if (x == 0xff || y == 0xff) return;
  const baseX = (x as i32) * CASE_DIM_PIXELS;
  const baseY = (y as i32) * CASE_DIM_PIXELS;
  drawSprite(s("plate"), baseX, baseY);
}

function trouvePointDepart(couleur: u32): u16 {
  if (readSpriteInfo(NIVEAU_1)) {
    const width = getLastSpriteWidth();
    const height = getLastSpriteHeight();
    const addr = getLastSpriteAddress();
    for (let y: i32 = 0; y < height; y++) {
      for (let x: i32 = 0; x < width; x++) {
        const pixel = litPixel(addr, width, x, y);
        if (pixel == couleur) {
          return ((y as u16) << 8) | (x as u16);
        }
      }
    }
  }
  return INVALIDE;
}

function trouveNiemePoint(couleur: u32, index: i32): u16 {
  if (readSpriteInfo(NIVEAU_1)) {
    const width = getLastSpriteWidth();
    const height = getLastSpriteHeight();
    const addr = getLastSpriteAddress();
    let compteur: i32 = 0;
    for (let y: i32 = 0; y < height; y++) {
      for (let x: i32 = 0; x < width; x++) {
        const pixel = litPixel(addr, width, x, y);
        if (pixel == couleur) {
          if (compteur == index) {
            return ((y as u16) << 8) | (x as u16);
          }
          compteur++;
        }
      }
    }
  }
  return INVALIDE;
}

// === Cycle de vie ===

// Initialisation du jeu
export function init(): void {
  vars.joueurX = (LARGEUR_GRILLE / 2) as u8;
  vars.joueurY = (HAUTEUR_GRILLE / 2) as u8;
  vars.etat = EtatJeu.EN_COURS as u8;
  vars.minuteurDeplJoueur = 0;
  vars.minuteurDeplCroc = 0;

  // Trouve le point de départ du crocodile rouge
  const posCrocoRouge = trouvePointDepart(Couleurs.CrocoRouge);
  if (posCrocoRouge == INVALIDE) {
    warn("Crocodile rouge non trouve dans le niveau");
    vars.croco0X = 0xff;
    vars.croco0Y = 0xff;
    vars.croco0Dir = Direction.IMMOBILE as u8;
  } else {
    vars.croco0X = (posCrocoRouge & 0xff) as u8;
    vars.croco0Y = ((posCrocoRouge >> 8) & 0xff) as u8;
    vars.croco0Dir = Direction.DROITE as u8;
  }

  // Trouve le point de départ du crocodile violet
  const posCrocoViolet = trouvePointDepart(Couleurs.CrocoViolet);
  if (posCrocoViolet == INVALIDE) {
    warn("Crocodile violet non trouve dans le niveau");
    vars.croco1X = 0xff;
    vars.croco1Y = 0xff;
    vars.croco1Dir = Direction.IMMOBILE as u8;
  } else {
    vars.croco1X = (posCrocoViolet & 0xff) as u8;
    vars.croco1Y = ((posCrocoViolet >> 8) & 0xff) as u8;
    vars.croco1Dir = Direction.BAS as u8;
  }

  // Trouve le point de départ du crocodile vert
  const posCrocoVert = trouvePointDepart(Couleurs.CrocoVert);
  if (posCrocoVert == INVALIDE) {
    warn("Crocodile vert non trouve dans le niveau");
    vars.croco2X = 0xff;
    vars.croco2Y = 0xff;
    vars.croco2Dir = Direction.IMMOBILE as u8;
  } else {
    vars.croco2X = (posCrocoVert & 0xff) as u8;
    vars.croco2Y = ((posCrocoVert >> 8) & 0xff) as u8;
    vars.croco2Dir = Direction.HAUT as u8;
  }

  // Trouve les positions des 3 viandes
  const posViande0 = trouveNiemePoint(Couleurs.Viande, 0);
  if (posViande0 == INVALIDE) {
    warn("Viande 0 non trouvee dans le niveau");
    vars.viande0X = 0xff;
    vars.viande0Y = 0xff;
  } else {
    vars.viande0X = (posViande0 & 0xff) as u8;
    vars.viande0Y = ((posViande0 >> 8) & 0xff) as u8;
  }

  const posViande1 = trouveNiemePoint(Couleurs.Viande, 1);
  if (posViande1 == INVALIDE) {
    warn("Viande 1 non trouvee dans le niveau");
    vars.viande1X = 0xff;
    vars.viande1Y = 0xff;
  } else {
    vars.viande1X = (posViande1 & 0xff) as u8;
    vars.viande1Y = ((posViande1 >> 8) & 0xff) as u8;
  }

  const posViande2 = trouveNiemePoint(Couleurs.Viande, 2);
  if (posViande2 == INVALIDE) {
    warn("Viande 2 non trouvee dans le niveau");
    vars.viande2X = 0xff;
    vars.viande2Y = 0xff;
  } else {
    vars.viande2X = (posViande2 & 0xff) as u8;
    vars.viande2Y = ((posViande2 >> 8) & 0xff) as u8;
  }

  // Trouve les positions des 3 gamelles
  const posGamelle0 = trouveNiemePoint(Couleurs.Gamelle, 0);
  if (posGamelle0 == INVALIDE) {
    warn("Gamelle 0 non trouvee dans le niveau");
    vars.gamelle0X = 0xff;
    vars.gamelle0Y = 0xff;
  } else {
    vars.gamelle0X = (posGamelle0 & 0xff) as u8;
    vars.gamelle0Y = ((posGamelle0 >> 8) & 0xff) as u8;
  }

  const posGamelle1 = trouveNiemePoint(Couleurs.Gamelle, 1);
  if (posGamelle1 == INVALIDE) {
    warn("Gamelle 1 non trouvee dans le niveau");
    vars.gamelle1X = 0xff;
    vars.gamelle1Y = 0xff;
  } else {
    vars.gamelle1X = (posGamelle1 & 0xff) as u8;
    vars.gamelle1Y = ((posGamelle1 >> 8) & 0xff) as u8;
  }

  const posGamelle2 = trouveNiemePoint(Couleurs.Gamelle, 2);
  if (posGamelle2 == INVALIDE) {
    warn("Gamelle 2 non trouvee dans le niveau");
    vars.gamelle2X = 0xff;
    vars.gamelle2Y = 0xff;
  } else {
    vars.gamelle2X = (posGamelle2 & 0xff) as u8;
    vars.gamelle2Y = ((posGamelle2 >> 8) & 0xff) as u8;
  }
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
  if (vars.minuteurDeplJoueur > 0) vars.minuteurDeplJoueur--;
  if (vars.minuteurDeplCroc > 0) vars.minuteurDeplCroc--;

  // Gestion du mouvement du joueur
  if (vars.minuteurDeplJoueur == 0) {
    let deplX: i32 = 0;
    let deplY: i32 = 0;
    
    // Détection des touches directionnelles
    if (buttonDown(Button.LEFT)) deplX = -1;
    else if (buttonDown(Button.RIGHT)) deplX = 1;
    else if (buttonDown(Button.UP)) deplY = -1;
    else if (buttonDown(Button.DOWN)) deplY = 1;

    // Si une direction est pressée, déplace le joueur
    if (deplX != 0 || deplY != 0) {
      // Calcule la nouvelle position
      let posX = vars.joueurX + deplX;
      let posY = vars.joueurY + deplY;

      if (posX == -1) posX = LARGEUR_GRILLE - 1;
      if (posX == LARGEUR_GRILLE) posX = 0;
      if (posY == -1) posY = HAUTEUR_GRILLE - 1;
      if (posY == HAUTEUR_GRILLE) posY = 0;
      
      // Déplacer uniquement si la position est valide
      if (peutBouger(posX, posY)) {
        vars.joueurX = posX as u8;
        vars.joueurY = posY as u8;
      }
      
      // Réinitialiser le minuteur de mouvement
      vars.minuteurDeplJoueur = JOUEUR_DEPL_DELAI;
    }
  }

  if (vars.minuteurDeplCroc == 0) {
    // Déplace le crocodile rouge
    let posXYDir = deplaceCroc(
      vars.croco0X,
      vars.croco0Y,
      vars.croco0Dir,
      Couleurs.CrocoRouge
    );
    vars.croco0X = (posXYDir & 0xff) as u8;
    vars.croco0Y = ((posXYDir >> 8) & 0xff) as u8;
    vars.croco0Dir = ((posXYDir >> 16) & 0xff) as u8;

    // Déplace le crocodile violet
    posXYDir = deplaceCroc(
      vars.croco1X,
      vars.croco1Y,
      vars.croco1Dir,
      Couleurs.CrocoViolet
    );
    vars.croco1X = (posXYDir & 0xff) as u8;
    vars.croco1Y = ((posXYDir >> 8) & 0xff) as u8;
    vars.croco1Dir = ((posXYDir >> 16) & 0xff) as u8;

    // Déplace le crocodile vert
    posXYDir = deplaceCroc(
      vars.croco2X,
      vars.croco2Y,
      vars.croco2Dir,
      Couleurs.CrocoVert
    );
    vars.croco2X = (posXYDir & 0xff) as u8;
    vars.croco2Y = ((posXYDir >> 8) & 0xff) as u8;
    vars.croco2Dir = ((posXYDir >> 16) & 0xff) as u8;

    vars.minuteurDeplCroc = CROCO_DEPL_DELAI;
  }

  if (verifiePositionJoueur(vars.joueurX, vars.joueurY)) {
    vars.etat = EtatJeu.FIN as u8;
  }
}

// Dessine la grille et les crocodiles
export function draw(): void {
  dessineGrille();
  // Colorie tous les pixels qui ne sont pas du mur
  for (let y: i32 = 0; y < HAUTEUR_GRILLE; y++) {
    for (let x: i32 = 0; x < LARGEUR_GRILLE; x++) {
      if (!caseCouleur(x, y, Couleurs.Mur)) {
        // Colorie la case
        fillRect(
          x * CASE_DIM_PIXELS,
          y * CASE_DIM_PIXELS,
          CASE_DIM_PIXELS,
          CASE_DIM_PIXELS,
          Couleurs.Sol
        );
      }
    }
  }

  // Dessine les gamelles
  dessineGamelle(vars.gamelle0X, vars.gamelle0Y);
  dessineGamelle(vars.gamelle1X, vars.gamelle1Y);
  dessineGamelle(vars.gamelle2X, vars.gamelle2Y);

  // Dessine les viandes
  dessineViande(vars.viande0X, vars.viande0Y);
  dessineViande(vars.viande1X, vars.viande1Y);
  dessineViande(vars.viande2X, vars.viande2Y);

  // Dessine les crocodiles
  dessineCroco(vars.croco0X, vars.croco0Y);
  dessineCroco(vars.croco1X, vars.croco1Y);
  dessineCroco(vars.croco2X, vars.croco2Y);

  // Dessine le joueur
  dessineTeteJoueur(vars.joueurX, vars.joueurY);

  if (vars.etat == EtatJeu.FIN) {
    drawStartMessageBox("IL VA TE MANGER...", Couleurs.MessageBoxFond, Couleurs.MessageBoxTexte);
  }
}
