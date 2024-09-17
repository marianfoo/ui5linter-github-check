import fs from 'fs';
import { execSync } from 'child_process';

// Get @ui5/linter version
const UI5_LINTER_VERSION = execSync('npm list @ui5/linter --depth=0 --json').toString();
const UI5_LINTER_VERSION_PARSED = JSON.parse(UI5_LINTER_VERSION);
const UI5_LINTER_VERSION_NUMBER = UI5_LINTER_VERSION_PARSED.dependencies['@ui5/linter'].version;

// Use the version in the input and output filenames
const INPUT_FILENAME = `ui5-project-analysis_${UI5_LINTER_VERSION_NUMBER.replace(/\./g, '_')}.json`;
const OUTPUT_FILENAME = `linter-analysis-report_${UI5_LINTER_VERSION_NUMBER.replace(/\./g, '_')}.json`;

console.log(`Using @ui5/linter version: ${UI5_LINTER_VERSION_NUMBER}`);
console.log(`Reading from: ${INPUT_FILENAME}`);
console.log(`Writing to: ${OUTPUT_FILENAME}`);

// Read the JSON file
const data = JSON.parse(fs.readFileSync(INPUT_FILENAME, 'utf8'));

// Initialize counters and storage
let totalApps = 0;
let totalLinterErrors = 0;
let ruleViolations = {};
let reposWithErrors = new Set();
let deprecatedApiMessages = {};

// Analyze the data
data.forEach(repo => {
  if (repo.apps && repo.apps.length > 0) {
    repo.apps.forEach(app => {
      totalApps++;
      if (app.linterResult) {
        app.linterResult.forEach(result => {
          if (result.messages && result.messages.length > 0) {
            totalLinterErrors += result.errorCount;
            reposWithErrors.add(repo.repoMetadata.html_url);
            result.messages.forEach(message => {
              if (!ruleViolations[message.ruleId]) {
                ruleViolations[message.ruleId] = 0;
              }
              ruleViolations[message.ruleId]++;
              
              // Check for "no-deprecated-api" ruleId
              if (message.ruleId === "no-deprecated-api") {
                if (!deprecatedApiMessages[message.message]) {
                  deprecatedApiMessages[message.message] = 0;
                }
                deprecatedApiMessages[message.message]++;
              }
            });
          }
        });
      }
    });
  }
});

// Sort deprecatedApiMessages by count descending
const sortedDeprecatedApiMessages = Object.entries(deprecatedApiMessages)
  .sort(([, a], [, b]) => b - a)
  .reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {});

// Sort rule violations by count
const sortedViolations = Object.entries(ruleViolations)
  .sort((a, b) => b[1] - a[1])
  .reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {});

// Prepare the report
const report = {
  ui5LinterVersion: UI5_LINTER_VERSION_NUMBER,
  totalRepositories: data.length,
  repositoriesWithApps: data.filter(repo => repo.apps && repo.apps.length > 0).length,
  totalApps: totalApps,
  totalLinterErrors: totalLinterErrors,
  repositoriesWithErrors: reposWithErrors.size,
  topRuleViolations: Object.entries(sortedViolations).slice(0, 5).reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {}),
  allRuleViolations: sortedViolations,
  deprecatedApiMessages: sortedDeprecatedApiMessages
};

// Output the report
console.log(JSON.stringify(report, null, 2));

// Write the report to a file
fs.writeFileSync(OUTPUT_FILENAME, JSON.stringify(report, null, 2));

console.log(`Analysis complete. Report saved to ${OUTPUT_FILENAME}`);