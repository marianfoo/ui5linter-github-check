import fs from 'fs';

// Read the JSON file
const data = JSON.parse(fs.readFileSync('ui5-project-analysis.json', 'utf8'));

// Initialize counters and storage
let totalApps = 0;
let totalLinterErrors = 0;
let ruleViolations = {};
let reposWithErrors = new Set();

// Analyze the data
data.forEach(repo => {
  if (repo.apps && repo.apps.length > 0) {
    repo.apps.forEach(app => {
      totalApps++;
      if (app.linterResult) {
        app.linterResult.forEach(result => {
          if (result.messages && result.messages.length > 0) {
            totalLinterErrors += result.errorCount;
            reposWithErrors.add(repo.repoMetadata.full_name);
            result.messages.forEach(message => {
              if (!ruleViolations[message.ruleId]) {
                ruleViolations[message.ruleId] = 0;
              }
              ruleViolations[message.ruleId]++;
            });
          }
        });
      }
    });
  }
});

// Sort rule violations by count
const sortedViolations = Object.entries(ruleViolations)
  .sort((a, b) => b[1] - a[1])
  .reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {});

// Prepare the report
const report = {
  totalRepositories: data.length,
  repositoriesWithApps: data.filter(repo => repo.apps && repo.apps.length > 0).length,
  totalApps: totalApps,
  totalLinterErrors: totalLinterErrors,
  repositoriesWithErrors: reposWithErrors.size,
  topRuleViolations: Object.entries(sortedViolations).slice(0, 5).reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {}),
  allRuleViolations: sortedViolations
};

// Output the report
console.log(JSON.stringify(report, null, 2));

// Optionally, write the report to a file
fs.writeFileSync('linter-analysis-report.json', JSON.stringify(report, null, 2));