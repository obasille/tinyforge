// cspell:language en,fr
import { caseCouleur } from "./level";
import {
  Couleurs,
  HAUTEUR_GRILLE,
  INVALIDE_POS,
  LARGEUR_GRILLE,
} from "./types";

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

export function donneProchaineCaseCheminBFS(startX: i32, startY: i32, endX: i32, endY: i32): u16 {
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

export function construireCasesValides(casesCibles: u16[], casesValides: u16[]): void {
  
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
