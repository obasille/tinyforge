// Console Panel Logger
// Manages the HTML console panel for displaying logs, warnings, and errors

const consoleEntries = document.getElementById('console-entries');
const clearBtn = document.getElementById('clear-console');

/**
 * Adds an entry to the console panel
 * @param {string} type - Entry type: 'LOG', 'WARN', 'ERROR', 'RUNTIME', 'LOAD', 'TRACE'
 * @param {string} message - Message to display
 */
export function addConsoleEntry(type, message) {
  const entry = document.createElement('div');
  entry.className = `console-entry ${type.toLowerCase()}`;
  
  const time = new Date().toLocaleTimeString();
  entry.innerHTML = `<span class="entry-time">${time}</span><span class="entry-type">[${type}]</span>${message}`;
  
  consoleEntries.appendChild(entry);
  consoleEntries.scrollTop = consoleEntries.scrollHeight;
  
  // Also log to browser console
  console.error(`[${type}]`, message);
}

clearBtn.addEventListener('click', () => {
  consoleEntries.innerHTML = '';
});
