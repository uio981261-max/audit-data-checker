// Load the identical vendored browser bundle for Node tests and sample generation.
// No network, extra copy, or package installation is needed.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const Module = require('node:module');
const filename = join(__dirname, 'xlsx.full.min.js');
const bundle = new Module(filename, module);
bundle.filename = filename;
bundle.paths = module.paths;
bundle._compile(readFileSync(filename, 'utf8'), filename);
module.exports = bundle.exports;
