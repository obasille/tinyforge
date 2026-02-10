import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import chokidar from 'chokidar';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const gamesDir = path.join(repoRoot, 'src', 'assembly', 'games');
const sdkDir = path.join(repoRoot, 'src', 'assembly', 'sdk');
const memoryMap = path.join(repoRoot, 'src', 'memory-map.ts');

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
  
  if (parts.length === 1) {
    // File directly in games folder - return filename without extension
    return path.basename(filePath, '.ts');
  } else {
    // File in subdirectory - return subdirectory name
    return parts[0];
  }
}

function isSdkFile(filePath) {
  return filePath.startsWith(sdkDir + path.sep) && filePath.endsWith('.ts');
}

const watcher = chokidar.watch([gamesDir, sdkDir, memoryMap], {
  ignoreInitial: true,
});

function handleAssemblyChange(filePath) {
  if (filePath === memoryMap || isSdkFile(filePath)) {
    runBuild('all');
    return;
  }

  const gameName = isGameFile(filePath);
  if (gameName) {
    runBuild(gameName);
  }
}

watcher.on('change', handleAssemblyChange);
watcher.on('add', handleAssemblyChange);
watcher.on('unlink', handleAssemblyChange);

watcher.on('error', (error) => {
  console.error(`Watcher error: ${error.message}`);
});

console.log('Watching AssemblyScript files for changes...');
