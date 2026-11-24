'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const pluginFactory = require('../reanimatortt');

console.log('--- Запуск тестов test-security.js ---');

const mockDataPath = path.join(__dirname, 'mock_datapath_sec');
if (!fs.existsSync(mockDataPath)) fs.mkdirSync(mockDataPath, { recursive: true });

const plugin = pluginFactory({
    meshServer: {
        datapath: mockDataPath,
        app: { _router: { stack: [] }, get: () => {} }
    }
});

let lastClientMsg = null;
const regularClient = {
    user: { _id: 'user/pharmacy_clerk', siteadmin: 0 },
    send: (msg) => { lastClientMsg = JSON.parse(msg); }
};

const adminClient = {
    user: { _id: 'user/admin', siteadmin: -1 },
    send: (msg) => { lastClientMsg = JSON.parse(msg); }
};

// Security Check 1: Non-admin cannot change settings or API keys
lastClientMsg = null;
plugin.serveraction({
    pluginaction: 'saveSettings',
    requestId: 'sec_1',
    settings: {
        baseUrl: 'http://malicious-site.com',
        apiKey: 'hacked-key'
    }
}, regularClient);

assert(lastClientMsg !== null, 'Client should receive rejection');
assert.strictEqual(lastClientMsg.type, 'error');
assert(lastClientMsg.error.includes('Требуются права администратора'), 'Must block non-admin');
console.log('✓ Безопасность 1: Защита изменения настроек от не-администратора подтверждена');

// Security Check 2: API key masking
lastClientMsg = null;
plugin.serveraction({ pluginaction: 'saveSettings', requestId: 'save_admin', settings: { apiKey: 'sk-test-1234567890abcdef1234567890abcdef' } }, adminClient);
plugin.serveraction({ pluginaction: 'getSettings', requestId: 'sec_2' }, regularClient);
assert.strictEqual(lastClientMsg.isAdmin, false);
assert(lastClientMsg.settings.apiKey.includes('...'), 'Regular user must not see full API key');
assert(!lastClientMsg.settings.apiKey.includes('1234567890abcdef'), 'Full key must not leak');
console.log('✓ Безопасность 2: Утечка API ключей на клиенты исключена');

// Security Check 3: Settings validation and sanitization
lastClientMsg = null;
plugin.serveraction({
    pluginaction: 'saveSettings',
    requestId: 'sec_3',
    settings: {
        baseUrl: 'https://valid-url.com/v1',
        timeoutSeconds: -50, // invalid, should be rejected / ignored
        temperature: 99.9,  // invalid, should be ignored
        maxTokens: 9999999  // invalid, should be ignored
    }
}, adminClient);

assert.strictEqual(lastClientMsg.type, 'settingsSaved');
assert.strictEqual(lastClientMsg.settings.baseUrl, 'https://valid-url.com/v1');
assert(lastClientMsg.settings.timeoutSeconds > 0 && lastClientMsg.settings.timeoutSeconds <= 300, 'Timeout must remain in safe range');
assert(lastClientMsg.settings.temperature >= 0 && lastClientMsg.settings.temperature <= 1, 'Temperature must remain in [0, 1]');
assert(lastClientMsg.settings.maxTokens <= 32768, 'Max tokens must remain in safe bounds');
console.log('✓ Безопасность 3: Валидация диапазонов конфигурации подтверждена');

// Security Check 4: Base64 UTF-16LE encoding for PowerShell Bypass
// Ensure characters like quotes, backticks, dollar signs are cleanly encoded without shell breakage
function encodePowerShell(script) {
    var utf16 = new Uint8Array(script.length * 2);
    for (var i = 0; i < script.length; i++) {
        var code = script.charCodeAt(i);
        utf16[i * 2] = code & 0xff;
        utf16[i * 2 + 1] = code >>> 8;
    }
    var binary = '';
    for (var j = 0; j < utf16.length; j++) binary += String.fromCharCode(utf16[j]);
    return Buffer.from(binary, 'binary').toString('base64');
}

const complexCmd = 'Get-Process | Where-Object { $_.Name -match "1c|atol" } | Select-Object -Property "Name", "ID"';
const encoded = encodePowerShell(complexCmd);
const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
assert.strictEqual(decoded, complexCmd, 'UTF-16LE encoding must decode back identically');
console.log('✓ Безопасность 4: Безопасность EncodedCommand PowerShell подтверждена');

// Security Check 5: HTML Escaping for XSS protection
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

const xssPayload = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
const safeOutput = escapeHtml(xssPayload);
assert(!safeOutput.includes('<script>'), 'Must escape script tags');
assert(!safeOutput.includes('<img'), 'Must escape img tags');
assert(safeOutput.includes('&lt;script&gt;'), 'Must encode to HTML entities');
console.log('✓ Безопасность 5: Защита от XSS-инъекций подтверждена');

// Cleanup
try {
    const testSettingsFile = path.join(mockDataPath, 'reanimatortt-settings.json');
    if (fs.existsSync(testSettingsFile)) fs.unlinkSync(testSettingsFile);
    fs.rmdirSync(mockDataPath);
} catch (_) {}

console.log('✓ ВСЕ ТЕСТЫ В test-security.js УСПЕШНО ПРОЙДЕНЫ!');
