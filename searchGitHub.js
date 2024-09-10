import { Octokit } from "@octokit/rest";
import { promises as fsPromises } from 'fs';
import fs from 'fs';
import path from "path";
import { execSync } from "child_process";
import os from "os";
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// GitHub token from .env file
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  console.error("GitHub token not found. Please set GITHUB_TOKEN in your .env file.");
  process.exit(1);
}

// Initialize Octokit
const octokit = new Octokit({ auth: GITHUB_TOKEN });

// Function to search for UI5 projects
async function searchUI5Projects(limit = 100) {
  const query = "filename:ui5.yaml path:/";
  let allItems = [];
  let page = 1;
  
  while (allItems.length < limit) {
    try {
      const result = await octokit.search.code({ q: query, per_page: 100, page: page });
      if (result.data.items.length === 0) break;
      
      allItems = allItems.concat(result.data.items);
      page++;
      
      // GitHub API has a rate limit, so we need to wait a bit between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Error searching for UI5 projects: ${error.message}`);
      break;
    }
  }

  console.log(`Found ${allItems.length} potential UI5 projects.`);
  return allItems.slice(0, limit);
}

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
    const result = execSync(`npx ui5lint --format json`, { cwd: appPath, encoding: 'utf8' });
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
      console.error(`Error running UI5 linter: ${error.message}`);
    }
    return null;
  }
}

// Function to get repository metadata
async function getRepoMetadata(repoFullName) {
  try {
    const [owner, repo] = repoFullName.split('/');
    const { data } = await octokit.repos.get({ owner, repo });
    return data;
  } catch (error) {
    console.error(`Error fetching metadata for ${repoFullName}:`, error.message);
    return null;
  }
}

// Function to load processed repo IDs
async function loadProcessedRepos() {
  try {
    const data = await fsPromises.readFile('processed-repos.json', 'utf8');
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
  await fsPromises.writeFile('processed-repos.json', JSON.stringify(Array.from(processedRepos)));
}

// Function to process a batch of repositories
async function processBatch(repos, processedRepos) {
  const results = [];

  for (const repo of repos) {
    if (processedRepos.has(repo.repository.id.toString())) {
      console.log(`Skipping already processed repository: ${repo.repository.full_name}`);
      continue;
    }

    console.log(`\nProcessing repository: ${repo.repository.full_name}`);
    const tempDir = path.join(os.tmpdir(), `ui5-project-${repo.repository.id}`);
    
    try {
      console.log(`Fetching repository metadata...`);
      const repoMetadata = await getRepoMetadata(repo.repository.full_name);

      console.log(`Cloning ${repo.repository.html_url} to ${tempDir}...`);
      await cloneRepo(repo.repository.html_url, tempDir);
      
      const ui5Apps = await findUI5Apps(tempDir);
      console.log(`Found ${ui5Apps.length} UI5 app(s) in the repository.`);
      
      const repoResult = {
        repoMetadata,
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
      processedRepos.add(repo.repository.id.toString());
    } catch (error) {
      console.error(`Error processing ${repo.repository.full_name}:`, error.message);
    } finally {
      console.log(`Cleaning up temporary directory: ${tempDir}`);
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    }
  }

  return results;
}

// Main function
async function main() {
  console.log("Starting UI5 project search...");
  
  const repos = await searchUI5Projects(10000);
  console.log(`Found ${repos.length} potential UI5 projects.`);

  const processedRepos = await loadProcessedRepos();
  const batchSize = 20;
  const numBatches = 5;
  let allResults = [];

  for (let i = 0; i < repos.length; i += batchSize * numBatches) {
    const batchPromises = [];

    for (let j = 0; j < numBatches; j++) {
      const start = i + j * batchSize;
      const end = start + batchSize;
      const batch = repos.slice(start, end);
      batchPromises.push(processBatch(batch, processedRepos));
    }

    const batchResults = await Promise.all(batchPromises);
    allResults = allResults.concat(batchResults.flat());

    console.log(`Processed ${Math.min(i + batchSize * numBatches, repos.length)} out of ${repos.length} repositories`);
  }

  console.log('\nAll repositories processed. Saving results...');
  
  // Load existing results if any
  let existingResults = [];
  try {
    const existingData = await fsPromises.readFile('ui5-project-analysis.json', 'utf8');
    existingResults = JSON.parse(existingData);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Error reading existing results:', error.message);
    }
  }

  // Combine new results with existing results
  const combinedResults = [...existingResults, ...allResults];

  await fsPromises.writeFile('ui5-project-analysis.json', JSON.stringify(combinedResults, null, 2));
  await saveProcessedRepos(processedRepos);
  
  console.log('Results saved to ui5-project-analysis.json');
  console.log('Processed repository IDs saved to processed-repos.json');
}

// Run the main function
main().catch(console.error);
