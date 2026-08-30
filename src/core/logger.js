const fs = require('fs');
const path = require('path');
const config = require('../config');

const logsDir = path.join(process.cwd(), 'logs');

function ensureLogsDir() {
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
}

function timestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
        `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function write(category, scope, message, isError) {
    const label = category === 'system' ? 'SYSTEM' : 'APP';
    const line = `[${timestamp()}] [${label}] [${scope}] ${message}`;

    if (isError) {
        console.error(line);
    } else {
        console.log(line);
    }

    if (config.LOG_TO_FILE) {
        ensureLogsDir();
        const file = path.join(logsDir, `${category}.log`);
        try {
            fs.appendFileSync(file, line + '\n');
        } catch (e) {
            console.error(`[${timestamp()}] [SYSTEM] [Logger] Failed to write to ${file}: ${e.message}`);
        }
    }
}

module.exports = {
    app: (scope, message) => write('app', scope, message, false),
    appError: (scope, message) => write('app', scope, message, true),
    system: (scope, message) => write('system', scope, message, false),
    systemError: (scope, message) => write('system', scope, message, true),
};
