const fs = require('fs');
const file = 'src/App.ts';
let code = fs.readFileSync(file, 'utf8');

// The pattern to match: observedAt, optionally followed by whitespace, then }
code = code.replace(/observedAt,(\s*)\}\);/g, 'observedAt,$1  evidenceIds: [],$1});');
// The pattern to match: observedAt: <something>, optionally followed by whitespace, then }
code = code.replace(/observedAt:\s*([^,]+),?(\s*)\}\);/g, 'observedAt: $1,$2  evidenceIds: [],$2});');

// For merged.set(key, signal); it's an assignment, let's see how `signal` is defined.
// Actually we can just run typecheck to see what's left.
fs.writeFileSync(file, code);

const tb = 'src/services/temporal-baseline.ts';
let tbCode = fs.readFileSync(tb, 'utf8');
tbCode = tbCode.replace(/observedAt:\s*([^,]+),?(\s*)\}\);/g, 'observedAt: $1,$2  evidenceIds: [],$2});');
fs.writeFileSync(tb, tbCode);
