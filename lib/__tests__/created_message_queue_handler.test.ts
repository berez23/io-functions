/* tslint:disable:no-any */
/* tslint:disable:no-big-function */
/* tslint:disable:no-identical-functions */

// set a dummy value for the env vars needed by the handler
// tslint:disable-next-line:no-object-mutation
process.env = {
  ...process.env,
  COSMOSDB_NAME: "anyDbName",
  CUSTOMCONNSTR_COSMOSDB_KEY: "anyCosmosDbKey",
  CUSTOMCONNSTR_COSMOSDB_URI: "anyCosmosDbUri",
  MESSAGE_CONTAINER_NAME: "anyMessageContainerName",
  QueueStorageConnection: "anyQueueStorageConnection",
  WEBHOOK_CHANNEL_URL: "https://example.com"
};

import { CreatedMessageEvent } from "../models/created_message_event";
import { NewMessageWithContent } from "../models/message";

import * as functionConfig from "../../CreatedMessageQueueHandler/function.json";

import { none, some } from "fp-ts/lib/Option";
import { FiscalCode } from "../api/definitions/FiscalCode";
import { MessageBodyMarkdown } from "../api/definitions/MessageBodyMarkdown";

import {
  EmailNotification,
  NewNotification,
  NotificationAddressSourceEnum,
  NotificationModel,
  WebhookNotification
} from "../models/notification";
import { ProfileModel, RetrievedProfile } from "../models/profile";

import { isLeft, isRight, left, right } from "fp-ts/lib/Either";
import { NonNegativeNumber } from "italia-ts-commons/lib/numbers";
import {
  EmailString,
  NonEmptyString,
  OrganizationFiscalCode
} from "italia-ts-commons/lib/strings";
import * as winston from "winston";
import { isTransient } from "../utils/errors";

import { NotificationChannelEnum } from "../api/definitions/NotificationChannel";
import { TimeToLiveSeconds } from "../api/definitions/TimeToLiveSeconds";
import { NotificationEvent } from "../models/notification_event";

jest.mock("azure-storage");
jest.mock("applicationinsights");
jest.mock("../utils/azure_queues");
import { handleQueueProcessingFailure } from "../utils/azure_queues";

import {
  handleMessage,
  index,
  MESSAGE_QUEUE_NAME
} from "../created_message_queue_handler";

import { HttpsUrl } from "../api/definitions/HttpsUrl";
import { MessageSubject } from "../api/definitions/MessageSubject";
import { ServiceId } from "../api/definitions/ServiceId";
import { MessageStatusModel } from "../models/message_status";
import {
  RetrievedSenderService,
  SenderServiceModel
} from "../models/sender_service";

afterEach(() => {
  jest.resetAllMocks();
  jest.restoreAllMocks();
});

const aCorrectFiscalCode = "FRLFRC74E04B157I" as FiscalCode;
const aWrongFiscalCode = "FRLFRC74E04B157" as FiscalCode;
const anEmail = "x@example.com" as EmailString;
const aUrl = "http://aUrl.com" as HttpsUrl;

const anEmailNotification: EmailNotification = {
  channels: {
    [NotificationChannelEnum.EMAIL]: {
      addressSource: NotificationAddressSourceEnum.PROFILE_ADDRESS,
      // fromAddress: anEmail,
      toAddress: anEmail
    }
  },
  fiscalCode: aCorrectFiscalCode,
  messageId: "m123" as NonEmptyString
};

const aWebhookNotification: WebhookNotification = {
  channels: {
    [NotificationChannelEnum.WEBHOOK]: {
      url: aUrl
    }
  },
  fiscalCode: aCorrectFiscalCode,
  messageId: "m123" as NonEmptyString
};

const aMessageBodyMarkdown = "test".repeat(80) as MessageBodyMarkdown;
const aMessageId = "m123" as NonEmptyString;
const aServiceId = "s123" as ServiceId;
const anOrganizationFiscalCode = "00000000000" as OrganizationFiscalCode;

const aMessage: NewMessageWithContent = {
  content: {
    markdown: aMessageBodyMarkdown,
    subject: "test".repeat(10) as MessageSubject
  },
  createdAt: new Date(),
  fiscalCode: aCorrectFiscalCode,
  id: aMessageId,
  indexedId: aMessageId,
  kind: "INewMessageWithContent",
  senderServiceId: aServiceId,
  senderUserId: "u123" as NonEmptyString,
  timeToLiveSeconds: 3600 as TimeToLiveSeconds
};

const aMessageEvent: CreatedMessageEvent = {
  message: aMessage,
  senderMetadata: {
    departmentName: "IT" as NonEmptyString,
    organizationFiscalCode: anOrganizationFiscalCode,
    organizationName: "agid" as NonEmptyString,
    serviceName: "Test" as NonEmptyString
  },
  serviceVersion: 1 as NonNegativeNumber
};

const aRetrievedProfileWithEmail: RetrievedProfile = {
  _self: "123",
  _ts: 123,
  email: anEmail,
  fiscalCode: aCorrectFiscalCode,
  id: "123" as NonEmptyString,
  kind: "IRetrievedProfile",
  version: 1 as NonNegativeNumber
};

const aRetrievedProfileWithoutEmail: RetrievedProfile = {
  _self: "123",
  _ts: 123,
  fiscalCode: aCorrectFiscalCode,
  id: "123" as NonEmptyString,
  kind: "IRetrievedProfile",
  version: 1 as NonNegativeNumber
};

const aCreatedNotificationWithoutEmail = {
  fiscalCode: aCorrectFiscalCode,
  id: "123" as NonEmptyString,
  kind: "INewNotification",
  messageId: aMessageId
};

const aCreatedNotificationWithEmail: NewNotification = {
  ...aCreatedNotificationWithoutEmail,
  ...anEmailNotification,
  kind: "INewNotification"
};

const anEmailNotificationEvent: NotificationEvent = {
  message: {
    ...aMessage,
    content: {
      markdown: aMessageBodyMarkdown,
      subject: "test".repeat(10) as MessageSubject
    },
    kind: "INewMessageWithContent"
  },
  notificationId: aCreatedNotificationWithEmail.id,
  senderMetadata: aMessageEvent.senderMetadata
};

const aBlobService = {};

const anAttachmentMeta = {
  contentType: "application/json",
  media: "media.json"
};

const aRetrivedSenderService: RetrievedSenderService = {
  _self: "a",
  _ts: Date.now(),
  id: "123" as NonEmptyString,
  kind: "IRetrievedSenderService",
  lastNotificationAt: new Date(),
  recipientFiscalCode: aCorrectFiscalCode,
  serviceId: aServiceId,
  version: 1 as NonNegativeNumber
};

const getSenderServicesModelMock = (
  senderService: RetrievedSenderService = aRetrivedSenderService
) => ({
  createOrUpdate: jest.fn(async (_, __) => right(senderService)),
  findSenderServicesForRecipient: jest.fn(async (_, __) =>
    right({
      items: [{ serviceId: senderService }],
      page_size: 1
    })
  )
});

describe("createdMessageQueueIndex", () => {
  it("should return failure if createdMessage is undefined", async () => {
    const contextMock = {
      bindings: {
        createdMessage: undefined,
        emailNotification: undefined
      },
      done: jest.fn(),
      log: jest.fn()
    };

    const spy = jest.spyOn(winston, "error");

    const ret = await index(contextMock as any);
    expect(ret).toEqual(undefined);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("should return failure if any error occurs", async () => {
    const contextMock = {
      bindingData: {
        dequeueCount: 1
      },
      bindings: {
        createdMessage: aMessageEvent,
        emailNotification: undefined
      },
      done: jest.fn(),
      log: jest.fn()
    };

    jest
      .spyOn(ProfileModel.prototype, "findOneProfileByFiscalCode")
      .mockImplementationOnce(() => {
        throw new Error("findOneProfileByFiscalCodeError");
      });

    const ret = await index(contextMock as any);
    expect(ret).toEqual(undefined);
    expect(handleQueueProcessingFailure).toHaveBeenCalledWith(
      undefined,
      { dequeueCount: 1 },
      "createdmessages",
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ message: "findOneProfileByFiscalCodeError" })
    );
  });

  it("should stop processing if createdMessage is invalid (wrong fiscal code)", async () => {
    const contextMock = {
      bindings: {
        createdMessage: {
          aMessageEvent,
          message: { ...aMessage, fiscalCode: aWrongFiscalCode }
        },
        emailNotification: undefined
      },
      done: jest.fn(),
      log: jest.fn()
    };

    const spy = jest.spyOn(winston, "error");

    const ret = await index(contextMock as any);
    expect(ret).toEqual(undefined);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("should output bindings on success", async () => {
    const contextMock = {
      bindings: {
        createdMessage: aMessageEvent,
        emailNotification: undefined
      },
      done: jest.fn(),
      log: jest.fn()
    };

    const notificationSpy = jest
      .spyOn(NotificationModel.prototype, "create")
      .mockImplementationOnce(() =>
        Promise.resolve(right(aCreatedNotificationWithEmail))
      );

    jest
      .spyOn(SenderServiceModel.prototype, "createOrUpdate")
      .mockReturnValue(Promise.resolve(right(none)));

    jest
      .spyOn(MessageStatusModel.prototype, "upsert")
      .mockReturnValue(Promise.resolve(right(none)));

    const profileSpy = jest
      .spyOn(ProfileModel.prototype, "findOneProfileByFiscalCode")
      .mockImplementationOnce(() =>
        Promise.resolve(right(some(aRetrievedProfileWithEmail)))
      );

    const ret = await index(contextMock as any);
    expect(ret).toEqual({
      emailNotification: anEmailNotificationEvent
    });

    expect(profileSpy).toHaveBeenCalledTimes(1);
    expect(notificationSpy).toHaveBeenCalledTimes(1);
  });

  it("should handle queue processing failure on transient error", async () => {
    const contextMock = {
      bindingData: {
        dequeueCount: 1
      },
      bindings: {
        createdMessage: aMessageEvent,
        emailNotification: undefined
      },
      done: jest.fn(),
      log: jest.fn()
    };

    const profileSpy = jest
      .spyOn(ProfileModel.prototype, "findOneProfileByFiscalCode")
      .mockImplementationOnce(() => Promise.resolve(left(none)));

    const ret = await index(contextMock as any);
    expect(ret).toEqual(undefined);

    expect(handleQueueProcessingFailure).toHaveBeenCalledWith(
      undefined,
      { dequeueCount: 1 },
      "createdmessages",
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({
        kind: "TransientError"
      })
    );
    expect(profileSpy).toHaveBeenCalledTimes(1);
  });
});

describe("handleMessage", () => {
  it("should return TRANSIENT error if fetching user profile returns error", async () => {
    const profileModelMock = {
      findOneProfileByFiscalCode: jest.fn(() => {
        return Promise.resolve(left(none));
      })
    };

    const response = await handleMessage(
      profileModelMock as any,
      {} as any,
      {} as any,
      getSenderServicesModelMock() as any,
      {} as any,
      aUrl,
      aMessageEvent
    );
    expect(profileModelMock.findOneProfileByFiscalCode).toHaveBeenCalledWith(
      aCorrectFiscalCode
    );
    expect(isLeft(response)).toBeTruthy();
    if (isLeft(response)) {
      expect(isTransient(response.value)).toBeTruthy();
    }
  });

  it("should exit with no output bindings if no channel can be resolved", async () => {
    const profileModelMock = {
      findOneProfileByFiscalCode: jest.fn(() => {
        return Promise.resolve(right(none));
      })
    };

    const response = await handleMessage(
      profileModelMock as any,
      {} as any,
      {} as any,
      getSenderServicesModelMock() as any,
      {} as any,
      aUrl,
      aMessageEvent
    );

    expect(profileModelMock.findOneProfileByFiscalCode).toHaveBeenCalledWith(
      aCorrectFiscalCode
    );

    expect(isRight(response)).toBeTruthy();
    if (isRight(response)) {
      expect(response.value).toEqual({});
    }
  });

  it(
    "should not create an email notification if a profile exists " +
      "but the email field is empty and no default email was provided",
    async () => {
      const profileModelMock = {
        findOneProfileByFiscalCode: jest.fn(() => {
          return Promise.resolve(right(some(aRetrievedProfileWithoutEmail)));
        })
      };

      const notificationModelMock = {
        create: jest.fn(() => {
          return Promise.resolve(right(none));
        })
      };

      const response = await handleMessage(
        profileModelMock as any,
        {} as any,
        notificationModelMock as any,
        getSenderServicesModelMock() as any,
        {} as any,
        aUrl,
        aMessageEvent
      );

      expect(profileModelMock.findOneProfileByFiscalCode).toHaveBeenCalledWith(
        aCorrectFiscalCode
      );

      expect(isRight(response)).toBeTruthy();
      if (isRight(response)) {
        expect(response.value).toEqual({});
      }
    }
  );

  it(
    "should not create an email notification if a profile exists " +
      "with an email field but the email channel is blocked for this service",
    async () => {
      const profileModelMock = {
        findOneProfileByFiscalCode: jest.fn(() => {
          return Promise.resolve(
            right(
              some({
                ...aRetrievedProfileWithEmail,
                blockedInboxOrChannels: {
                  [aServiceId]: new Set(["EMAIL"])
                }
              })
            )
          );
        })
      };

      const notificationModelMock = {
        create: jest.fn(() => {
          return Promise.resolve(right(none));
        })
      };

      const response = await handleMessage(
        profileModelMock as any,
        {} as any,
        notificationModelMock as any,
        getSenderServicesModelMock() as any,
        {} as any,
        aUrl,
        aMessageEvent
      );

      expect(profileModelMock.findOneProfileByFiscalCode).toHaveBeenCalledWith(
        aCorrectFiscalCode
      );

      expect(isRight(response)).toBeTruthy();
      if (isRight(response)) {
        expect(response.value).toEqual({});
      }
    }
  );

  it(
    "should not create a webhook notification if a profile exists " +
      "with is_webhook_enabled but the channel is blocked for this service",
    async () => {
      const profileModelMock = {
        findOneProfileByFiscalCode: jest.fn(() => {
          return Promise.resolve(
            right(
              some({
                ...aRetrievedProfileWithoutEmail,
                blockedInboxOrChannels: {
                  [aServiceId]: new Set(["WEBHOOK"])
                },
                isWebhookEnabled: true
              })
            )
          );
        })
      };

      const notificationModelMock = {
        create: jest.fn(() => {
          return Promise.resolve(right(none));
        })
      };

      const response = await handleMessage(
        profileModelMock as any,
        {} as any,
        notificationModelMock as any,
        getSenderServicesModelMock() as any,
        {} as any,
        aUrl,
        aMessageEvent
      );

      expect(profileModelMock.findOneProfileByFiscalCode).toHaveBeenCalledWith(
        aCorrectFiscalCode
      );

      expect(isRight(response)).toBeTruthy();
      if (isRight(response)) {
        expect(response.value).toEqual({});
      }
    }
  );

  it("should not create a webhook or email notification if the inbox is disabled", async () => {
    const profileModelMock = {
      findOneProfileByFiscalCode: jest.fn(() => {
        return Promise.resolve(
          right(
            some({
              ...aRetrievedProfileWithEmail,
              blockedInboxOrChannels: {
                [aServiceId]: new Set(["INBOX"])
              },
              isInboxEnabled: true,
              isWebhookEnabled: true
            })
          )
        );
      })
    };

    const notificationModelMock = {
      create: jest.fn(() => {
        return Promise.resolve(right(none));
      })
    };

    const response = await handleMessage(
      profileModelMock as any,
      {} as any,
      notificationModelMock as any,
      getSenderServicesModelMock() as any,
      {} as any,
      aUrl,
      aMessageEvent
    );

    expect(profileModelMock.findOneProfileByFiscalCode).toHaveBeenCalledWith(
      aCorrectFiscalCode
    );

    expect(isRight(response)).toBeTruthy();
    if (isRight(response)) {
      expect(response.value).toEqual({});
    }
  });

  it(
    "should create a notification with an email if a profile exists for " +
      "fiscal code and the email field isn't empty",
    async () => {
      const profileModelMock = {
        findOneProfileByFiscalCode: jest.fn(() => {
          return Promise.resolve(right(some(aRetrievedProfileWithEmail)));
        })
      };

      const notificationModelMock = {
        create: jest.fn((document, _) => {
          return Promise.resolve(right(document));
        })
      };

      const response = await handleMessage(
        profileModelMock as any,
        {} as any,
        notificationModelMock as any,
        getSenderServicesModelMock() as any,
        {} as any,
        aUrl,
        aMessageEvent
      );

      expect(profileModelMock.findOneProfileByFiscalCode).toHaveBeenCalledWith(
        aCorrectFiscalCode
      );

      expect(notificationModelMock.create).toHaveBeenCalledWith(
        {
          ...anEmailNotification,
          id: expect.anything(),
          kind: "INewNotification"
        },
        anEmailNotification.messageId
      );

      expect(isRight(response)).toBeTruthy();
      if (isRight(response)) {
        expect(response.value).not.toBeUndefined();
        expect(response.value.emailNotification).not.toBeUndefined();
      }
    }
  );

  it(
    "should create a webhook notification if a profile exists for " +
      "fiscal code and the webhook is enabled",
    async () => {
      const profileModelMock = {
        findOneProfileByFiscalCode: jest.fn(() => {
          return Promise.resolve(
            right(
              some({
                ...aRetrievedProfileWithoutEmail,
                isWebhookEnabled: true
              })
            )
          );
        })
      };

      const notificationModelMock = {
        create: jest.fn((document, _) => {
          return Promise.resolve(right(document));
        })
      };

      const response = await handleMessage(
        profileModelMock as any,
        {} as any,
        notificationModelMock as any,
        getSenderServicesModelMock() as any,
        {} as any,
        aUrl,
        aMessageEvent
      );

      expect(profileModelMock.findOneProfileByFiscalCode).toHaveBeenCalledWith(
        aCorrectFiscalCode
      );

      expect(notificationModelMock.create).toHaveBeenCalledWith(
        {
          ...aWebhookNotification,
          id: expect.anything(),
          kind: "INewNotification"
        },
        anEmailNotification.messageId
      );

      expect(isRight(response)).toBeTruthy();
      if (isRight(response)) {
        expect(response.value).not.toBeUndefined();
        expect(response.value.webhookNotification).not.toBeUndefined();
      }
    }
  );

  it(
    "should create a notification with an email if a profile exists for " +
      "fiscal code, the email field is empty but a default email was provided",
    async () => {
      const profileModelMock = {
        findOneProfileByFiscalCode: jest.fn(() => {
          return Promise.resolve(
            right(
              some({
                ...aRetrievedProfileWithEmail,
                email: undefined
              })
            )
          );
        })
      };

      const notificationModelMock = {
        create: jest.fn((document, _) => {
          return Promise.resolve(right(document));
        })
      };

      const response = await handleMessage(
        profileModelMock as any,
        {} as any,
        notificationModelMock as any,
        getSenderServicesModelMock() as any,
        {} as any,
        aUrl,
        {
          ...aMessageEvent,
          defaultAddresses: { email: anEmail }
        }
      );

      expect(profileModelMock.findOneProfileByFiscalCode).toHaveBeenCalledWith(
        aCorrectFiscalCode
      );

      expect(notificationModelMock.create).toHaveBeenCalledWith(
        {
          ...anEmailNotification,
          channels: {
            [NotificationChannelEnum.EMAIL]: {
              ...anEmailNotification.channels.EMAIL,
              addressSource: NotificationAddressSourceEnum.DEFAULT_ADDRESS
            }
          },
          id: expect.anything(),
          kind: "INewNotification"
        },
        anEmailNotification.messageId
      );

      expect(isRight(response)).toBeTruthy();
      if (isRight(response)) {
        expect(response.value).not.toBeUndefined();
        expect(response.value.emailNotification).not.toBeUndefined();
      }
    }
  );

  it(
    "should create a notification with an email if a profile does not exists for " +
      "fiscal code but a default email was provided",
    async () => {
      const profileModelMock = {
        findOneProfileByFiscalCode: jest.fn(() => {
          return Promise.resolve(right(none));
        })
      };

      const notificationModelMock = {
        create: jest.fn((document, _) => {
          return Promise.resolve(right(document));
        })
      };

      const response = await handleMessage(
        profileModelMock as any,
        {} as any,
        notificationModelMock as any,
        getSenderServicesModelMock() as any,
        {} as any,
        aUrl,
        {
          ...aMessageEvent,
          defaultAddresses: { email: anEmail }
        }
      );

      expect(profileModelMock.findOneProfileByFiscalCode).toHaveBeenCalledWith(
        aCorrectFiscalCode
      );
      expect(notificationModelMock.create).toHaveBeenCalledWith(
        {
          ...anEmailNotification,
          channels: {
            [NotificationChannelEnum.EMAIL]: {
              ...anEmailNotification.channels.EMAIL,
              addressSource: NotificationAddressSourceEnum.DEFAULT_ADDRESS
            }
          },
          id: expect.anything(),
          kind: "INewNotification"
        },
        anEmailNotification.messageId
      );

      expect(isRight(response)).toBeTruthy();
      if (isRight(response)) {
        expect(response.value).not.toBeUndefined();
        expect(response.value.emailNotification).not.toBeUndefined();
      }
    }
  );

  it("should save the message content if the user enabled the feature in its profile", async () => {
    const profileModelMock = {
      findOneProfileByFiscalCode: jest.fn(() => {
        return Promise.resolve(
          right(
            some({
              ...aRetrievedProfileWithEmail,
              isInboxEnabled: true
            })
          )
        );
      })
    };

    const retrievedMessageMock = {
      fiscalCode: aCorrectFiscalCode,
      id: aMessageEvent.message.id
    };

    const messageModelMock = {
      attachStoredContent: jest.fn(() => {
        return Promise.resolve(right(some(anAttachmentMeta)));
      })
    };

    const notificationModelMock = {
      create: jest.fn((document, _) => {
        return Promise.resolve(right(document));
      })
    };

    const response = await handleMessage(
      profileModelMock as any,
      messageModelMock as any,
      notificationModelMock as any,
      getSenderServicesModelMock() as any,
      aBlobService as any,
      aUrl,
      {
        ...aMessageEvent,
        defaultAddresses: { email: anEmail }
      }
    );

    expect(profileModelMock.findOneProfileByFiscalCode).toHaveBeenCalledWith(
      aCorrectFiscalCode
    );

    expect(messageModelMock.attachStoredContent.mock.calls[0][0]).toBe(
      aBlobService
    );
    expect(messageModelMock.attachStoredContent.mock.calls[0][1]).toBe(
      retrievedMessageMock.id
    );
    expect(messageModelMock.attachStoredContent.mock.calls[0][2]).toEqual(
      retrievedMessageMock.fiscalCode
    );

    expect(notificationModelMock.create).toHaveBeenCalledWith(
      {
        ...anEmailNotification,
        id: expect.anything(),
        kind: "INewNotification"
      },
      anEmailNotification.messageId
    );

    expect(isRight(response)).toBeTruthy();
    if (isRight(response)) {
      expect(response.value).not.toBeUndefined();
      expect(response.value.emailNotification).not.toBeUndefined();
    }
  });

  it("should return a TRANSIENT error if saving the message content errors", async () => {
    const profileModelMock = {
      findOneProfileByFiscalCode: jest.fn(() => {
        return Promise.resolve(
          right(
            some({
              ...aRetrievedProfileWithEmail,
              isInboxEnabled: true
            })
          )
        );
      })
    };

    const retrievedMessageMock = {
      fiscalCode: aCorrectFiscalCode,
      id: aMessageEvent.message.id
    };

    const messageModelMock = {
      attachStoredContent: jest.fn(() => {
        return Promise.resolve(left("error"));
      })
    };

    const notificationModelMock = {
      create: jest.fn((document, _) => {
        return Promise.resolve(right(document));
      })
    };

    const response = await handleMessage(
      profileModelMock as any,
      messageModelMock as any,
      notificationModelMock as any,
      getSenderServicesModelMock() as any,
      aBlobService as any,
      aUrl,
      {
        ...aMessageEvent,
        defaultAddresses: { email: anEmail }
      }
    );

    expect(profileModelMock.findOneProfileByFiscalCode).toHaveBeenCalledWith(
      aCorrectFiscalCode
    );

    expect(messageModelMock.attachStoredContent.mock.calls[0][0]).toBe(
      aBlobService
    );
    expect(messageModelMock.attachStoredContent.mock.calls[0][1]).toBe(
      retrievedMessageMock.id
    );
    expect(messageModelMock.attachStoredContent.mock.calls[0][2]).toEqual(
      retrievedMessageMock.fiscalCode
    );

    expect(isLeft(response)).toBeTruthy();
    expect(isLeft(response)).toBeTruthy();
    if (isLeft(response)) {
      expect(isTransient(response.value)).toBeTruthy();
    }
  });

  it("should return TRANSIENT error if saving notification returns error", async () => {
    const profileModelMock = {
      findOneProfileByFiscalCode: jest.fn(() => {
        return Promise.resolve(right(some(aRetrievedProfileWithEmail)));
      })
    };

    const notificationModelMock = {
      create: jest.fn((_, __) => {
        return Promise.resolve(left(none));
      })
    };

    const response = await handleMessage(
      profileModelMock as any,
      {} as any,
      notificationModelMock as any,
      getSenderServicesModelMock() as any,
      {} as any,
      aUrl,
      aMessageEvent
    );

    expect(profileModelMock.findOneProfileByFiscalCode).toHaveBeenCalledWith(
      aCorrectFiscalCode
    );
    expect(isLeft(response)).toBeTruthy();
    if (isLeft(response)) {
      expect(isTransient(response.value)).toBeTruthy();
    }
  });
});

describe("createMessageQueueHandler", () => {
  it("should set MESSAGE_QUEUE_NAME = queueName in functions.json trigger", async () => {
    const queueName = (functionConfig as any).bindings[0].queueName;
    expect(queueName).toEqual(MESSAGE_QUEUE_NAME);
  });
});
