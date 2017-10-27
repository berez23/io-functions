// tslint:disable:no-any

import { none, some } from "ts-option";

import { left, right } from "../../either";

import { IService } from "../../../models/service";

import { toNonEmptyString } from "../../../utils/strings";

import { Set } from "json-set-map";
import { AzureUserAttributesMiddleware } from "../azure_user_attributes";

interface IHeaders {
  readonly [key: string]: string | undefined;
}

function lookup(h: IHeaders): (k: string) => string | undefined {
  return (k: string) => h[k];
}

const aService: IService = {
  authorizedRecipients: new Set([]),
  departmentName: toNonEmptyString("MyDept").get,
  organizationName: toNonEmptyString("MyService").get,
  serviceId: toNonEmptyString("serviceId").get,
  serviceName: toNonEmptyString("MyService").get
};

describe("AzureUserAttributesMiddleware", () => {
  it("should fail on empty user email", async () => {
    const serviceModel = jest.fn();

    const headers: IHeaders = {
      "x-user-email": ""
    };

    const mockRequest = {
      header: jest.fn(lookup(headers))
    };

    const middleware = AzureUserAttributesMiddleware(serviceModel as any);

    const result = await middleware(mockRequest as any);
    expect(mockRequest.header).toHaveBeenCalledTimes(1);
    expect(mockRequest.header).toHaveBeenCalledWith("x-user-email");
    expect(result.isLeft).toBeTruthy();
    if (result.isLeft) {
      expect(result.left.kind).toEqual("IResponseErrorInternal");
    }
  });

  it("should fail on invalid user email", async () => {
    const serviceModel = jest.fn();

    const headers: IHeaders = {
      "x-user-email": "xyz"
    };

    const mockRequest = {
      header: jest.fn(lookup(headers))
    };

    const middleware = AzureUserAttributesMiddleware(serviceModel as any);

    const result = await middleware(mockRequest as any);
    expect(mockRequest.header).toHaveBeenCalledTimes(1);
    expect(mockRequest.header).toHaveBeenCalledWith("x-user-email");
    expect(result.isLeft).toBeTruthy();
    if (result.isLeft) {
      expect(result.left.kind).toEqual("IResponseErrorInternal");
    }
  });

  it("should fail on invalid key", async () => {
    const serviceModel = {
      findOneByServiceId: jest.fn()
    };
    const headers: IHeaders = {
      "x-subscription-id": undefined,
      "x-user-email": "test@example.com"
    };

    const mockRequest = {
      header: jest.fn(lookup(headers))
    };

    const middleware = AzureUserAttributesMiddleware(serviceModel as any);

    const result = await middleware(mockRequest as any);
    expect(mockRequest.header.mock.calls[0][0]).toBe("x-user-email");
    expect(mockRequest.header.mock.calls[1][0]).toBe("x-subscription-id");
    expect(result.isLeft).toBeTruthy();
    if (result.isLeft) {
      expect(result.left.kind).toEqual("IResponseErrorInternal");
    }
  });

  it("should fail if the user service does not exist", async () => {
    const serviceModel = {
      findOneByServiceId: jest.fn(() => Promise.resolve(right(none)))
    };

    const headers: IHeaders = {
      "x-subscription-id": "MySubscriptionId",
      "x-user-email": "test@example.com"
    };

    const mockRequest = {
      header: jest.fn(lookup(headers))
    };

    const middleware = AzureUserAttributesMiddleware(serviceModel as any);

    const result = await middleware(mockRequest as any);

    expect(mockRequest.header.mock.calls[0][0]).toBe("x-user-email");
    expect(mockRequest.header.mock.calls[1][0]).toBe("x-subscription-id");
    expect(serviceModel.findOneByServiceId).toHaveBeenCalledWith(
      headers["x-subscription-id"]
    );
    expect(result.isLeft).toBeTruthy();
    if (result.isLeft) {
      expect(result.left.kind).toEqual("IResponseErrorForbiddenNotAuthorized");
    }
  });

  it("should fetch and return the user service from the custom attributes", async () => {
    const serviceModel = {
      findOneByServiceId: jest.fn(() => Promise.resolve(right(some(aService))))
    };

    const headers: IHeaders = {
      "x-subscription-id": "MySubscriptionId",
      "x-user-email": "test@example.com"
    };

    const mockRequest = {
      header: jest.fn(lookup(headers))
    };

    const middleware = AzureUserAttributesMiddleware(serviceModel as any);

    const result = await middleware(mockRequest as any);
    expect(mockRequest.header.mock.calls[0][0]).toBe("x-user-email");
    expect(mockRequest.header.mock.calls[1][0]).toBe("x-subscription-id");
    expect(serviceModel.findOneByServiceId).toHaveBeenCalledWith(
      headers["x-subscription-id"]
    );
    expect(result.isRight);
    if (result.isRight) {
      const attributes = result.right;
      expect(attributes.service).toEqual({
        ...aService,
        authorizedRecipients: new Set()
      });
    }
  });

  it("should fail in case of error when fetching the user service", async () => {
    const serviceModel = {
      findOneByServiceId: jest.fn(() => Promise.resolve(left("error")))
    };

    const headers: IHeaders = {
      "x-subscription-id": "MySubscriptionId",
      "x-user-email": "test@example.com"
    };

    const mockRequest = {
      header: jest.fn(lookup(headers))
    };

    const middleware = AzureUserAttributesMiddleware(serviceModel as any);

    const result = await middleware(mockRequest as any);
    expect(mockRequest.header.mock.calls[0][0]).toBe("x-user-email");
    expect(mockRequest.header.mock.calls[1][0]).toBe("x-subscription-id");
    expect(serviceModel.findOneByServiceId).toHaveBeenCalledWith(
      headers["x-subscription-id"]
    );
    expect(result.isLeft);
    if (result.isLeft) {
      expect(result.left.kind).toEqual("IResponseErrorQuery");
    }
  });
});
