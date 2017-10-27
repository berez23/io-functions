/*
 * Implements the API handlers for the Services resource.
 */
import * as express from "express";

import {
  IRetrievedService,
  IService,
  ServiceModel,
  toAuthorizedRecipients
} from "../../models/service";

import {
  AzureApiAuthMiddleware,
  IAzureApiAuthorization,
  UserGroup
} from "../../utils/middlewares/azure_api_auth";

import { RequiredParamMiddleware } from "../../utils/middlewares/required_param";

import {
  IRequestMiddleware,
  withRequestMiddlewares,
  wrapRequestHandler
} from "../../utils/request_middleware";

import {
  IResponseErrorInternal,
  IResponseErrorNotFound,
  IResponseErrorQuery,
  IResponseErrorValidation,
  IResponseSuccessJson,
  ResponseErrorInternal,
  ResponseErrorNotFound,
  ResponseErrorQuery,
  ResponseErrorValidation,
  ResponseSuccessJson
} from "../../utils/response";

import { left, right } from "../../utils/either";
import { isNonEmptyString, NonEmptyString } from "../../utils/strings";

type ICreateServiceHandler = (
  auth: IAzureApiAuthorization,
  service: IService
) => Promise<
  | IResponseSuccessJson<IRetrievedService>
  | IResponseErrorValidation
  | IResponseErrorQuery
  | IResponseErrorInternal
>;

type IUpdateServiceHandler = (
  auth: IAzureApiAuthorization,
  serviceId: NonEmptyString,
  service: IService
) => Promise<
  | IResponseSuccessJson<IRetrievedService>
  | IResponseErrorValidation
  | IResponseErrorQuery
  | IResponseErrorInternal
  | IResponseErrorNotFound
>;

/**
 * A middleware that extracts a Service payload from a request.
 *
 * TODO: validate the payload against a schema.
 */
export const ServicePayloadMiddleware: IRequestMiddleware<
  IResponseErrorValidation,
  IService
> = request => {
  const body = request.body;
  const servicePayload: IService = {
    authorizedRecipients: toAuthorizedRecipients(body.authorized_recipients),
    departmentName: body.department_name,
    organizationName: body.organization_name,
    serviceId: body.service_id,
    serviceName: body.service_name
  };

  const nonEmptyFields: { readonly [k: string]: string } = {
    department_name: servicePayload.departmentName,
    organization_name: servicePayload.organizationName,
    service_id: servicePayload.serviceId,
    service_name: servicePayload.serviceName
  };

  const errors = Object.keys(nonEmptyFields)
    .map(k => {
      if (!nonEmptyFields[k] || !isNonEmptyString(nonEmptyFields[k])) {
        return k + " must be a non empty string";
      }
      return undefined;
    })
    .filter(v => v !== undefined);

  if (errors.length > 0) {
    return Promise.resolve(
      left(
        ResponseErrorValidation(
          "Invalid field found in Service payload",
          errors.join(" - ")
        )
      )
    );
  }
  return Promise.resolve(right(servicePayload));
};

export function UpdateServiceHandler(
  serviceModel: ServiceModel
): IUpdateServiceHandler {
  return async (_, serviceId, serviceModelPayload) => {
    if (serviceModelPayload.serviceId !== serviceId) {
      return ResponseErrorValidation(
        "Error validating payload",
        "Value of `service_id` in the request body must match " +
          "the value of `service_id` path parameter"
      );
    }
    const errorOrMaybeService = await serviceModel.findOneByServiceId(
      serviceId
    );
    if (errorOrMaybeService.isLeft) {
      return ResponseErrorQuery(
        "Error trying to retrieve existing service",
        errorOrMaybeService.left
      );
    }

    const maybeService = errorOrMaybeService.right;
    if (maybeService.isEmpty) {
      return ResponseErrorNotFound(
        "Error",
        "Could not find a service with the provided serviceId"
      );
    }

    const existingService = maybeService.get;

    const errorOrMaybeUpdatedService = await serviceModel.update(
      existingService.id,
      existingService.serviceId,
      currentService => {
        const updatedService = {
          ...currentService,
          ...serviceModelPayload,
          serviceId
        };
        return updatedService;
      }
    );
    if (errorOrMaybeUpdatedService.isLeft) {
      return ResponseErrorQuery(
        "Error while updating the existing service",
        errorOrMaybeUpdatedService.left
      );
    }

    const maybeUpdatedService = errorOrMaybeUpdatedService.right;
    if (maybeUpdatedService.isEmpty) {
      return ResponseErrorInternal("Error while updating the existing service");
    }

    return ResponseSuccessJson(maybeUpdatedService.get);
  };
}

export function CreateServiceHandler(
  serviceModel: ServiceModel
): ICreateServiceHandler {
  return async (_, serviceModelPayload) => {
    const errorOrService = await serviceModel.create(
      serviceModelPayload,
      serviceModelPayload.serviceId
    );
    if (errorOrService.isRight) {
      return ResponseSuccessJson(errorOrService.right);
    } else {
      return ResponseErrorQuery("Error", errorOrService.left);
    }
  };
}

/**
 * Wraps a CreateService handler inside an Express request handler.
 */
export function CreateService(
  serviceModel: ServiceModel
): express.RequestHandler {
  const handler = CreateServiceHandler(serviceModel);
  const middlewaresWrap = withRequestMiddlewares(
    AzureApiAuthMiddleware(new Set([UserGroup.ApiServiceWrite])),
    ServicePayloadMiddleware
  );
  return wrapRequestHandler(middlewaresWrap(handler));
}

/**
 * Wraps an UpdateService handler inside an Express request handler.
 */
export function UpdateService(
  serviceModel: ServiceModel
): express.RequestHandler {
  const handler = UpdateServiceHandler(serviceModel);
  const requiredServiceIdMiddleware = RequiredParamMiddleware(params => {
    const serviceId = params.serviceid;
    if (isNonEmptyString(serviceId)) {
      return right(serviceId);
    } else {
      return left("Value of `serviceid` parameter must be a non empty string");
    }
  });
  const middlewaresWrap = withRequestMiddlewares(
    AzureApiAuthMiddleware(new Set([UserGroup.ApiServiceWrite])),
    requiredServiceIdMiddleware,
    ServicePayloadMiddleware
  );
  return wrapRequestHandler(middlewaresWrap(handler));
}
