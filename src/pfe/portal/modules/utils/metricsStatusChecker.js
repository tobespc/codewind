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

const { asyncHttpRequest } = require('./sharedFunctions');
const MetricsStatusError = require('../utils/errors/MetricsStatusError')
const Logger = require('../utils/Logger');
const log = new Logger('metricsStatusChecker.js');

const readFile = util.promisify(fs.readFile);

const filesToCheck = {
  java : 'pom.xml',
  nodejs : 'package.json',
  javascript : 'package.json',
  swift : 'Package.swift',
}

/**
 * @param {*} projectPath
 * @param {*} projectLanguage
 * @returns {Promise<Boolean>} The projects supports metrics,
 * based on the values of its build-file.
 */
async function isMetricsAvailable(projectPath, projectLanguage) {
  log.debug(`checking if metricsAvailable for ${projectLanguage} project`);
  const fileToCheck = filesToCheck[projectLanguage];
  if (!fileToCheck) {
    return false; // not a language with supported metrics
  }
  const pathOfFileToCheck = await path.join(projectPath, fileToCheck);
  if (await fs.pathExists(pathOfFileToCheck)) {
    return doesMetricsPackageExist(pathOfFileToCheck, projectLanguage)
  }
  throw new MetricsStatusError("BUILD_FILE_MISSING", `Cannot find project build-file (${fileToCheck})`);
}

async function doesMetricsPackageExist(pathOfFileToCheck, projectLanguage) {
  let metricsPackageExists = false; // default to appmetrics unavailable
  try {
    const fileToCheck = await readFile(pathOfFileToCheck, 'utf8');
    if (projectLanguage === 'nodejs' || projectLanguage === 'javascript') {
      const packageJSON = JSON.parse(fileToCheck);
      // There might not be any dependencies
      if (packageJSON.dependencies) {
        if (packageJSON.dependencies['appmetrics-dash']) {
          metricsPackageExists = true;
        }
      }
    } else if (projectLanguage === 'java') {
      metricsPackageExists = fileToCheck.includes('javametrics');
    } else if (projectLanguage === 'swift') {
      metricsPackageExists = fileToCheck.includes('SwiftMetrics.git');
    }
  } catch(err) {
    // If we failed to read the file / parse json return false
  }
  log.debug(`doesMetricsPackageExist returning ${metricsPackageExists}`);
  return metricsPackageExists;
}

async function getActiveMetricsURLs(host, port) {
  const potentialEndpointsWithMetrics = [
    '/metrics',
    '/appmetrics-dash',
    '/javametrics-dash',
    '/swiftmetrics-dash',
    '/actuator/prometheus',
  ];

  const endpoints = await Promise.all(potentialEndpointsWithMetrics.map(async path => {
    const isActive = await isMetricsEndpoint(host, port, path);
    return { path, isActive };
  }));

  return endpoints.reduce((acc, { path, isActive }) => {
    acc[path] = isActive
    return acc;
  }, {});
}

async function isMetricsEndpoint(host, port, path) {
  const options = {
    host,
    port,
    path,
    method: 'GET',
  }

  let res;
  try {
    res = await asyncHttpRequest(options);
  } catch(err) {
    // If the request errors then the metrics endpoint isn't available
    return false;
  }
  const { statusCode, body } = res;
  const validRes = (statusCode === 200);
  const isAppmetrics = body.includes('src="graphmetrics/js');
  const isPrometheus = isPrometheusFormat(body);
  return (validRes && (isAppmetrics || isPrometheus));
}

function isPrometheusFormat(string) {
  // Split string by new lines
  const lines = string.split('\n');
  // If the final line is empty, remove it
  if (lines[lines.length-1] === "") lines.pop();
  // Ensure number of spaces on each line is 1 (ignoring comment lines)
  const { length: numberOfValidPrometheusLines } = lines.filter(line => {
    // Ignore lines beginning with # as they are comments
    const lineIsComment = line.startsWith('#');
    // Valid prometheus metrics are in the format "name metric"
    // e.g. api_http_requests_total{method="POST", handler="/messages"} value
    // Remove everything between "{}" and the brackets themselves
    const validatedLine = line.replace(/{.*}/, '');
    // Ensure there is only one space between the metric name and value
    const validMetric = (validatedLine.split(" ").length-1) === 1;
    return lineIsComment || validMetric;
  });
  return lines.length === numberOfValidPrometheusLines;
}

module.exports = {
  isMetricsAvailable,
  getActiveMetricsURLs,
}
