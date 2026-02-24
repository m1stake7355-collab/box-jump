const { chromium } = require('playwright');
const path = require('path');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const fileUrl = 'file:///' + path.resolve('index.html').replace(/\\/g, '/');
    await page.goto(fileUrl);

    // Switch to editor
    await page.keyboard.press('Tab');

    // Select Platform tool
    await page.click('#btn-tool-platform');

    // Drag a platform
    await page.mouse.move(200, 200);
    await page.mouse.down();
    await page.mouse.move(300, 220);
    await page.mouse.up();

    // Select Cursor
    await page.click('#btn-tool-cursor');

    // Click platform
    await page.mouse.click(250, 210);

    // Set properties to non-zero
    await page.fill('#prop-platform-speed', '50');
    await page.fill('#prop-platform-tx', '100');
    await page.fill('#prop-platform-ty', '100');
    await page.keyboard.press('Tab'); // Blur input

    // Play test
    await page.click('#btn-test-level');
    await page.waitForTimeout(500); // 500ms simulation

    // Edit again
    await page.keyboard.press('Tab');

    // Click platform again
    await page.mouse.click(250, 210);

    // Set tx to 0 and ty to 0
    await page.fill('#prop-platform-tx', '0');
    await page.fill('#prop-platform-ty', '0');
    await page.keyboard.press('Tab'); // blur

    // Get state before play
    const stateBefore = await page.evaluate(() => JSON.stringify(game.currentLevelData.platforms));
    console.log("Before 2nd play:", stateBefore);

    // Play test AGAIN
    await page.click('#btn-test-level');
    await page.waitForTimeout(50);

    // Get state AFTER play
    const stateAfter = await page.evaluate(() => JSON.stringify(game.currentLevelData.platforms));
    console.log("After 2nd play:", stateAfter);

    await browser.close();
})();
