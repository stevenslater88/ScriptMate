import { runParserTests, parseScript } from './services/smartScriptParser';

console.log('=== Running Parser Built-in Tests ===');
const results = runParserTests();
results.forEach((r: any) => {
  console.log(`${r.pass ? '✓' : '✗'} ${r.name}: ${r.detail}`);
});

const allPassed = results.every((r: any) => r.pass);
console.log(`\nBuilt-in tests: ${allPassed ? 'ALL PASSED' : 'SOME FAILED'}`);

// Additional tests
console.log('\n=== Additional Tests ===');

// Test empty input
const emptyResult = parseScript('');
const emptyPass = emptyResult.detectedCharacters.length === 0 && emptyResult.warnings.length > 0;
console.log(`${emptyPass ? '✓' : '✗'} Empty input handling: ${emptyResult.detectedCharacters.length} chars, ${emptyResult.warnings.length} warnings`);

// Test single character (monologue)
const monoResult = parseScript('JACK\nTo be or not to be, that is the question.');
const monoPass = monoResult.detectedCharacters.length === 1 && monoResult.warnings.some((w: string) => w.includes('one character'));
console.log(`${monoPass ? '✓' : '✗'} Single character warning: ${monoResult.warnings.join('; ')}`);

// Test with scene headings enabled
const headingResult = parseScript('INT. APARTMENT - NIGHT\n\nJACK\nHello there.', { includeHeadings: true });
const headingPass = headingResult.stats.headingLines === 1;
console.log(`${headingPass ? '✓' : '✗'} Scene heading detection: ${headingResult.stats.headingLines} headings`);

// Test with scene headings disabled
const headingOffResult = parseScript('INT. APARTMENT - NIGHT\n\nJACK\nHello there.', { includeHeadings: false });
const headingOffPass = headingOffResult.stats.headingLines === 0 && headingOffResult.stats.actionLines >= 1;
console.log(`${headingOffPass ? '✓' : '✗'} Scene heading as action (when off): headings=${headingOffResult.stats.headingLines}, actions=${headingOffResult.stats.actionLines}`);

// Test multi-speaker
const multiResult = parseScript(`SARAH
I can't believe you're leaving tomorrow.

MIKE
I have to. The job starts Monday.

(Sarah turns away, looking out the window)

SARAH
You could have said no.`);
const multiPass = multiResult.detectedCharacters.length === 2 && 
                  multiResult.stats.parentheticalLines === 1 &&
                  multiResult.stats.dialogueLines >= 3;
console.log(`${multiPass ? '✓' : '✗'} Multi-speaker parsing: ${multiResult.detectedCharacters.length} chars, ${multiResult.stats.dialogueLines} dialogue, ${multiResult.stats.parentheticalLines} parens`);

// Summary
const additionalTests = [emptyPass, monoPass, headingPass, headingOffPass, multiPass];
const additionalPassed = additionalTests.every(p => p);

console.log('\n=== Summary ===');
console.log(`Built-in tests: ${allPassed ? 'PASS' : 'FAIL'} (${results.filter((r: any) => r.pass).length}/${results.length})`);
console.log(`Additional tests: ${additionalPassed ? 'PASS' : 'FAIL'} (${additionalTests.filter(p => p).length}/${additionalTests.length})`);
