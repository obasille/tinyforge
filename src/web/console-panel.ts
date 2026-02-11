// Console Panel Logger
// Manages the HTML console panel for displaying logs, warnings, and errors

const requireElement = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing required element: ${id}`);
  }
  return el as T;
};

const consoleEntries = requireElement<HTMLDivElement>('console-entries');
const clearBtn = requireElement<HTMLButtonElement>('clear-console');

/**
 * Adds an entry to the console panel
 * @param {string} type - Entry type: 'LOG', 'WARN', 'ERROR', 'RUNTIME', 'LOAD', 'TRACE'
 * @param {string} message - Message to display
 */
export function addConsoleEntry(type: string, message: string): void {
  const entry = document.createElement('div');
  entry.className = `console-entry ${type.toLowerCase()}`;

  const time = new Date().toLocaleTimeString();
  entry.innerHTML = `<span class="entry-time">${time}</span><span class="entry-type">[${type}]</span>${message}`;

  consoleEntries.appendChild(entry);
  consoleEntries.scrollTop = consoleEntries.scrollHeight;

  // Also log to browser console
  const msg = `[${type}] ${message}`;
  if (type === 'ERROR' || type === 'ABORT') console.error(msg);
  else if (type === 'WARN') console.warn(msg);
  else console.log(msg);
}

clearBtn.addEventListener('click', () => {
  consoleEntries.innerHTML = '';
});
