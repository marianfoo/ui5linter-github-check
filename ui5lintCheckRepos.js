import { promises as fsPromises } from 'fs';
import fs from 'fs';
import { execSync } from "child_process";
import path from 'path';
import os from 'os';

// Get @ui5/linter version
const UI5_LINTER_VERSION = execSync('npm list @ui5/linter --depth=0 --json').toString();
const UI5_LINTER_VERSION_PARSED = JSON.parse(UI5_LINTER_VERSION);
const UI5_LINTER_VERSION_NUMBER = UI5_LINTER_VERSION_PARSED.dependencies['@ui5/linter'].version;

// Use the version in the processed repos filename
const PROCESSED_REPOS_FILENAME = `processed-repos_${UI5_LINTER_VERSION_NUMBER.replace(/\./g, '_')}.json`;
const UI5_PROJECT_ANALYSIS_FILENAME = `ui5-project-analysis_${UI5_LINTER_VERSION_NUMBER.replace(/\./g, '_')}.json`;

// Function to clone repository
async function cloneRepo(repoUrl, tempDir) {
  execSync(`git clone ${repoUrl} ${tempDir}`, { stdio: 'inherit' });
}

// Function to find UI5 apps in a repository recursively
async function findUI5Apps(dir) {
  const apps = [];
  const items = await fsPromises.readdir(dir, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      const ui5YamlPath = path.join(fullPath, 'ui5.yaml');
      const webappPath = path.join(fullPath, 'webapp');
      const manifestPath = path.join(webappPath, 'manifest.json');
      
      if (fs.existsSync(ui5YamlPath) && fs.existsSync(webappPath) && fs.existsSync(manifestPath)) {
        apps.push(fullPath);
      } else {
        // Recursively search in subdirectories
        const subApps = await findUI5Apps(fullPath);
        apps.push(...subApps);
      }
    }
  }
  
  return apps;
}

// Function to run UI5 linter
async function runUI5Linter(appPath) {
  try {
    const result = execSync(`npx @ui5/linter --format json`, { cwd: appPath, encoding: 'utf8' });
    return JSON.parse(result);
  } catch (error) {
    // The linter found issues, which is not a failure of the linter itself
    if (error.stdout) {
      try {
        return JSON.parse(error.stdout);
      } catch (parseError) {
        console.error(`Error parsing linter output: ${parseError.message}`);
      }
    }
    // Only log as an error if there's no stdout (which would indicate a real failure)
    if (!error.stdout) {
      console.error(`Error running UI5 linter for ${appPath}: ${error.message}`);
    }
    return null;
  }
}

// Function to load UI5 repos from ui5-repos.json
async function loadUI5Repos() {
  try {
    const data = await fsPromises.readFile('ui5-repos.json', 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading UI5 repos:', error.message);
    return [];
  }
}

// Function to load processed repo IDs
async function loadProcessedRepos() {
  try {
    const data = await fsPromises.readFile(PROCESSED_REPOS_FILENAME, 'utf8');
    return new Set(JSON.parse(data));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return new Set();
    }
    throw error;
  }
}

// Function to save processed repo IDs
async function saveProcessedRepos(processedRepos) {
  await fsPromises.writeFile(PROCESSED_REPOS_FILENAME, JSON.stringify(Array.from(processedRepos)));
}

// Function to process a batch of repositories
async function processBatch(repos, processedRepos) {
  const results = [];

  for (const repo of repos) {
    if (processedRepos.has(repo.id.toString())) {
      console.log(`Skipping already processed repository: ${repo.full_name}`);
      continue;
    }

    console.log(`\nProcessing repository: ${repo.full_name}`);
    const tempDir = path.join(os.tmpdir(), `ui5-project-${repo.id}`);
    
    try {
      console.log(`Cloning ${repo.html_url} to ${tempDir}...`);
      await cloneRepo(repo.html_url, tempDir);
      
      const ui5Apps = await findUI5Apps(tempDir);
      console.log(`Found ${ui5Apps.length} UI5 app(s) in the repository.`);
      
      const repoResult = {
        repoMetadata: {
          id: repo.id,
          html_url: repo.html_url
        },
        apps: []
      };

      for (const appPath of ui5Apps) {
        console.log(`Processing UI5 app in ${appPath}`);
        const linterResult = await runUI5Linter(appPath);
        if (linterResult) {
          console.log('Linter completed successfully.');
          repoResult.apps.push({
            appPath: path.relative(tempDir, appPath),
            linterResult
          });
        } else {
          console.log('Linter failed or returned no results.');
        }
      }

      results.push(repoResult);
      processedRepos.add(repo.id.toString());
    } catch (error) {
      console.error(`Error processing ${repo.full_name}:`, error.message);
    } finally {
      console.log(`Cleaning up temporary directory: ${tempDir}`);
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    }
  }

  return results;
}

// Main function
async function main() {
  console.log("Starting UI5 project processing...");
  console.log(`Using @ui5/linter version: ${UI5_LINTER_VERSION_NUMBER}`);
  
  // Load UI5 repos from ui5-repos.json
  const repos = await loadUI5Repos();
  console.log(`Loaded ${repos.length} UI5 projects from ui5-repos.json`);

  // Load processed repo IDs
  const processedRepos = await loadProcessedRepos();
  console.log(`Loaded ${processedRepos.size} processed repo IDs from ${PROCESSED_REPOS_FILENAME}`);

  // Filter out already processed repos
  const unprocessedRepos = repos.filter(repo => !processedRepos.has(repo.id.toString()));
  console.log(`Found ${unprocessedRepos.length} unprocessed repos`);

  const batchSize = 20;
  const numBatches = 5;
  let allResults = [];

  for (let i = 0; i < unprocessedRepos.length; i += batchSize * numBatches) {
    const batchPromises = [];

    for (let j = 0; j < numBatches; j++) {
      const start = i + j * batchSize;
      const end = start + batchSize;
      const batch = unprocessedRepos.slice(start, end);
      batchPromises.push(processBatch(batch, processedRepos));
    }

    const batchResults = await Promise.all(batchPromises);
    allResults = allResults.concat(batchResults.flat());

    console.log(`Processed ${Math.min(i + batchSize * numBatches, unprocessedRepos.length)} out of ${unprocessedRepos.length} repositories`);
    
    // Save intermediate results and processed repo IDs
    await fsPromises.writeFile(UI5_PROJECT_ANALYSIS_FILENAME, JSON.stringify(allResults, null, 2));
    await saveProcessedRepos(processedRepos);
  }

  console.log('\nAll repositories processed. Saving final results...');
  
  await fsPromises.writeFile(UI5_PROJECT_ANALYSIS_FILENAME, JSON.stringify(allResults, null, 2));
  await saveProcessedRepos(processedRepos);
  
  console.log(`Results saved to ${UI5_PROJECT_ANALYSIS_FILENAME}`);
  console.log(`Processed repository IDs saved to ${PROCESSED_REPOS_FILENAME}`);
}

// Run the main function
main().catch(console.error);
