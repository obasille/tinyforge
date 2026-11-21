import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import chokidar from 'chokidar';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const gamesDir = path.join(repoRoot, 'packages', 'engine', 'assembly', 'games');
const sdkDir = path.join(repoRoot, 'packages', 'engine', 'assembly', 'sdk');
const memoryMap = path.join(repoRoot, 'packages', 'engine', 'memory-map.ts');
// Adding or removing a library file can make a game's asset IDs valid or
// unknown: rebuild every game. (Editing a file needs no rebuild, except a
// game's COVER image, which is copied into its cartridge.)
const assetDirs = ['sprites', 'sfx', 'music'].map((sub) => path.join(repoRoot, 'assets', sub));

let running = false;
let queued = null;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: true });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function runBuild(target) {
  if (running) {
    queued = target;
    return;
  }

  running = true;
  try {
    if (target === 'all') {
      await run('node', ['scripts/build-games.js']);
    } else {
      await run('node', ['scripts/build-games.js', target]);
    }
  } catch (error) {
    console.error(error.message);
  } finally {
    running = false;
    if (queued) {
      const next = queued;
      queued = null;
      runBuild(next);
    }
  }
}

function isGameFile(filePath) {
  if (!filePath.startsWith(gamesDir + path.sep) || !filePath.endsWith('.ts')) {
    return null;
  }
  const relativePath = path.relative(gamesDir, filePath);
  const parts = relativePath.split(path.sep);

  // Each game is a folder (<game>/main.ts plus any other sources)
  return parts.length > 1 ? parts[0] : null;
}

function isSdkFile(filePath) {
  return filePath.startsWith(sdkDir + path.sep) && filePath.endsWith('.ts');
}

const watcher = chokidar.watch([gamesDir, sdkDir, memoryMap, ...assetDirs], {
  ignoreInitial: true,
});

function handleAssemblyChange(filePath, event) {
  const isAsset = assetDirs.some((dir) => filePath.startsWith(dir + path.sep));
  if (isAsset && event === 'change') return;
  if (filePath === memoryMap || isSdkFile(filePath) || isAsset) {
    runBuild('all');
    return;
  }

  const gameName = isGameFile(filePath);
  if (gameName) {
    runBuild(gameName);
  }
}

watcher.on('change', (file) => handleAssemblyChange(file, 'change'));
watcher.on('add', (file) => handleAssemblyChange(file, 'add'));
watcher.on('unlink', (file) => handleAssemblyChange(file, 'unlink'));

watcher.on('error', (error) => {
  console.error(`Watcher error: ${error.message}`);
});

console.log('Watching AssemblyScript files for changes...');
