#!/usr/bin/env node
// node-pty 1.x on macOS: the bundled spawn-helper ships without the execute permission,
// and then the in-app terminal fails with "posix_spawnp failed". We fix it after every npm install.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';

const dir = path.join(ROOT, 'node_modules/node-pty/prebuilds');
if (fs.existsSync(dir)) {
  for (const platform of fs.readdirSync(dir)) {
    const helper = path.join(dir, platform, 'spawn-helper');
    if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
  }
}
