#!/usr/bin/env node
import { recordCliJob } from '../lib/cli-job.mjs';
import { runEvolverCli } from '../lib/commands.mjs';

const [id, cwd, ...args] = process.argv.slice(2);
recordCliJob(id, args, await runEvolverCli(args, { cwd }));
