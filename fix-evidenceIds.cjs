const fs = require('fs');
const file = 'src/App.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/observedAt,(\s*)\}\);/g, 'observedAt,$1  evidenceIds: [],$1});');
code = code.replace(/observedAt:\s*([^,]+),?(\s*)\}\);/g, 'observedAt: $1,$2  evidenceIds: [],$2});');

fs.writeFileSync(file, code);
