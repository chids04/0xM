import { test, expect } from '@playwright/test';


test.describe('Authentication & Authorization Tests', () => {
  test('unauthenticated user should be redirected to login page', async ({ page }) => {
    await page.goto('/profile');
    
    await expect(page).toHaveURL(/.*signin/);
  });

  test('user can log in and access protected pages', async ({ page }) => {
    //requires a test user to be created in firebase auth
    await page.goto('/signin');

    await page.fill('input[type="email"]', 'guyepic39@gmail.com');
    await page.fill('input[type="password"]', 'Password123');
    await page.screenshot({ path: 'before-login.png' });
    await page.click('button:has-text("Login"), button:has-text("login")');
    await page.screenshot({ path: 'after-login.png' });
    await page.waitForURL(/\/profile/);
    
    await expect(page.locator('text=Your Profile')).toBeVisible();
  });

  test('wallet creation modal should appear for users without a linked wallet', async ({ page }) => {
    await page.goto('/signin');

    //this user needs to be created before tests are run
    await page.fill('input[type="email"]', 'guyepic39@gmail.com'); 
    await page.fill('input[type="password"]', 'Password123');
    
    //wait for the response from firebase auth
    const responsePromise = page.waitForResponse(response => 
      response.url().includes('firebase') && response.status() === 200
    );
    
    await page.click('button:has-text("Login")');
    await responsePromise;
    
    await page.waitForURL('**', { timeout: 60000 });
    
    //verify wallet creation modal is visible
    await page.screenshot({ path: 'wallet-creation-modal.png' });
    await expect(page.locator('text=Connect Your Wallet')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Use MetaMask to connect')).toBeVisible();
    await expect(page.locator('button:has-text("Connect MetaMask")')).toBeVisible();
    
  });
});