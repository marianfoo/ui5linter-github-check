import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';

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

// Function to process a single file pair
function processFilePair(inputFile, outputFile) {
  console.log(`Processing: ${inputFile} -> ${outputFile}`);
  
  // Read the JSON file
  const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

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
    deprecatedApiMessages: sortedDeprecatedApiMessages,
    ruleViolationDetails: {}
  };

  // Process all rule violations
  for (const [ruleId, count] of Object.entries(sortedViolations)) {
    report.ruleViolationDetails[ruleId] = {
      count: count,
      messages: {}
    };
  }

  // Reanalyze the data to collect detailed messages for each rule
  data.forEach(repo => {
    if (repo.apps && repo.apps.length > 0) {
      repo.apps.forEach(app => {
        if (app.linterResult) {
          app.linterResult.forEach(result => {
            if (result.messages && result.messages.length > 0) {
              result.messages.forEach(message => {
                if (!report.ruleViolationDetails[message.ruleId].messages[message.message]) {
                  report.ruleViolationDetails[message.ruleId].messages[message.message] = 0;
                }
                report.ruleViolationDetails[message.ruleId].messages[message.message]++;
              });
            }
          });
        }
      });
    }
  });

  // Sort messages for each rule by count
  for (const ruleId in report.ruleViolationDetails) {
    report.ruleViolationDetails[ruleId].messages = Object.entries(report.ruleViolationDetails[ruleId].messages)
      .sort(([, a], [, b]) => b - a)
      .reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {});
  }

  // Write the report to a file
  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));

  console.log(`Analysis complete. Report saved to ${outputFile}`);
  return report;
}

// Process all matching file pairs
const inputFiles = fs.readdirSync('.').filter(file => file.startsWith('ui5-project-analysis'));
const reports = {};

inputFiles.forEach(inputFile => {
  const versionMatch = inputFile.match(/ui5-project-analysis_(.+)\.json/);
  if (versionMatch) {
    const version = versionMatch[1].replace(/_/g, '.');
    const outputFile = `linter-analysis-report_${versionMatch[1]}.json`;
    reports[version] = processFilePair(inputFile, outputFile);
  }
});

// Output a summary of all processed reports
console.log('\nSummary of all processed reports:');
for (const [version, report] of Object.entries(reports)) {
  console.log(`\nVersion ${version}:`);
  console.log(`Total Apps: ${report.totalApps}`);
  console.log(`Total Linter Errors: ${report.totalLinterErrors}`);
  console.log('Top 5 Rule Violations:');
  Object.entries(report.topRuleViolations).forEach(([ruleId, count]) => {
    console.log(`  ${ruleId}: ${count}`);
  });
}