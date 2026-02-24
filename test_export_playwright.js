const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();

    console.log("Navigating to index.html...");
    await page.goto(`file://${path.resolve('index.html')}`);

    console.log("Clicking Export Standalone Game button...");
    const downloadPromise = page.waitForEvent('download');
    await page.click('#btn-export-standalone');
    const download = await downloadPromise;

    const exportPath = path.resolve('test_standalone_ui.html');
    await download.saveAs(exportPath);
    console.log(`Saved exported game to ${exportPath}`);

    await browser.close();
})();
