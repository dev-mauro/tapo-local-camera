#!/usr/bin/env node
/**
 * Descarga el binario de go2rtc correspondiente al sistema operativo y lo deja
 * en <proyecto>/bin/. Usa el release "latest" de GitHub.
 *
 *   npm run setup:go2rtc
 *
 * Si prefieres gestionarlo tú, descarga el binario manualmente desde
 * https://github.com/AlexxIT/go2rtc/releases y apunta GO2RTC_BIN en el .env.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const BIN_DIR = path.resolve(__dirname, '../bin');

// Mapea plataforma/arquitectura al nombre del asset del release.
function assetName() {
    const platform = os.platform();
    const arch = os.arch();
    if (platform === 'win32') return { asset: 'go2rtc_win64.zip', zip: true, out: 'go2rtc.exe' };
    if (platform === 'darwin') {
        return { asset: arch === 'arm64' ? 'go2rtc_mac_arm64.zip' : 'go2rtc_mac_amd64.zip', zip: true, out: 'go2rtc' };
    }
    if (platform === 'linux') {
        const map = { x64: 'go2rtc_linux_amd64', arm64: 'go2rtc_linux_arm64', arm: 'go2rtc_linux_arm' };
        const asset = map[arch];
        if (!asset) throw new Error(`Arquitectura Linux no soportada: ${arch}`);
        return { asset, zip: false, out: 'go2rtc' };
    }
    throw new Error(`Plataforma no soportada: ${platform}`);
}

function download(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const get = (u) => https.get(u, { headers: { 'User-Agent': 'node' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return get(res.headers.location); // seguir redirecciones
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode} al descargar ${u}`));
            }
            res.pipe(file);
            file.on('finish', () => file.close(resolve));
        });
        get(url).on('error', reject);
    });
}

(async () => {
    const { asset, zip, out } = assetName();
    const url = `https://github.com/AlexxIT/go2rtc/releases/latest/download/${asset}`;
    fs.mkdirSync(BIN_DIR, { recursive: true });

    const downloadPath = path.join(BIN_DIR, asset);
    const outPath = path.join(BIN_DIR, out);

    console.log(`Descargando go2rtc: ${url}`);
    await download(url, downloadPath);

    if (zip) {
        console.log('Descomprimiendo...');
        if (os.platform() === 'win32') {
            execFileSync('powershell', ['-NoProfile', '-Command',
                `Expand-Archive -Force -Path "${downloadPath}" -DestinationPath "${BIN_DIR}"`]);
        } else {
            execFileSync('unzip', ['-o', downloadPath, '-d', BIN_DIR]);
        }
        fs.unlinkSync(downloadPath);
    } else {
        fs.renameSync(downloadPath, outPath);
    }

    if (os.platform() !== 'win32') {
        fs.chmodSync(outPath, 0o755);
    }

    console.log(`✓ go2rtc listo en: ${outPath}`);
})().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
});
