// cspell:language en,fr
import { ArrayView } from "../../sdk";
import { caseCouleur } from "./level";
import {
  Couleurs,
  directionX,
  directionY,
  HAUTEUR_GRILLE,
  INVALIDE_POS,
  LARGEUR_GRILLE,
  parentsBFS,
  queueBFS,
} from "./types";

export function donneProchaineCaseCheminBFS(
  startX: i32,
  startY: i32,
  endX: i32,
  endY: i32,
): u16 {
  const startPos = ((startY as u16) << 8) | (startX as u16);
  const endPos = ((endY as u16) << 8) | (endX as u16);

  if (startPos == endPos) {
    return startPos;
  }

  // Clear arrays and start BFS from end position to find start
  parentsBFS.clear();
  queueBFS.clear();
  queueBFS.push(endPos);

  let head = 0;
  let found = false;

  while (head < (queueBFS.length as i32)) {
    const pos = queueBFS.get(head++);

    if (pos == startPos) {
      found = true;
      break;
    }

    const x = (pos & 0xff) as i32;
    const y = ((pos >> 8) & 0xff) as i32;

    // Essayer les 4 directions
    for (let i = 0; i < 4; i++) {
      const nx = x + directionX.get(i);
      const ny = y + directionY.get(i);

      if (nx < 0 || nx >= LARGEUR_GRILLE || ny < 0 || ny >= HAUTEUR_GRILLE)
        continue;
      if (caseCouleur(nx, ny, Couleurs.Mur)) continue;

      const npos = ((ny as u16) << 8) | (nx as u16);

      // Check if already in queue
      let dejaDansQueue = false;
      for (let j = 0; j < (queueBFS.length as i32); j++) {
        if (queueBFS.get(j) == npos) {
          dejaDansQueue = true;
          break;
        }
      }

      if (!dejaDansQueue) {
        parentsBFS.push(pos);
        queueBFS.push(npos);
      }
    }
  }

  if (!found) {
    return INVALIDE_POS;
  }

  // Find index of startPos in queue
  let idx = -1;
  for (let i = 0; i < (queueBFS.length as i32); i++) {
    if (queueBFS.get(i) == startPos) {
      idx = i;
      break;
    }
  }

  if (idx <= 0) {
    return INVALIDE_POS;
  }

  return parentsBFS.get(idx - 1);
}

export function construireCasesValides(
  casesCibles: ArrayView<u16>,
  casesValides: ArrayView<u16>,
): void {
  // Ajouter toutes les cases cibles
  for (let i = 0; i < (casesCibles.length as i32); i++) {
    casesValides.push(casesCibles.get(i));
  }

  // Pour chaque paire de cases cibles
  for (let i = 0; i < (casesCibles.length as i32); i++) {
    const posA = casesCibles.get(i);
    const ax = (posA & 0xff) as i32;
    const ay = ((posA >> 8) & 0xff) as i32;

    for (let j = i + 1; j < (casesCibles.length as i32); j++) {
      const posB = casesCibles.get(j);
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
          // Find index of current in queueBFS
          let idx = -1;
          for (let k = 0; k < (queueBFS.length as i32); k++) {
            if (queueBFS.get(k) == current) {
              idx = k;
              break;
            }
          }
          if (idx <= 0) break; // Safety check
          current = parentsBFS.get(idx - 1);
        }
        if (!casesValides.includes(current)) {
          casesValides.push(current);
        }
      }
    }
  }
}
