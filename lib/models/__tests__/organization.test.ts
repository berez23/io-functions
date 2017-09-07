// tslint:disable:no-any

import * as DocumentDb from "documentdb";

import * as DocumentDbUtils from "../../utils/documentdb";
import {ModelId} from "../../utils/documentdb_model_versioned";
import { toNonNegativeNumber } from "../../utils/numbers";

import {IOrganization, IRetrievedOrganization, OrganizationModel} from "../organization";

const aDatabaseUri = DocumentDbUtils.getDatabaseUri("mockdb");
const organizationsCollectionUrl = DocumentDbUtils.getCollectionUri(aDatabaseUri, "organizations");

const organizationId = "xyz" as ModelId;

const aRetrievedOrganization: IRetrievedOrganization = {
    _self: "xyz",
    _ts: "xyz",
    organizationId: organizationId,
    name: "MyOrganization",
    id: "xyz",
    kind: "IRetrievedOrganization",
    version: toNonNegativeNumber(0).get,
};

describe("findOneOrganizationById", () => {

    it("should resolve a promise to an existing organization", async () => {
        const iteratorMock = {
            executeNext: jest.fn((cb) => cb(undefined, ["result"], undefined)),
        };

        const clientMock = {
            queryDocuments: jest.fn((__, ___) => iteratorMock),
        };

        const model = new OrganizationModel((clientMock as any) as DocumentDb.DocumentClient, organizationsCollectionUrl);

        const result = await model.findByOrganizationId("id");

        expect(result.isRight).toBeTruthy();
        if (result.isRight) {
            expect(result.right.isDefined).toBeTruthy();
            expect(result.right.get).toEqual("result");
        }
    });

    it("should resolve a promise to undefined if no organization is found", async () => {
        const iteratorMock = {
            executeNext: jest.fn((cb) => cb(undefined, [], undefined)),
        };

        const clientMock = {
            queryDocuments: jest.fn((__, ___) => iteratorMock),
        };

        const model = new OrganizationModel((clientMock as any) as DocumentDb.DocumentClient, organizationsCollectionUrl);

        const result = await model.findByOrganizationId("id");

        expect(result.isRight).toBeTruthy();
        if (result.isRight) {
            expect(result.right.isEmpty).toBeTruthy();
        }
    });

});

describe("createOrganization", () => {

    it("should create a new organization", async () => {
        const clientMock: any = {
            createDocument: jest.fn((_, newDocument, __, cb) => {
                cb(undefined, {
                    ...newDocument,
                });
            }),
        };

        const model = new OrganizationModel(clientMock, organizationsCollectionUrl);

        const newOrganization: IOrganization = {
            organizationId: organizationId,
            name: "MyOrganization"
        };

        const result = await model.create(newOrganization, newOrganization.organizationId);

        expect(clientMock.createDocument).toHaveBeenCalledTimes(1);
        expect(clientMock.createDocument.mock.calls[0][1].kind).toBeUndefined();
        expect(clientMock.createDocument.mock.calls[0][2]).toHaveProperty("partitionKey", organizationId);
        expect(result.isRight).toBeTruthy();
        if (result.isRight) {
            expect(result.right.organizationId).toEqual(newOrganization.organizationId);
            expect(result.right.id).toEqual(`${organizationId}-${"0".repeat(16)}`);
            expect(result.right.version).toEqual(0);
        }
    });

    it("should reject the promise in case of error", async () => {
        const clientMock: any = {
            createDocument: jest.fn((_, __, ___, cb) => {
                cb("error");
            }),
        };

        const model = new OrganizationModel(clientMock, organizationsCollectionUrl);

        const newOrganization: IOrganization = {
            organizationId: organizationId,
            name: "MyOrganization"
        };

        const result = await model.create(newOrganization, newOrganization.organizationId);

        expect(clientMock.createDocument).toHaveBeenCalledTimes(1);

        expect(result.isLeft).toBeTruthy();
        if (result.isLeft) {
            expect(result.left).toEqual("error");
        }
    });

});

describe("update", () => {

    it("should update an existing organization", async () => {
        const clientMock: any = {
            createDocument: jest.fn((_, newDocument, __, cb) => {
                cb(undefined, {
                    ...newDocument,
                });
            }),
            readDocument: jest.fn((_, __, cb) => cb(undefined, aRetrievedOrganization)),
        };

        const model = new OrganizationModel(clientMock, organizationsCollectionUrl);

        const result = await model.update(
            aRetrievedOrganization.organizationId,
            aRetrievedOrganization.organizationId,
            (p) => {
                return {
                    ...p
                };
            },
        );

        expect(clientMock.createDocument).toHaveBeenCalledTimes(1);
        expect(clientMock.createDocument.mock.calls[0][1].kind).toBeUndefined();
        expect(clientMock.createDocument.mock.calls[0][2]).toHaveProperty("partitionKey", organizationId);
        expect(result.isRight).toBeTruthy();
        if (result.isRight) {
            expect(result.right.isDefined).toBeTruthy();
            const updatedOrganization = result.right.get;
            expect(updatedOrganization.organizationId).toEqual(aRetrievedOrganization.organizationId);
            expect(updatedOrganization.id).toEqual(`${organizationId}-${"0".repeat(15)}1`);
            expect(updatedOrganization.version).toEqual(1);
            expect(updatedOrganization.name).toEqual("MyOrganization");
        }
    });

    it("should reject the promise in case of error (read)", async () => {
        const clientMock: any = {
            createDocument: jest.fn(),
            readDocument: jest.fn((_, __, cb) => cb("error")),
        };

        const model = new OrganizationModel(clientMock, organizationsCollectionUrl);

        const result = await model.update(organizationId, organizationId, (o) => o);

        expect(clientMock.readDocument).toHaveBeenCalledTimes(1);
        expect(clientMock.createDocument).not.toHaveBeenCalled();

        expect(result.isLeft).toBeTruthy();
        if (result.isLeft) {
            expect(result.left).toEqual("error");
        }
    });

    it("should reject the promise in case of error (create)", async () => {
        const clientMock: any = {
            createDocument: jest.fn((_, __, ___, cb) => cb("error")),
            readDocument: jest.fn((_, __, cb) => cb(undefined, aRetrievedOrganization)),
        };

        const model = new OrganizationModel(clientMock, organizationsCollectionUrl);

        const result = await model.update(organizationId, organizationId, (o) => o);

        expect(clientMock.readDocument).toHaveBeenCalledTimes(1);
        expect(clientMock.createDocument).toHaveBeenCalledTimes(1);

        expect(result.isLeft).toBeTruthy();
        if (result.isLeft) {
            expect(result.left).toEqual("error");
        }
    });

});
