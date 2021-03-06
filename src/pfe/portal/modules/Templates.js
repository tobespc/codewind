/*******************************************************************************
 * Copyright (c) 2019 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials
 * are made available under the terms of the Eclipse Public License v2.0
 * which accompanies this distribution, and is available at
 * http://www.eclipse.org/legal/epl-v20.html
 *
 * Contributors:
 *     IBM Corporation - initial API and implementation
 *******************************************************************************/

const fs = require('fs-extra');
const path = require('path');
const util = require('util');
const uuidv5 = require('uuid/v5');

const cwUtils = require('../modules/utils/sharedFunctions');
const Logger = require('./utils/Logger');
const TemplateError = require('./utils/errors/TemplateError');

const log = new Logger('Templates.js');

const DEFAULT_REPOSITORY_LIST = [
  {
    url: 'https://raw.githubusercontent.com/codewind-resources/codewind-templates/master/devfiles/index.json',
    description: 'Codewind project templates help you create containerized projects for various runtimes.',
    enabled: true,
    protected: true,
    projectStyles: ['Codewind'],
    name: 'Default templates',
  },
];

const kabaneroDescription = 'Kabanero, an open source project, brings together open source technologies into a microservices-based framework.' +
'Kabanero builds cloud native applications ready for deployment onto Kubernetes and Knative.'

const KABANERO_REPO = {
  url: 'https://github.com/kabanero-io/collections/releases/download/0.2.1/kabanero-index.json',
  name: 'Kabanero Collections',
  description: kabaneroDescription,
  enabled: false,
  protected: true,
};

// only add the kabanero repo locally
if (!global.codewind.RUNNING_IN_K8S) {
  DEFAULT_REPOSITORY_LIST.push(KABANERO_REPO);
}

module.exports = class Templates {

  constructor(workspace) {
    // If this exists it overrides the contents of DEFAULT_REPOSITORY_LIST
    this.projectTemplates = [];
    this.needsRefresh = true;
    this.repositoryFile = path.join(workspace, '.config/repository_list.json');
    this.repositoryList = DEFAULT_REPOSITORY_LIST;
    this.providers = {};
  }

  async initializeRepositoryList() {
    try {
      if (await cwUtils.fileExists(this.repositoryFile)) {
        this.repositoryList = await fs.readJson(this.repositoryFile); // eslint-disable-line require-atomic-updates
        await this.updateRepoListWithReposFromProviders();
        this.repositoryList = await fetchAllRepositoryDetails(this.repositoryList); // eslint-disable-line require-atomic-updates
        this.needsRefresh = true;
      } else {
        await this.updateRepoListWithReposFromProviders();
        this.repositoryList = await fetchAllRepositoryDetails(this.repositoryList); // eslint-disable-line require-atomic-updates
        await this.writeRepositoryList();
      }
    } catch (err) {
      log.error(`Error reading repository list from ${this.repositoryFile}: ${err}`)
    }
  }
  async getTemplates({ projectStyle, showEnabledOnly }) {
    let templates = (showEnabledOnly === 'true')
      ? await this.getEnabledTemplates()
      : await this.getAllTemplates();

    if (projectStyle) {
      templates = filterTemplatesByStyle(templates, projectStyle);
    }
    return templates;
  }

  async getEnabledTemplates() {
    await this.updateRepoListWithReposFromProviders();
    return this.getTemplatesFromRepos(this.getEnabledRepositories());
  }

  async getAllTemplates() {
    if (!this.needsRefresh) {
      return this.projectTemplates;
    }
    await this.updateRepoListWithReposFromProviders();
    return this.getTemplatesFromRepos(this.repositoryList);
  }

  async updateRepoListWithReposFromProviders() {
    const providers = Object.values(this.providers);
    const providedRepos = await getReposFromProviders(providers);

    const extraRepos = providedRepos.filter(repo =>
      !this.repositoryList.find(repo2 => repo2.url === repo.url)
    );

    if (extraRepos.length > 0) {
      const reposWithCodewindSettings = await Promise.all(
        extraRepos.map(async repo => {
          repo.enabled = true;
          repo.protected = true;
          const repoWithTemplateStyles = await fetchRepositoryDetails(repo);
          return repoWithTemplateStyles;
        })
      );
      this.repositoryList = this.repositoryList.concat(reposWithCodewindSettings);
      await this.writeRepositoryList();
    }
  }

  async getTemplatesFromRepos(repos) {
    let newProjectTemplates = [];
    await Promise.all(repos.map(async(repo) => {
      try {
        const extraTemplates = await getTemplatesFromRepo(repo);
        newProjectTemplates = newProjectTemplates.concat(extraTemplates);
      } catch (err) {
        log.warn(`Error accessing template repository '${repo.url}'. Error: ${util.inspect(err)}`);
        // Ignore to keep trying other repositories
      }
    }));
    newProjectTemplates.sort((a, b) => {
      return a.label.localeCompare(b.label);
    });
    this.projectTemplates = newProjectTemplates;
    return this.projectTemplates;
  }

  // Save the default list to disk so the user can potentially edit it (WHEN CODEWIND IS NOT RUNNING)
  async writeRepositoryList() {
    await fs.writeJson(this.repositoryFile, this.repositoryList, { spaces: '  ' });
    log.info(`Repository list updated.`);
  }

  getRepositories() {
    return this.repositoryList;
  }

  getEnabledRepositories() {
    return this.getRepositories().filter(repo => repo.enabled);
  }

  doesRepositoryExist(repoUrl) {
    try {
      this.getRepository(repoUrl);
      return true;
    } catch (error) {
      return false;
    }
  }

  getRepositoryIndex(url) {
    const repos = this.getRepositories();
    const index = repos.findIndex(repo => repo.url === url);
    return index;
  }

  /**
   * @param {String} url
   * @return {JSON} reference to the repo object in this.repositoryList
   */
  getRepository(url) {
    const index = this.getRepositoryIndex(url);
    if (index < 0) throw new Error(`no repository found with URL '${url}'`);
    const repo = this.getRepositories()[index];
    return repo;
  }

  enableRepository(url) {
    const repo = this.getRepository(url);
    repo.enabled = true;
  }

  disableRepository(url) {
    const repo = this.getRepository(url);
    repo.enabled = false;
  }

  async batchUpdate(requestedOperations) {
    const operationResults = requestedOperations.map(operation => this.performOperation(operation));
    await this.writeRepositoryList();
    return operationResults;
  }

  performOperation(operation) {
    const { op, url, value } = operation;
    let operationResult = {};
    if (op === 'enable') {
      operationResult = this.performEnableOrDisableOperation({ url, value });
    }
    operationResult.requestedOperation = operation;
    return operationResult;
  }

  /**
   * @param {JSON} { url (URL of template repo to enable or disable), value (true|false)}
   * @returns {JSON} { status, error (optional) }
   */
  performEnableOrDisableOperation({ url, value }) {
    if (!this.doesRepositoryExist(url)) {
      return {
        status: 404,
        error: 'Unknown repository URL',
      };
    }
    try {
      if (value === 'true') {
        this.enableRepository(url);
      } else {
        this.disableRepository(url);
      }
      return {
        status: 200
      };
    } catch (error) {
      return {
        status: 500,
        error: error.message,
      };
    }
  }

  /**
   * Add a repository to the list of template repositories.
   */
  async addRepository(repoUrl, repoDescription, repoName, isRepoProtected) {
    let url;
    try {
      url = new URL(repoUrl).href;
    } catch (error) {
      if (error.message.includes('Invalid URL')) {
        throw new TemplateError('INVALID_URL', repoUrl);
      }
      throw error;
    }

    if (this.getRepositories().find(repo => repo.url === repoUrl)) {
      throw new TemplateError('DUPLICATE_URL', repoUrl);
    }

    if (!(await doesUrlPointToIndexJson(url))) {
      throw new TemplateError('URL_DOES_NOT_POINT_TO_INDEX_JSON', url);
    }

    let newRepo = {
      id: uuidv5(url, uuidv5.URL),
      name: repoName,
      url,
      description: repoDescription,
      enabled: true,
    }
    newRepo = await fetchRepositoryDetails(newRepo);
    if (isRepoProtected !== undefined) {
      newRepo.protected = isRepoProtected;
    }

    try {
      await this.addRepositoryToProviders(newRepo);
    }
    catch (err) {
      throw new TemplateError('ADD_TO_PROVIDER_FAILURE', url, err.message);
    }
    this.repositoryList.push(newRepo);
    try {
      await this.writeRepositoryList();
      this.needsRefresh = true;
    }
    catch (err) {
      // rollback
      this.repositoryList = this.repositoryList.filter(repo => repo.url !== url);
      this.removeRepositoryFromProviders(newRepo).catch(error => log.warn(error.message));
      throw err;
    }
  }

  async deleteRepository(repoUrl) {
    let deleted;
    const repositoryList = this.repositoryList.filter((repo) => {
      if (repo.url === repoUrl) {
        deleted = repo;
        return false;
      }
      return true;
    });
    if (deleted) {
      await this.removeRepositoryFromProviders(deleted);
      this.repositoryList = repositoryList;
      try {
        await this.writeRepositoryList();
        this.needsRefresh = true;
      }
      catch (err) {
        // rollback
        this.repositoryList.push(deleted);
        this.addRepositoryToProviders(deleted).catch(error => log.warn(error.message));
        throw err;
      }
    }
  }

  addProvider(name, provider) {
    if (provider && typeof provider.getRepositories === 'function')
      this.providers[name] = provider;
  }

  async addRepositoryToProviders(repo) {

    const promises = [];

    for (const provider of Object.values(this.providers)) {
      
      if (typeof provider.canHandle === 'function') {

        // make a new copy to for each provider to be invoked with
        // in case any provider modifies it (which they shouldn't do)
        const copy = Object.assign({}, repo);

        if (provider.canHandle(copy) && typeof provider.addRepository === 'function')
          promises.push(provider.addRepository(copy));
      }
    }

    return Promise.all(promises);
  }

  async removeRepositoryFromProviders(repo) {

    const promises = [];

    for (const provider of Object.values(this.providers)) {

      if (typeof provider.canHandle === 'function') {

        // make a new copy to for each provider to be invoked with
        // in case any provider modifies it (which they shouldn't do)
        const copy = Object.assign({}, repo);
        
        if (provider.canHandle(copy) && typeof provider.removeRepository === 'function')
          promises.push(provider.removeRepository(copy));
      }
    }

    return Promise.all(promises);
  }

  async getAllTemplateStyles() {
    const templates = await this.getAllTemplates();
    return getTemplateStyles(templates);
  }
}

function fetchAllRepositoryDetails(repos) {
  return Promise.all(
    repos.map(repo => fetchRepositoryDetails(repo))
  );
}

async function fetchRepositoryDetails(repo) {
  let newRepo = {...repo}

  // Only set the name or description of the repo if not given by the user
  if (!(repo.name && repo.description)){
    await readRepoTemplatesJSON(newRepo);
  }

  if (repo.projectStyles) {
    return newRepo;
  }

  const templatesFromRepo = await getTemplatesFromRepo(repo);
  newRepo.projectStyles = getTemplateStyles(templatesFromRepo);
  return newRepo;
}

async function readRepoTemplatesJSON(repository) {
  if (!repository.url) {
    throw new Error(`repo '${repository}' must have a URL`);
  }

  const indexUrl = new URL(repository.url);

  // return if repository url points to a local file
  if ( indexUrl.protocol === 'file:' ) {
    return;
  }

  const indexPath = indexUrl.pathname;
  const templatesPath = path.dirname(indexPath) + '/' + 'templates.json';

  const templatesUrl = new URL(repository.url);
  templatesUrl.pathname = templatesPath;

  const options = {
    host: templatesUrl.host,
    path: templatesUrl.pathname,
    method: 'GET',
  }

  const res = await cwUtils.asyncHttpRequest(options, undefined, templatesUrl.protocol === 'https:');
  if (res.statusCode !== 200) {
    // Return as templates.json may not exist.
    return;
  }

  try {
    const templateDetails = JSON.parse(res.body);
    for (const prop of ['name', 'description']) {
      if (templateDetails.hasOwnProperty(prop)) {
        repository[prop] = templateDetails[prop];
      }
    }
  } catch (error) {
    // Log an error but don't throw an exception as this is optional.
    log.error(`URL '${templatesUrl}' should return JSON`);
  }
}

async function getTemplatesFromRepo(repository) {
  if (!repository.url) {
    throw new Error(`repo '${repository}' must have a URL`);
  }
  const repoUrl = new URL(repository.url);

  let templateSummariesText = '[]';
  // check if repository url points to a local file and read it accordingly
  if ( repoUrl.protocol === 'file:' ) {
    try {
      if ( await fs.exists(repoUrl.pathname) ) {
        let data = await fs.readFile(repoUrl.pathname, "utf-8");
        templateSummariesText = data.toString();
      }
    }
    catch (err) {
      throw new Error(`repo file '${repoUrl.pathname}' cannot be read`);
    }
  }
  else {
    const options = {
      host: repoUrl.host,
      path: repoUrl.pathname,
      method: 'GET',
    }
    const res = await cwUtils.asyncHttpRequest(options, undefined, repoUrl.protocol === 'https:');
    if (res.statusCode !== 200) {
      throw new Error(`Unexpected HTTP status for ${repository}: ${res.statusCode}`);
    }
    templateSummariesText = res.body;
  }

  let templateSummaries;
  try {
    templateSummaries = JSON.parse(templateSummariesText);
  } catch (error) {
    throw new Error(`URL '${repoUrl}' should return JSON`);
  }
  const templates = templateSummaries.map(summary => {
    const template = {
      label: summary.displayName,
      description: summary.description,
      language: summary.language,
      url: summary.location,
      projectType: summary.projectType,
    };

    if (summary.projectStyle) {
      template.projectStyle = summary.projectStyle;
    }
    if (repository.name) {
      template.source = repository.name;
    }
    if (repository.id) {
      template.sourceId = repository.id;
    }

    return template;
  });
  return templates;
}

function filterTemplatesByStyle(templates, projectStyle) {
  const relevantTemplates = templates.filter(template =>
    getTemplateStyle(template) === projectStyle
  );
  return relevantTemplates;
}

function getTemplateStyles(templates) {
  const styles = templates.map(template => getTemplateStyle(template));
  const uniqueStyles = [...new Set(styles)];
  return uniqueStyles;
}

function getTemplateStyle(template) {
  // if a project's style isn't specified, it defaults to 'Codewind'
  return template.projectStyle || 'Codewind';
}

async function getReposFromProviders(providers) {
  const repos = [];
  await Promise.all(providers.map(async(provider) => {
    try {
      const providedRepos = await provider.getRepositories();
      if (!Array.isArray(providedRepos)) {
        throw new Error (`provider ${util.inspect(provider)} should provide an array of repos, but instead provided '${providedRepos}'`);
      }
      providedRepos.forEach(repo => {
        if (isRepo(repo)) {
          repos.push(repo);
        }
      })
    }
    catch (err) {
      log.error(err.message);
    }
  }));
  return repos;
}

function isRepo(obj) {
  return obj.hasOwnProperty('url');
}

async function doesUrlPointToIndexJson(inputUrl) {
  const url = new URL(inputUrl); // Throws error if `inputUrl` is not a valid url

  let templateSummariesText = '[]';
  if ( url.protocol === 'file:' ) {
    try {
      if ( await fs.exists(url.pathname) ) {
        let data = await fs.readFile(url.pathname, "utf-8");
        templateSummariesText = data.toString();
      }
    }
    catch (err) {
      throw new Error(`repo file '${url.pathname}' cannot be read`);
    }
  }
  else {
    const options = {
      host: url.host,
      path: url.pathname,
      method: 'GET',
    }
    const res = await cwUtils.asyncHttpRequest(options, undefined, url.protocol === 'https:');
    if (res.statusCode < 200 || res.statusCode > 299) {
      return false;
    }
    templateSummariesText = res.body
  }

  try {
    const templateSummaries = JSON.parse(templateSummariesText);
    if (templateSummaries.some(summary => !isTemplateSummary(summary))) {
      return false;
    }
  } catch(error) {
    log.warn(error);
    return false
  }

  return true;
}

function isTemplateSummary(obj) {
  const expectedKeys = ['displayName', 'description', 'language', 'projectType', 'location', 'links'];
  return expectedKeys.every(key => obj.hasOwnProperty(key));
}

module.exports.fetchAllRepositoryDetails = fetchAllRepositoryDetails;
module.exports.getTemplatesFromRepo = getTemplatesFromRepo;
module.exports.filterTemplatesByStyle = filterTemplatesByStyle;
module.exports.getReposFromProviders = getReposFromProviders;
module.exports.getTemplateStyles = getTemplateStyles;
