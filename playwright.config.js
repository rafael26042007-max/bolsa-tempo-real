// Configuração dos testes automáticos (Playwright Test)
// Rodar no PC:  npm test          (precisa de: npm install && npx playwright install chromium)
// No GitHub:    roda sozinho a cada git push (.github/workflows/publicar.yml)
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,        // no GitHub, tenta 1 vez de novo antes de reprovar
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: "http://localhost:8765",
    // PW_CHROME = caminho de um Chrome já instalado (opcional)
    launchOptions: process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {},
  },
  // Sobe um servidor local com o site antes dos testes
  webServer: {
    command: "python3 -m http.server 8765",
    url: "http://localhost:8765/index.html",
    reuseExistingServer: !process.env.CI,
  },
});
