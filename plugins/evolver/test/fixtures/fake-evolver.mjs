#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('--slow')) await new Promise((resolve) => setTimeout(resolve, 7_000));
console.log(`fake evolver ${args.join(' ')} in ${process.cwd()}`);
if (args.includes('--fail')) process.exit(2);
