import { Octokit } from "@octokit/rest";
import { promises as fsPromises } from 'fs';
import dotenv from 'dotenv';
import path from 'path';

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
  // Search query to find repositories with ui5.yaml in the root
  const query = "filename:ui5.yaml path:/";
  let allItems = [];
  let page = 1;
  
  // Continue searching until we reach the limit or run out of results
  while (allItems.length < limit) {
    try {
      // Search GitHub API for code matching our query
      const result = await octokit.search.code({ q: query, per_page: 100, page: page });
      if (result.data.items.length === 0) break; // No more results
      
      allItems = allItems.concat(result.data.items);
      page++;
      
      // Delay to respect GitHub API rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Error searching for UI5 projects: ${error.message}`);
      break;
    }
  }

  console.log(`Found ${allItems.length} potential UI5 projects.`);
  return allItems.slice(0, limit);
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

// Function to load existing repos
async function loadExistingRepos() {
  try {
    const data = await fsPromises.readFile('ui5-repos.json', 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

// Main function
async function main() {
  console.log("Starting UI5 project search...");
  
  // Search for potential UI5 projects
  const repos = await searchUI5Projects(100000);
  console.log(`Found ${repos.length} potential UI5 projects.`);

  // Load existing repos from the JSON file
  const existingRepos = await loadExistingRepos();
  // Create a Set of existing repo IDs for faster lookup
  const existingRepoIds = new Set(existingRepos.map(repo => repo.id));

  const reposWithMetadata = [];

  // Process each potential UI5 project
  for (const repo of repos) {
    if (!existingRepoIds.has(repo.repository.id)) {
      // Fetch metadata only for new repositories
      console.log(`Fetching metadata for ${repo.repository.full_name}...`);
      const metadata = await getRepoMetadata(repo.repository.full_name);
      if (metadata) {
        reposWithMetadata.push(metadata);
      }
    } else {
      // Skip fetching metadata for existing repositories
      console.log(`Skipping existing repo: ${repo.repository.full_name}`);
    }
  }

  // Combine existing repos with newly found repos
  const updatedRepos = [...existingRepos, ...reposWithMetadata];

  // Write the updated list of repos to the JSON file
  await fsPromises.writeFile('ui5-repos.json', JSON.stringify(updatedRepos, null, 2));
  
  console.log('Results saved to ui5-repos.json');
}

// Run the main function
main().catch(console.error);