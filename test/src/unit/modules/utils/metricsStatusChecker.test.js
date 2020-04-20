/*******************************************************************************
 * Copyright (c) 2020 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials
 * are made available under the terms of the Eclipse Public License v2.0
 * which accompanies this distribution, and is available at
 * http://www.eclipse.org/legal/epl-v20.html
 *
 * Contributors:
 *     IBM Corporation - initial API and implementation
*******************************************************************************/
const rewire = require('rewire');
const sinon = require('sinon');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

const metricsStatusChecker = rewire('../../../../../src/pfe/portal/modules/utils/metricsStatusChecker');
const { suppressLogOutput } = require('../../../../modules/log.service');

chai.use(chaiAsPromised);
chai.should();

describe('metricsStatusChecker.js', function() {
    suppressLogOutput(metricsStatusChecker);
    describe('isMetricsAvailable(projectPath, projectLanguage)', function() {
        const { isMetricsAvailable } = metricsStatusChecker;
        ['java', 'nodejs', 'javascript', 'swift'].forEach((language) => {
            it(`returns true as a valid projectPath and projectLanguage === ${language} and doesMetricsPackageExist returns true`, async function() {
                metricsStatusChecker.__set__('doesMetricsPackageExist', sinon.stub().returns(true));
                metricsStatusChecker.__set__('fs', { pathExists: sinon.stub().returns(true) });
                const metricsAvailable = await isMetricsAvailable('', language);
                metricsAvailable.should.be.true;
            });
        });
        it('returns false as the projectLanguage is invalid', async function() {
            const metricsAvailable = await isMetricsAvailable('', 'invalid');
            metricsAvailable.should.be.false;
        });
        it('throws an error as the file does not exist', function() {
            metricsStatusChecker.__set__('fs', { pathExists: sinon.stub().returns(false) });
            return isMetricsAvailable('', 'java').should.be.rejectedWith('Cannot find project build-file (pom.xml)');
        });
    });
    describe('doesMetricsPackageExist(pathOfFileToCheck, projectLanguage)', function() {
        const doesMetricsPackageExist = metricsStatusChecker.__get__('doesMetricsPackageExist');
        describe('projectLanguage === nodejs || javascript', function() {
            it('returns true as the package.json contains "appmetrics-dash" as a dependency and language is nodejs', async function() {
                const packageJSON = '{"dependencies":{"appmetrics-dash": "1.0.0"}}';
                metricsStatusChecker.__set__('fs', { readFile: sinon.stub().returns(packageJSON) });
                const packageExists = await doesMetricsPackageExist('', 'nodejs');
                packageExists.should.be.true;
            });
            it('returns true as the package.json contains "appmetrics-dash" as a dependency and language is javascript', async function() {
                const packageJSON = '{"dependencies":{"appmetrics-dash": "1.0.0"}}';
                metricsStatusChecker.__set__('fs', { readFile: sinon.stub().returns(packageJSON) });
                const packageExists = await doesMetricsPackageExist('', 'javascript');
                packageExists.should.be.true;
            });
            it('returns false as the package.json does not contain "appmetrics-dash" as a dependency', async function() {
                const packageJSON = '{"dependencies":{"appmetrics": "1.0.0"}}';
                metricsStatusChecker.__set__('fs', { readFile: sinon.stub().returns(packageJSON) });
                const packageExists = await doesMetricsPackageExist('', 'javascript');
                packageExists.should.be.false;
            });
            it('returns false as the package.json does not contain a dependency object', async function() {
                const packageJSON = '{"name":"test"}';
                metricsStatusChecker.__set__('fs', { readFile: sinon.stub().returns(packageJSON) });
                const packageExists = await doesMetricsPackageExist('', 'javascript');
                packageExists.should.be.false;
            });
            it('returns false as the package.json is not valid JSON', async function() {
                const packageJSON = 'invalid json';
                metricsStatusChecker.__set__('fs', { readFile: sinon.stub().returns(packageJSON) });
                const packageExists = await doesMetricsPackageExist('', 'javascript');
                packageExists.should.be.false;
            });
        });
        describe('projectLanguage === java', function() {
            it('returns true as the file contains "javametrics"', async function() {
                const fileToCheck = 'javametrics';
                metricsStatusChecker.__set__('fs', { readFile: sinon.stub().returns(fileToCheck) });
                const packageExists = await doesMetricsPackageExist('', 'java');
                packageExists.should.be.true;
            });
            it('returns false as the file does not contain "javametrics"', async function() {
                const fileToCheck = 'string';
                metricsStatusChecker.__set__('fs', { readFile: sinon.stub().returns(fileToCheck) });
                const packageExists = await doesMetricsPackageExist('', 'java');
                packageExists.should.be.false;
            });
        });
        describe('projectLanguage === swift', function() {
            it('returns true as the file contains "SwiftMetrics.git"', async function() {
                const fileToCheck = 'SwiftMetrics.git';
                metricsStatusChecker.__set__('fs', { readFile: sinon.stub().returns(fileToCheck) });
                const packageExists = await doesMetricsPackageExist('', 'swift');
                packageExists.should.be.true;
            });
            it('returns false as the file does not contain "SwiftMetrics.git"', async function() {
                const fileToCheck = 'string';
                metricsStatusChecker.__set__('fs', { readFile: sinon.stub().returns(fileToCheck) });
                const packageExists = await doesMetricsPackageExist('', 'swift');
                packageExists.should.be.false;
            });
        });
        it('returns false as the file could not be read', async function() {
            metricsStatusChecker.__set__('fs', { readFile: sinon.stub.rejects });
            const metricsPackageExists = await doesMetricsPackageExist('', '');
            metricsPackageExists.should.be.false;
        });
        it('returns false as the projectLanguage is invalid', async function() {
            metricsStatusChecker.__set__('fs', { readFile: sinon.stub().returns('') });
            const packageExists = await doesMetricsPackageExist('', 'invalidLanguage');
            packageExists.should.be.false;
        });
    });
    describe('getActiveMetricsURLs(host, port)', function() {
        const { getActiveMetricsURLs } = metricsStatusChecker;
        it('returns all endpoints as true as isMetricsEndpoint is stubbed to always return true', async function() {
            const spiedIsMetricsEndpoint = sinon.stub().returns(true);
            metricsStatusChecker.__set__('isMetricsEndpoint', spiedIsMetricsEndpoint);
            const activeDashboardObject = await getActiveMetricsURLs('host', 'port');
            activeDashboardObject.should.deep.equal({
                '/metrics': true,
                '/appmetrics-dash': true,
                '/javametrics-dash': true,
                '/swiftmetrics-dash': true,
                '/actuator/prometheus': true,
            });
            spiedIsMetricsEndpoint.callCount.should.equal(5);
        });
        it('throws an error as isMetricsEndpoint throws an error', function() {
            metricsStatusChecker.__set__('isMetricsEndpoint', sinon.stub.rejects);
            return getActiveMetricsURLs('host', 'port').should.eventually.be.rejected;
        });
    });
    describe('isMetricsEndpoint(host, port, path)', function() {
        const isMetricsEndpoint = metricsStatusChecker.__get__('isMetricsEndpoint');
        it('returns true as the page source contains graphmetrics as a JavaScript source', async function() {
            const mockedRes = {
                statusCode: 200,
                body: '<script type="text/javascript" src="graphmetrics/js/header.js"></script>',
            };
            metricsStatusChecker.__set__('asyncHttpRequest', () => mockedRes);

            const isEndpoint = await isMetricsEndpoint('host', 'port', 'path');
            isEndpoint.should.be.true;
        });
        it('returns true as the page source contains prometheus data', async function() {
            const mockedRes = {
                statusCode: 200,
                body: 'api_http_requests_total{method="POST", handler="/messages"} 0.5\n',
            };
            metricsStatusChecker.__set__('asyncHttpRequest', () => mockedRes);

            const isEndpoint = await isMetricsEndpoint('host', 'port', 'path');
            isEndpoint.should.be.true;
        });
        it('returns false statusCode is not 200', async function() {
            const mockedRes = {
                statusCode: 500,
                body: 'some random data',
            };
            metricsStatusChecker.__set__('asyncHttpRequest', () => mockedRes);

            const isEndpoint = await isMetricsEndpoint('host', 'port', 'path');
            isEndpoint.should.be.false;
        });
        it('returns false as the body is null', async function() {
            const mockedRes = {
                statusCode: 200,
                body: null,
            };
            metricsStatusChecker.__set__('asyncHttpRequest', () => mockedRes);

            const isEndpoint = await isMetricsEndpoint('host', 'port', 'path');
            isEndpoint.should.be.false;
        });
        it('returns false as the page source is not Appmetrics or valid Prometheus data', async function() {
            const mockedRes = {
                statusCode: 200,
                body: 'some random data',
            };
            metricsStatusChecker.__set__('asyncHttpRequest', () => mockedRes);

            const isEndpoint = await isMetricsEndpoint('host', 'port', 'path');
            isEndpoint.should.be.false;
        });
        it('returns false as asyncHttpRequest threw an error', async function() {
            const throwErr = () => { throw new Error('HTTP_ERROR'); };
            metricsStatusChecker.__set__('asyncHttpRequest', throwErr);

            const isEndpoint = await isMetricsEndpoint('host', 'port', 'path');
            isEndpoint.should.be.false;
        });
    });
    describe('isPrometheusFormat(string)', function() {
        const isPrometheusFormat = metricsStatusChecker.__get__('isPrometheusFormat');
        it('returns true as the given string is valid', function() {
            const testString = 'api_http_requests_total 0.5\n'
                            + '# A comment\n';
            const isValid = isPrometheusFormat(testString);
            isValid.should.be.true;
        });
        it('returns true and ignores the space in the {}', function() {
            const testString = 'api_http_requests_total{method="POST", handler="/messages"} 0.5\n'
                            + '# A comment\n';
            const isValid = isPrometheusFormat(testString);
            isValid.should.be.true;
        });
        it('returns true when given a comment', function() {
            const testString = '# comment \n';
            const isValid = isPrometheusFormat(testString);
            isValid.should.be.true;
        });
        it('returns false prometheus property does not have a value', function() {
            const testString = 'api_http_requests_total{method="POST", handler="/messages"}\n';
            const isValid = isPrometheusFormat(testString);
            isValid.should.be.false;
        });
        it('returns false string is invalid', function() {
            const testString = 'an invalid string\n';
            const isValid = isPrometheusFormat(testString);
            isValid.should.be.false;
        });
    });
});
