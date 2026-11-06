// Launch headless Chromium: ARCH_TEXT_CHROMIUM if set, otherwise Playwright's own copy.
import { chromium } from 'playwright-core';

export function launch() {
  const executablePath = process.env.ARCH_TEXT_CHROMIUM || undefined;
  return chromium.launch({ executablePath });
}
