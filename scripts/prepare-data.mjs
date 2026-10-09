#!/usr/bin/env node
// First start after cloning: creates dane/ from the neutral template (data-template/).
// Existing files are never touched, so it is safe to run after every npm install.
import { prepareData } from './lib.mjs';

const created = prepareData();
if (created.length) console.log(`Utworzono dane/ z szablonu: ${created.join(', ')}`);
