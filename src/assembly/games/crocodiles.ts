// cspell:language en,fr
// CROCODILES - Jeu TinyForge
// Ramassez les viandes et déposez-les dans les gamelles pour nourrir les crocodiles.
// Objectif : Remplir les 3 gamelles pour gagner !
// Attention : Évitez de vous faire attraper par les crocodiles qui patrouillent le niveau.
// Contrôles : Flèches pour se déplacer, START pour redémarrer.

// Quand le joueur est sur le chemin d'un crocodile (tel qu'identifié par la couleur du pixel correspondant dans le sprite du level), double la vitesse du croco concerné. Utilise CrocoInfo pour stocker la vitesse

import {
  Button,
  HEIGHT,
  RAM_START,
  WIDTH,
  buttonDown,
  buttonPressed,
  c,
  drawSprite,
  drawSpriteScaled,
  drawSpriteScaledDown,
  drawStartMessageBox,
  fillRect,
  getLastSpriteAddress,
  getLastSpriteHeight,
  getLastSpriteWidth,
  randomRange,
  readSpriteInfo,
  s,
  warn,
} from "../sdk";

// === Constantes ===
const TAILLE_CASE: i32 = 16;
const LARGEUR_GRILLE: i32 = WIDTH / TAILLE_CASE;
const HAUTEUR_GRILLE: i32 = HEIGHT / TAILLE_CASE;

const JOUEUR_DEPL_DELAI: u8 = 6;
const CROCO_DEPL_DELAI: u8 = 30;
const NB_CROCOS: i32 = 3;
const VIES_DEPART: u8 = 3;
const INVINCIBLE_TICKS: u8 = 180; // ~3s @ 60fps
const NB_TUNNELS: i32 = 2;
const TUNNEL_CYCLE_TICKS: u16 = 600; // 10s @ 60fps
const TUNNEL_ANIM_TICKS: u8 = 12;
const NB_PIEGES: i32 = 4;
const PIEGE_MIN_TICKS: u16 = 120; // 2s @ 60fps
const PIEGE_MAX_TICKS: u16 = 300; // 5s @ 60fps

const INVALIDE: u8 = 0xff;
const INVALIDE_POS: u16 = 0xffff;

enum Couleurs {
  MessageBoxFond = c(0x2a1a1a),
  MessageBoxTexte = c(0xffaa00),
  MessageBoxFondVictoire = c(0x1a2a1a),
  MessageBoxTexteVictoire = c(0x00ff00),
  Joueur = c(0xffff00),
  CrocoRouge = c(0xff0000),
  CrocoViolet = c(0xff00ff),
  CrocoVert = c(0x00ff00),
  Sol = c(0xe09729),
  Mur = c(0x04e5ff),
  Viande = c(0xba0b0b),
  Gamelle = c(0x583de8),
  Tunnel1 = c(0x707070),
  Tunnel2 = c(0x909090),
  Piège = c(0x804000),
}

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
  VICTOIRE = 2,
}

// === Système de variables en RAM ===

@unmanaged
class Jeu {
  etat: u8;
  vies: u8;
  tunnelPhase: u8;
  tunnelTimer: u16;
  _fin: u8;
}

@unmanaged
class Joueur {
  x: u8;
  y: u8;
  minuteurDepl: u8;
  viandePortee: u8; // index de la viande portée, ou INVALIDE si aucune
  invincible: u8;
  dirDepl: u8;
  tunnelEtat: u8; // 0 = pas dans tunnel, 1 = entrée, 2 = sortie
  tunnelTimer: u8;
  tunnelDestX: u8;
  tunnelDestY: u8;
  startupDelay: u8;
}

@unmanaged
class Croco {
  x: u8;
  y: u8;
  dir: u8;
  minuteurDepl: u8;
  gamelleX: u8;
  gamelleY: u8;
  gamelleRemplie: u8; // 0 = vide, 1 = remplie
  attaque: u8; // 0 = normal, 1 = attaque
  targetX: u8; // Position X de la cible
  targetY: u8; // Position Y de la cible
}

@unmanaged
class Viande {
  x: u8;
  y: u8;
}

@unmanaged
class Tunnel {
  present: u8; // 0 = pas de tunnel trouvé, 1 = tunnel présent
  x0: u8;
  y0: u8;
  x1: u8;
  y1: u8;
  ouvert: u8;
}

@unmanaged
class Piège {
  present: u8; // 0 = pas de piège trouvé, 1 = piège présent
  x: u8;
  y: u8;
  actif: u8; // 0 = piège désactivé, 1 = piège actif
  timer: u16; // Timer pour le changement d'état
}

const jeu = changetype<Jeu>(RAM_START);
const szVars = offsetof<Jeu>("_fin");
const szJoueur: usize = (offsetof<Joueur>("startupDelay") + 4) & ~3;
const szCroco: usize = (offsetof<Croco>("targetY") + 4) & ~3;
const szViande: usize = (offsetof<Viande>("y") + 4) & ~3;
const szTunnel: usize = (offsetof<Tunnel>("ouvert") + 4) & ~3;
const szPiège: usize = (offsetof<Piège>("timer") + 4) & ~3;
let offset: usize = RAM_START + szVars;
const joueur = changetype<Joueur>(offset);
offset += szJoueur;
const croco0 = changetype<Croco>(offset);
offset += szCroco;
const croco1 = changetype<Croco>(offset);
offset += szCroco;
const croco2 = changetype<Croco>(offset);
offset += szCroco;
const viande0 = changetype<Viande>(offset);
offset += szViande;
const viande1 = changetype<Viande>(offset);
offset += szViande;
const viande2 = changetype<Viande>(offset);
offset += szViande;
const tunnel0 = changetype<Tunnel>(offset);
offset += szTunnel;
const tunnel1 = changetype<Tunnel>(offset);
offset += szTunnel;
const piège0 = changetype<Piège>(offset);
offset += szPiège;
const piège1 = changetype<Piège>(offset);
offset += szPiège;
const piège2 = changetype<Piège>(offset);
offset += szPiège;
const piège3 = changetype<Piège>(offset);

const lesCrocos: Croco[] = [croco0, croco1, croco2];
const lesViandes: Viande[] = [viande0, viande1, viande2];
const lesTunnels: Tunnel[] = [tunnel0, tunnel1];
const lesPièges: Piège[] = [piège0, piège1, piège2, piège3];

const couleursCrocos: u32[] = [
  Couleurs.CrocoRouge,
  Couleurs.CrocoViolet,
  Couleurs.CrocoVert,
];

// cases cibles de chaque croco (format: y<<8 | x)
let casesCiblesCrocoRouge: u16[] = [];
let casesCiblesCrocoViolet: u16[] = [];
let casesCiblesCrocoVert: u16[] = [];
const casesCiblesCrocos: u16[][] = [casesCiblesCrocoRouge, casesCiblesCrocoViolet, casesCiblesCrocoVert];

// cases valides pour les chemins de chaque croco, calculées au lancement du niveau (format: y<<8 | x)
let casesValidesCrocoRouge: u16[] = [];
let casesValidesCrocoViolet: u16[] = [];
let casesValidesCrocoVert: u16[] = [];
const casesValidesCrocos: u16[][] = [casesValidesCrocoRouge, casesValidesCrocoViolet, casesValidesCrocoVert];

// === Niveau ===

const NIVEAU_1: i32 = s("level1");
let adresseNiveau: usize = 0;

// === Fonctions auxiliaires ===

function litCouleurCase(x: i32, y: i32): u32 {
  return load<u32>(adresseNiveau + (y * LARGEUR_GRILLE + x) * 4);
}

function caseCouleur(x: i32, y: i32, couleur: u32): bool {
  if (x >= 0 && x < LARGEUR_GRILLE && y >= 0 && y < HAUTEUR_GRILLE) {
    const pixel = litCouleurCase(x, y);
    return pixel == couleur;
  }
  return false;
}

function peutBouger(x: i32, y: i32): bool {
  if (x >= 0 && x < LARGEUR_GRILLE && y >= 0 && y < HAUTEUR_GRILLE) {
    const pixel = litCouleurCase(x, y);
    if (pixel != Couleurs.Mur) {
      return true;
    }
  }
  return false;
}

function initTunnel(index: u8): void {
  const tunnel = lesTunnels[index];
  const couleur = index == 0 ? Couleurs.Tunnel1 : Couleurs.Tunnel2;
  
  // Trouve tous les pixels de cette couleur
  let count: i32 = 0;
  let pos0: u16 = INVALIDE_POS;
  let pos1: u16 = INVALIDE_POS;
  
  for (let y: i32 = 0; y < HAUTEUR_GRILLE; y++) {
    for (let x: i32 = 0; x < LARGEUR_GRILLE; x++) {
      if (litCouleurCase(x, y) == couleur) {
        if (count == 0) {
          pos0 = ((y as u16) << 8) | (x as u16);
        } else if (count == 1) {
          pos1 = ((y as u16) << 8) | (x as u16);
        }
        count++;
      }
    }
  }
  
  // Log des avertissements si nécessaire
  if (count == 1) {
    warn("Tunnel " + index.toString() + ": seulement 1 pixel trouvé");
  } else if (count > 2) {
    warn("Tunnel " + index.toString() + ": " + count.toString() + " pixels trouvés (2 attendus)");
  }
  
  // Configure le tunnel si exactement 2 pixels trouvés
  if (count == 2) {
    tunnel.x0 = (pos0 & 0xff) as u8;
    tunnel.y0 = ((pos0 >> 8) & 0xff) as u8;
    tunnel.x1 = (pos1 & 0xff) as u8;
    tunnel.y1 = ((pos1 >> 8) & 0xff) as u8;
    tunnel.ouvert = 0;
    tunnel.present = 1;
  } else {
    tunnel.x0 = INVALIDE;
    tunnel.y0 = INVALIDE;
    tunnel.x1 = INVALIDE;
    tunnel.y1 = INVALIDE;
    tunnel.ouvert = 0;
    tunnel.present = 0;
  }
}

function initPiège(index: u8): void {
  const piège = lesPièges[index];
  
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
          piège.timer = (PIEGE_MIN_TICKS + randomRange((PIEGE_MAX_TICKS - PIEGE_MIN_TICKS) as i32)) as u16;
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

function majPièges(): void {
  for (let i: i32 = 0; i < NB_PIEGES; i++) {
    const piège = lesPièges[i];
    if (!piège.present) continue;
    
    if (piège.timer > 0) {
      piège.timer--;
    } else {
      // Change l'état du piège
      piège.actif = piège.actif == 1 ? 0 : 1;
      // Nouveau timer aléatoire entre 2 et 5 secondes
      piège.timer = (PIEGE_MIN_TICKS + randomRange((PIEGE_MAX_TICKS - PIEGE_MIN_TICKS) as i32)) as u16;
    }
  }
}

function verifieCollisionPièges(): void {
  if (joueur.invincible > 0) return;
  
  for (let i: i32 = 0; i < NB_PIEGES; i++) {
    const piège = lesPièges[i];
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

function dessinePiège(piège: Piège): void {
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

function majOuvertureTunnels(): void {
  if (jeu.tunnelTimer > 0) {
    jeu.tunnelTimer--;
  } else {
    if (jeu.tunnelPhase == 0) {
      if (tunnel0.present) tunnel0.ouvert = 1;
      if (tunnel1.present) tunnel1.ouvert = 0;
      jeu.tunnelPhase = 1;
    } else if (jeu.tunnelPhase == 1) {
      if (tunnel0.present) tunnel0.ouvert = 0;
      jeu.tunnelPhase = 2;
    } else if (jeu.tunnelPhase == 2) {
      if (tunnel1.present) tunnel1.ouvert = 1;
      jeu.tunnelPhase = 3;
    } else {
      if (tunnel1.present) tunnel1.ouvert = 0;
      jeu.tunnelPhase = 0;
    }
    jeu.tunnelTimer = TUNNEL_CYCLE_TICKS;
  }
}

function essaieTeleportTunnel(): void {
  const px = joueur.x;
  const py = joueur.y;
  if (joueur.tunnelEtat != 0) return;

  let destX = INVALIDE;
  let destY = INVALIDE;
  
  for (let i: i32 = 0; i < NB_TUNNELS; i++) {
    const t = lesTunnels[i];
    if (!t.present || !t.ouvert) continue;
    
    if (px == t.x0 && py == t.y0) {
      destX = t.x1;
      destY = t.y1;
      break;
    } else if (px == t.x1 && py == t.y1) {
      destX = t.x0;
      destY = t.y0;
      break;
    }
  }

  if (destX == INVALIDE) return;

  joueur.tunnelEtat = 1;
  joueur.tunnelTimer = TUNNEL_ANIM_TICKS;
  joueur.tunnelDestX = destX;
  joueur.tunnelDestY = destY;
  joueur.dirDepl = Direction.IMMOBILE as u8;
}

function majTunnelAnimJoueur(): void {
  if (joueur.tunnelEtat == 0) return;
  if (joueur.tunnelTimer > 0) {
    joueur.tunnelTimer--;
    if (joueur.tunnelTimer > 0) return;
  }
  if (joueur.tunnelEtat == 1) {
    joueur.x = joueur.tunnelDestX;
    joueur.y = joueur.tunnelDestY;
    joueur.tunnelEtat = 2;
    joueur.tunnelTimer = TUNNEL_ANIM_TICKS;
  } else {
    joueur.tunnelEtat = 0;
    joueur.tunnelTimer = 0;
  }
}

function dessineTunnel(x: u8, y: u8, ouvert: u8): void {
  if (x == INVALIDE || y == INVALIDE) return;
  const baseX = (x as i32) * TAILLE_CASE;
  const baseY = (y as i32) * TAILLE_CASE;
  const sprite = ouvert == 1 ? s("tunnel") : s("tunnel_closed");
  drawSprite(sprite, baseX, baseY);
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

function verifiePositionJoueur(px: u8, py: u8): bool {
  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    const croco = lesCrocos[i];
    if (croco.x == px && croco.y == py) return true;
  }
  return false;
}

function dessineGrille(): void {
  drawSpriteScaled(NIVEAU_1, 0, 0, 16, 16);
}

function dessineTeteJoueur(): void {
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
    else if (renderX >= (LARGEUR_GRILLE as f32)) renderX -= LARGEUR_GRILLE as f32;
    if (renderY < 0.0) renderY += HAUTEUR_GRILLE as f32;
    else if (renderY >= (HAUTEUR_GRILLE as f32)) renderY -= HAUTEUR_GRILLE as f32;
  }
  const baseX = (renderX * (TAILLE_CASE as f32)) as i32;
  const baseY = (renderY * (TAILLE_CASE as f32)) as i32;
  let alpha: u8 = 255;
  if (joueur.invincible > 0) {
    const t = (joueur.invincible as i32) & 15;
    const tri = t < 8 ? t : (15 - t);
    alpha = (128 + (tri * 16)) as u8;
  }
  let scaleNum: i32 = 8;
  if (joueur.tunnelEtat == 1) {
    scaleNum = ((joueur.tunnelTimer as i32) * 8) / (TUNNEL_ANIM_TICKS as i32);
  } else if (joueur.tunnelEtat == 2) {
    scaleNum = 8 - (((joueur.tunnelTimer as i32) * 8) / (TUNNEL_ANIM_TICKS as i32));
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

function dessineCroco(croco: Croco): void {
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

function dessineViande(x: u8, y: u8): void {
  // Ne dessine pas si la position est invalide
  if (x == INVALIDE || y == INVALIDE) return;
  const baseX = (x as i32) * TAILLE_CASE;
  const baseY = (y as i32) * TAILLE_CASE;
  drawSprite(s("meat"), baseX, baseY);
}

function dessineGamelle(x: u8, y: u8, remplie: u8): void {
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

function trouveCasesCouleur(couleur: u32, cases: u16[]): void {
  for (let y: i32 = 0; y < HAUTEUR_GRILLE; y++) {
    for (let x: i32 = 0; x < LARGEUR_GRILLE; x++) {
      if (litCouleurCase(x, y) == couleur) {
        cases.push(((y as u16) << 8) | (x as u16));
      }
    }
  }
}

// Tableaux statiques pour BFS
const MAX_BFS_SIZE: i32 = 256; // Plus grand que 20x10 = 200 cases
const queueBFS = new StaticArray<u16>(MAX_BFS_SIZE);
const parentsBFS = new StaticArray<u16>(MAX_BFS_SIZE);
let tailleQueueBFS: i32 = 0;
let tailleParentsBFS: i32 = 0;

// Directions pour BFS
const directionX = new StaticArray<i32>(4);
const directionY = new StaticArray<i32>(4);
directionX[0] = 0;  directionY[0] = -1;  // HAUT
directionX[1] = 0;  directionY[1] = 1;   // BAS
directionX[2] = -1; directionY[2] = 0;   // GAUCHE
directionX[3] = 1;  directionY[3] = 0;   // DROITE

function donneProchaineCaseCheminBFS(startX: i32, startY: i32, endX: i32, endY: i32): u16 {
  const startPos = ((startY as u16) << 8) | (startX as u16);
  const endPos = ((endY as u16) << 8) | (endX as u16);
  
  if (startPos == endPos) {
    return startPos;
  }

  tailleParentsBFS = 0;
  tailleQueueBFS = 0;
  
  // Start BFS from end position to find start
  queueBFS[tailleQueueBFS++] = endPos;
  
  let head = 0;
  let found = false;

  while (head < tailleQueueBFS) {
    const pos = queueBFS[head++];
    
    if (pos == startPos) {
      found = true;
      break;
    }
    
    const x = (pos & 0xff) as i32;
    const y = ((pos >> 8) & 0xff) as i32;
    
    // Essayer les 4 directions    
    for (let i = 0; i < 4; i++) {
      const nx = x + directionX[i];
      const ny = y + directionY[i];
      
      if (nx < 0 || nx >= LARGEUR_GRILLE || ny < 0 || ny >= HAUTEUR_GRILLE) continue;
      if (caseCouleur(nx, ny, Couleurs.Mur)) continue;
      
      const npos = ((ny as u16) << 8) | (nx as u16);
      
      // Check if already in queue
      let dejaDansQueue = false;
      for (let j = 0; j < tailleQueueBFS; j++) {
        if (queueBFS[j] == npos) {
          dejaDansQueue = true;
          break;
        }
      }
      
      if (!dejaDansQueue && tailleQueueBFS < MAX_BFS_SIZE) {
        parentsBFS[tailleParentsBFS++] = pos;
        queueBFS[tailleQueueBFS++] = npos;
      }
    }
  }
  
  if (!found) {
    return INVALIDE_POS;
  }
  
  // Find index of startPos in queue
  let idx = -1;
  for (let i = 0; i < tailleQueueBFS; i++) {
    if (queueBFS[i] == startPos) {
      idx = i;
      break;
    }
  }
  
  if (idx <= 0) {
    return INVALIDE_POS;
  }
  
  return parentsBFS[idx - 1];
}

function construireCasesValides(casesCibles: u16[], casesValides: u16[]): void {
  
  // Ajouter toutes les cases cibles
  for (let i = 0; i < casesCibles.length; i++) {
    casesValides.push(casesCibles[i]);
  }
  
  // Pour chaque paire de cases cibles
  for (let i = 0; i < casesCibles.length; i++) {
    const posA = casesCibles[i];
    const ax = (posA & 0xff) as i32;
    const ay = ((posA >> 8) & 0xff) as i32;
    
    for (let j = i + 1; j < casesCibles.length; j++) {
      const posB = casesCibles[j];
      const bx = (posB & 0xff) as i32;
      const by = ((posB >> 8) & 0xff) as i32;
      
      // Trouve le chemin le plus court entre A et B
      const prochaineCase = donneProchaineCaseCheminBFS(ax, ay, bx, by);
      if (prochaineCase != INVALIDE_POS) {
        // Reconstruct path
        let current = posA;
        while (current != posB) {
          // Vérifier que la case n'est pas déjà dans casesValides pour éviter les doublons
          if (!casesValides.includes(current)) {
            casesValides.push(current);
          }
          const idx = queueBFS.indexOf(current);
          current = parentsBFS[idx - 1];
        }
          if (!casesValides.includes(current)) {
            casesValides.push(current);
          }
      }
    }
  }
}

function trouvePointDepart(couleur: u32): u16 {
  for (let y: i32 = 0; y < HAUTEUR_GRILLE; y++) {
    for (let x: i32 = 0; x < LARGEUR_GRILLE; x++) {
      const pixel = litCouleurCase(x, y);
      if (pixel == couleur) {
        return ((y as u16) << 8) | (x as u16);
      }
    }
  }
  return INVALIDE_POS;
}

function choisiNouvelleCible(croco: Croco, cases: u16[]): void {
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

function trouveNiemePoint(couleur: u32, index: i32): u16 {
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
  return INVALIDE_POS;
}

function trouveCrocoPourGamelle(x: u8, y: u8): u8 {
  const gx = x as i32;
  const gy = y as i32;

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

function initCroco(index: u8, croco: Croco, couleur: u32): void {
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

function assigneGamelle(index: u8): void {
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

function initJoueur(): void {
  // Trouve toutes les cases avec la couleur Joueur
  let casesJoueur: u16[] = [];
  trouveCasesCouleur(Couleurs.Joueur, casesJoueur);
  
  // Choisit une case aléatoire parmi les positions Joueur trouvées
  let spawn: u16;
  if (casesJoueur.length > 0) {
    const idx = randomRange(casesJoueur.length);
    spawn = casesJoueur[idx];
  } else {
    // Fallback : centre de la grille si aucune position trouvée
    warn("Aucune position Joueur trouvée dans le niveau");
    spawn = (((HAUTEUR_GRILLE / 2) as u16) << 8) | ((LARGEUR_GRILLE / 2) as u16);
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

function déplaceCroco(croco: Croco, indexCroco: i32): void {
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
  
  const oldX = croco.x;
  const oldY = croco.y;
  const oldDir = croco.dir;

  // Déplace le crocodile
  croco.x = prochainX as u8;
  croco.y = prochainY as u8;
  croco.dir = dir;
}

function doneViandePos(index: u8): u16 {
  const v = lesViandes[index];
  return ((v.y as u16) << 8) | (v.x as u16);
}

function metViandePos(index: u8, x: u8, y: u8): void {
  const v = lesViandes[index];
  v.x = x;
  v.y = y;
}

function initViande(index: u8): void {
  const pos = trouveNiemePoint(Couleurs.Viande, index as i32);
  if (pos == INVALIDE_POS) {
    if (index == 0) warn("Viande 0 non trouvée dans le niveau");
    else if (index == 1) warn("Viande 1 non trouvée dans le niveau");
    else warn("Viande 2 non trouvée dans le niveau");
    metViandePos(index, INVALIDE, INVALIDE);
    return;
  }
  metViandePos(index, (pos & 0xff) as u8, ((pos >> 8) & 0xff) as u8);
}

function ramasseViande(jx: u8, jy: u8): void {
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

function deposeViande(jx: u8, jy: u8): void {
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

function deplaceJoueur(): void {
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

// === Cycle de vie ===

// Initialisation du jeu
export function init(): void {
  // Charge le niveau
  if (!readSpriteInfo(NIVEAU_1)) return;
  const largeur = getLastSpriteWidth();
  const hauteur = getLastSpriteHeight();
  adresseNiveau = getLastSpriteAddress();
  if (largeur != LARGEUR_GRILLE || hauteur != HAUTEUR_GRILLE) {
    warn("Taille niveau != grille");
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
