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
import mocha from "mocha";
import { expect } from "chai";
import * as _ from "lodash";

import * as projectsController from "../../../../../src/controllers/projectsController";
import { getProjectLogs, checkNewLogFile } from "../../../lib/project";
import { SocketIO } from "../../../lib/socket-io";
import * as utils from "../../../lib/utils";

import * as log_configs from "../../../configs/log.config";
import * as eventConfigs from "../../../configs/event.config";
import * as timeoutConfigs from "../../../configs/timeout.config";
import { fail } from "assert";

export function logsTest(socket: SocketIO, projData: projectsController.ICreateProjectParams, projectTemplate: string, projectLang: string, runOnly?: boolean): void {
    (runOnly ? describe.only : describe)("getProjectLogs function", () => {
        it("get project logs with missing id", async () => {
            const info: any = await getProjectLogs(undefined);
            expect(info);
            expect(info.statusCode);
            expect(info.statusCode).to.equal(400);
            expect(info.error);
            expect(info.error).to.haveOwnProperty("msg");
            expect(info.error.msg).to.equal("Bad request");
        });

        it("get project logs with invalid id", async () => {
            const badProjectId = "1234someid";
            const info: any = await getProjectLogs(badProjectId);
            expect(info);
            expect(info.statusCode);
            expect(info.statusCode).to.equal(404);
            expect(info.error);
            expect(info.error).to.haveOwnProperty("msg");
            expect(info.error.msg).to.equal(`Project does not exist ${badProjectId}`);
        });

        it("get project logs with valid id", async () => {
            const info: any = await getProjectLogs(projData.projectID);
            expect(info);
            expect(info.statusCode);
            expect(info.statusCode).to.equal(200);
            expect(info.logs);

            for (const logType of Object.keys(log_configs.logTypes)) {
                expect(info.logs).to.haveOwnProperty(logType);
                expect(info.logs[logType]).to.be.an.instanceof(Array);
                expect(info.logs[logType].length).to.equal(log_configs.logFileMappings[projectTemplate][projectLang][logType].length);
                expect(_.isMatch(info.logs[logType], log_configs.logFileMappings[projectTemplate][projectLang][logType]));
            }
        }).timeout(timeoutConfigs.defaultTimeout);
    });

    (runOnly ? describe.only : describe)("checkNewLogFile function", () => {
        const combinations: any = {
            "combo1": {
                "projectID": undefined,
                "type": "build",
            },
            "combo2": {
                "projectID": projData.projectID,
                "type": undefined,
            },
            "combo3": {
                "projectID": projData.projectID,
                "type": "sometype",
            }
        };

        for (const combo of Object.keys(combinations)) {
            const projectID = combinations[combo]["projectID"];
            const type = combinations[combo]["type"];
            it(`${combo} => projectID: ${projectID}, type: ${type}`, async() => {
                const info: any = await checkNewLogFile(projectID, type);
                expect(info);
                expect(info.statusCode);
                expect(info.statusCode).to.equal(400);
                expect(info.error);
                expect(info.error).to.haveOwnProperty("msg");
                expect(info.error.msg).to.equal("Bad request");
            });
        }

        for (const logType of Object.keys(log_configs.logTypes)) {
            it(`checking for new ${logType} log file`, async () => {
                const info: any = await checkNewLogFile(projData.projectID, logType);
                expect(info);
                expect(info.statusCode);
                expect(info.statusCode).to.equal(200);
                expect(info.logs);
                expect(info.logs).to.haveOwnProperty("projectID");
                expect(info.logs.projectID).to.equal(projData.projectID);
                expect(info.logs).to.haveOwnProperty("type");
                expect(info.logs.type).to.equal(logType);
                expect(info.logs).to.haveOwnProperty(logType);
                expect(info.logs[logType]);
                expect(info.logs[logType]).to.be.an.instanceof(Array);
                expect(info.logs[logType].length).to.equal(log_configs.logFileMappings[projectTemplate][projectLang][logType].length);
                expect(_.isMatch(info.logs[logType], log_configs.logFileMappings[projectTemplate][projectLang][logType]));

                const targetEvent = eventConfigs.events.logsListChanged;
                const returnData = info.logs;
                const event = await utils.waitForEvent(socket, targetEvent, returnData);
                if (event) {
                    expect(event);
                    expect(event.eventName);
                    expect(event.eventName).to.equal(targetEvent);
                    expect(event.eventData);
                    expect(event.eventData).to.equal(returnData);
                } else {
                    fail(`failed to find ${targetEvent} for ${logType} log`);
                }
            }).timeout(timeoutConfigs.defaultTimeout);
        }
    });
}
